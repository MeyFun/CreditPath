from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Product
from ..schemas import ProductOut
from ..services.external import ExternalServiceError, fetch_registry
from ..services.finance import payment_schedule
from ..services.inn import validate_inn
from ..services.serializers import product_dict

router = APIRouter(prefix="/public", tags=["Публичный каталог"])


@router.get("/products", response_model=list[ProductOut])
def products(db: Session = Depends(get_db)) -> list[dict]:
    rows = db.scalars(
        select(Product).where(Product.is_active.is_(True)).order_by(Product.sort_order, Product.id)
    ).all()
    return [product_dict(item) for item in rows]


@router.get("/products/{code}", response_model=ProductOut)
def product(code: str, db: Session = Depends(get_db)) -> dict:
    item = db.scalar(select(Product).where(Product.code == code, Product.is_active.is_(True)))
    if item is None:
        raise HTTPException(status_code=404, detail="Продукт не найден")
    return product_dict(item)


@router.get("/registry/{inn}")
def registry_lookup(inn: str) -> dict:
    valid, message = validate_inn(inn)
    if not valid:
        raise HTTPException(status_code=422, detail=message)
    try:
        company = fetch_registry(inn)
    except ExternalServiceError as exc:
        if exc.code == "not_found":
            raise HTTPException(
                status_code=404,
                detail="Компания с таким ИНН не найдена в реестре. Проверьте номер.",
            ) from exc
        raise HTTPException(
            status_code=503,
            detail="Реестр временно недоступен. Повторите проверку через минуту.",
        ) from exc
    return {
        "found": True,
        "company": company,
        "source": "Локальный демонстрационный реестр",
        "verified_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/payment-schedule")
def calculate_payment(amount: float, rate: float, term_months: int) -> dict:
    if amount <= 0 or rate <= 0 or term_months <= 0 or term_months > 120:
        raise HTTPException(status_code=422, detail="Проверьте параметры расчёта")
    return payment_schedule(amount, rate, term_months)
