from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..models import ROLE_CLIENT, User
from ..schemas import LoginRequest, RegisterRequest, TokenResponse, UserOut
from ..security import (
    client_ip,
    create_access_token,
    get_current_user,
    hash_password,
    login_rate_limiter,
    verify_password,
)
from ..services.audit import write_audit
from ..services.inn import validate_inn

router = APIRouter(prefix="/auth", tags=["Авторизация"])


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, request: Request, db: Session = Depends(get_db)) -> TokenResponse:
    if db.scalar(select(User).where(User.username == payload.username.lower())) is not None:
        raise HTTPException(status_code=409, detail="Логин уже занят")
    if payload.company_inn:
        valid, message = validate_inn(payload.company_inn)
        if not valid:
            raise HTTPException(status_code=422, detail=message)
    user = User(
        username=payload.username.lower(),
        password_hash=hash_password(payload.password),
        full_name=payload.full_name.strip(),
        role=ROLE_CLIENT,
        company_inn=payload.company_inn,
    )
    db.add(user)
    db.flush()
    write_audit(
        db,
        actor=user,
        action="auth.registered",
        entity_type="user",
        entity_id=user.id,
        after={"username": user.username, "role": user.role},
    )
    db.commit()
    token, expires_in = create_access_token(user)
    return TokenResponse(access_token=token, expires_in=expires_in, user=UserOut.model_validate(user))


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)) -> TokenResponse:
    username = payload.username.lower().strip()
    rate_key = f"{client_ip(request)}:{username}"
    login_rate_limiter.check(rate_key)
    user = db.scalar(select(User).where(User.username == username))
    if user is None or not user.is_active or not verify_password(payload.password, user.password_hash):
        login_rate_limiter.failure(rate_key)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный логин или пароль",
        )
    login_rate_limiter.success(rate_key)
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
