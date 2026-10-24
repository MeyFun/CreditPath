from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..models import User
from ..schemas import LoginRequest, TokenResponse, UserOut
from ..security import (
    client_ip,
    create_access_token,
    get_current_user,
    login_rate_limiter,
    login_user_rate_limiter,
    verify_password_timing_safe,
)
from ..services.audit import write_audit

router = APIRouter(prefix="/auth", tags=["Авторизация"])


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)) -> TokenResponse:
    username = payload.username.lower().strip()
    rate_key = f"{client_ip(request)}:{username}"
    login_rate_limiter.check(rate_key)
    login_user_rate_limiter.check(username)
    user = db.scalar(select(User).where(User.username == username))
    if not verify_password_timing_safe(payload.password, user) or not user.is_active:
        login_rate_limiter.failure(rate_key)
        login_user_rate_limiter.failure(username)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный логин или пароль",
        )
    login_rate_limiter.success(rate_key)
    login_user_rate_limiter.success(username)
    user.last_login_at = datetime.now(timezone.utc)
    write_audit(
        db,
        actor=user,
        action="auth.login",
        entity_type="session",
        entity_id=user.id,
        after={"result": "success"},
    )
    db.commit()
    token, expires_in = create_access_token(user)
    return TokenResponse(access_token=token, expires_in=expires_in, user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> User:
    return user


@router.get("/demo-hint")
def demo_hint() -> dict:
    """Подсказка для страницы входа. Пароль демонстрационный и указан в README."""
    return {
        "demo_mode": settings.seed_demo,
        "password_hint": settings.demo_password if settings.seed_demo else "",
        "accounts": ["client1", "client2", "client3", "employee1", "employee2", "employee3", "admin"],
    }
