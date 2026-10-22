from __future__ import annotations

import json
import logging
import time
import uuid
from contextvars import ContextVar
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from starlette.middleware.base import BaseHTTPMiddleware

from .api import admin, auth, client, employee, notifications, public
from .config import settings
from .db import engine
from .services.state_machine import InvalidTransition

request_id_ctx: ContextVar[str] = ContextVar("request_id", default="-")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": request_id_ctx.get(),
        }
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def configure_logging() -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(settings.log_level.upper())
    for noisy in ("uvicorn.access", "uvicorn.error"):
        logger = logging.getLogger(noisy)
        logger.handlers = []
        logger.propagate = True


configure_logging()
logger = logging.getLogger("creditpath.api")

app = FastAPI(
    title="CreditPath API",
    description=(
        "Прототип кредитного конвейера для малого и микробизнеса. "
        "Реестр и кредитная история смоделированы локальными сервисами на синтетических данных. "
        "Подписание и выдача средств имитируются."
    ),
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
    openapi_url="/openapi.json",
    contact={"name": "CreditPath Demo"},
    license_info={"name": "Prototype for hackathon"},
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "X-Request-Id"],
    expose_headers=["X-Request-Id"],
)


class RequestMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        incoming = request.headers.get("x-request-id")
        request_id = incoming[:64] if incoming else str(uuid.uuid4())
        token = request_id_ctx.set(request_id)
        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            logger.exception(
                "Необработанная ошибка",
                extra={"method": request.method, "path": request.url.path},
            )
            raise
        duration_ms = round((time.perf_counter() - started) * 1000, 1)
        response.headers["X-Request-Id"] = request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        response.headers["Cache-Control"] = "no-store"
        logger.info(
            "HTTP %s %s -> %s",
            request.method,
            request.url.path,
            response.status_code,
            extra={"duration_ms": duration_ms},
        )
        request_id_ctx.reset(token)
        return response


app.add_middleware(RequestMiddleware)


@app.exception_handler(InvalidTransition)
async def invalid_transition_handler(request: Request, exc: InvalidTransition):
    logger.warning("Отклонён недопустимый переход %s -> %s", exc.status_from, exc.status_to)
    return JSONResponse(
        status_code=409,
        content={"detail": f"Недопустимый переход статуса: {exc.status_from} → {exc.status_to}"},
    )


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError):
    errors = []
    for item in exc.errors():
        field = ".".join(str(part) for part in item.get("loc", []) if part not in {"body", "query"})
        errors.append({"field": field, "message": item.get("msg", "Некорректное значение")})
    return JSONResponse(
        status_code=422,
        content={"detail": "Проверьте заполнение полей", "errors": errors},
    )


@app.exception_handler(IntegrityError)
async def integrity_handler(request: Request, exc: IntegrityError):
    logger.warning("Конфликт целостности данных при %s", request.url.path)
    return JSONResponse(status_code=409, content={"detail": "Конфликт данных. Обновите страницу и повторите."})


app.include_router(auth.router, prefix="/api")
app.include_router(public.router, prefix="/api")
app.include_router(client.router, prefix="/api")
app.include_router(employee.router, prefix="/api")
app.include_router(admin.router, prefix="/api")
app.include_router(notifications.router, prefix="/api")

app.mount(
    "/static",
    StaticFiles(directory=str(Path(__file__).resolve().parent / "static")),
    name="static",
)


@app.get("/docs", include_in_schema=False)
def swagger_docs() -> HTMLResponse:
    """Self-hosted Swagger UI: страница документации не обращается к внешним CDN."""
    return get_swagger_ui_html(
        openapi_url="/openapi.json",
        title="CreditPath API — документация",
        swagger_js_url="/static/swagger/swagger-ui-bundle.js",
        swagger_css_url="/static/swagger/swagger-ui.css",
        swagger_favicon_url="data:,",
    )


@app.get("/health", tags=["Служебные"])
@app.get("/healthz", tags=["Служебные"])
def health() -> dict:
    return {"status": "ok", "service": "creditpath-backend", "version": "1.0.0"}


@app.get("/ready", tags=["Служебные"])
@app.get("/readyz", tags=["Служебные"])
def ready() -> JSONResponse:
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except Exception:
        logger.exception("Readiness: база данных недоступна")
        return JSONResponse(status_code=503, content={"status": "not_ready", "database": "unavailable"})
    return JSONResponse(status_code=200, content={"status": "ready", "database": "ok"})


@app.on_event("startup")
def ensure_upload_directory() -> None:
    Path(settings.upload_dir).mkdir(parents=True, exist_ok=True)
    logger.info("CreditPath API запущен", extra={"environment": settings.environment})
