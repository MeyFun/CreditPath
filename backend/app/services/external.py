from __future__ import annotations

import logging
import time
from typing import Any

import httpx

from ..config import settings

logger = logging.getLogger("creditpath.external")

RETRYABLE_STATUS = {500, 502, 503, 504}


class ExternalServiceError(Exception):
    def __init__(self, service: str, message: str, code: str = "unavailable"):
        super().__init__(message)
        self.service = service
        self.message = message
        self.code = code


def _get(url: str, service: str) -> dict[str, Any]:
    last_error: Exception | None = None
    attempts = max(0, settings.external_retries) + 1
    for attempt in range(1, attempts + 1):
        try:
            with httpx.Client(timeout=settings.external_timeout_seconds) as client:
                response = client.get(url, headers={"X-Request-Source": "creditpath-backend"})
            if response.status_code == 404:
                raise ExternalServiceError(service, "Запись не найдена", "not_found")
            if response.status_code in RETRYABLE_STATUS:
                raise httpx.HTTPStatusError(
                    f"{service} вернул {response.status_code}",
                    request=response.request,
                    response=response,
                )
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, dict):
                raise ExternalServiceError(service, "Некорректный формат ответа", "bad_response")
            return payload
        except ExternalServiceError:
            raise
        except (httpx.TimeoutException, httpx.NetworkError, httpx.HTTPStatusError, ValueError) as exc:
            last_error = exc
            logger.warning("%s: попытка %s/%s не удалась (%s)", service, attempt, attempts, type(exc).__name__)
            if attempt < attempts:
                time.sleep(0.35 * attempt)
    raise ExternalServiceError(service, "Сервис временно недоступен", "unavailable") from last_error


def fetch_registry(inn: str) -> dict[str, Any]:
    return _get(f"{settings.registry_url.rstrip('/')}/registry/{inn}", "registry")


def fetch_bki(inn: str) -> dict[str, Any]:
    return _get(f"{settings.bki_url.rstrip('/')}/bki/{inn}", "bki")


def registry_check_data(inn: str) -> dict[str, Any]:
    data = fetch_registry(inn)
    return {"found": True, "source": "registry-mock", "company": data}
