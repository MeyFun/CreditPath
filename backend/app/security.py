from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .models import ROLE_ADMIN, ROLE_CLIENT, ROLE_EMPLOYEE, User

password_hasher = PasswordHasher(time_cost=2, memory_cost=65536, parallelism=2)
bearer_scheme = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return password_hasher.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError, ValueError):
        return False


def create_access_token(user: User) -> tuple[str, int]:
    expires_in = settings.access_token_minutes * 60
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": str(user.id),
        "role": user.role,
        "iat": now,
        "exp": now + timedelta(seconds=expires_in),
        "jti": secrets_token(),
    }
    token = jwt.encode(payload, settings.jwt_secret, algorithm="HS256")
    return token, expires_in


def secrets_token() -> str:
    import secrets

    return secrets.token_urlsafe(18)


def decode_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Сессия истекла или токен недействителен",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Требуется авторизация",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = decode_token(credentials.credentials)
    try:
        user_id = int(payload.get("sub", ""))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=401, detail="Некорректный токен") from exc
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="Учётная запись недоступна")
    return user


def require_roles(*roles: str):
    def dependency(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=403, detail="Недостаточно прав для этого действия")
        return user

    return dependency


require_client = require_roles(ROLE_CLIENT)
require_employee = require_roles(ROLE_EMPLOYEE)
require_admin = require_roles(ROLE_ADMIN)


class LoginRateLimiter:
    def __init__(self, limit: int | None = None) -> None:
        self._limit = limit
        self._attempts: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def _trim(self, key: str, now: float) -> None:
        bucket = self._attempts[key]
        while bucket and now - bucket[0] > settings.login_rate_window_seconds:
            bucket.popleft()
        if not bucket:
            # Пустые счётчики удаляем, чтобы словарь не рос от перебора несуществующих логинов.
            del self._attempts[key]

    def check(self, key: str) -> None:
        now = time.time()
        with self._lock:
            self._trim(key, now)
            limit = self._limit if self._limit is not None else settings.login_rate_limit
            bucket = self._attempts.get(key)
            if bucket and len(bucket) >= limit:
                retry_after = max(1, int(settings.login_rate_window_seconds - (now - bucket[0])))
                raise HTTPException(
                    status_code=429,
                    detail=f"Слишком много попыток входа. Повторите через {retry_after} сек.",
                    headers={"Retry-After": str(retry_after)},
                )

    def failure(self, key: str) -> None:
        with self._lock:
            self._trim(key, time.time())
            self._attempts[key].append(time.time())

    def success(self, key: str) -> None:
        with self._lock:
            self._attempts.pop(key, None)


login_rate_limiter = LoginRateLimiter()
login_user_rate_limiter = LoginRateLimiter(settings.login_user_rate_limit)


def client_ip(request: Request) -> str:
    # Адрес клиента берётся из соединения. X-Forwarded-For учитывает uvicorn
    # (--proxy-headers) и только от доверенного прокси (nginx), поэтому подмена заголовка не работает.
    return request.client.host if request.client else "unknown"
