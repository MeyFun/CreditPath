"""Персональная новостная лента: отбор и ранжирование новостей под профиль клиента."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Application, EnrichmentSnapshot, NewsItem, Product, User
from .external import ExternalServiceError, fetch_registry
from .state_machine import STATUS_LABELS


@dataclass
class ClientContext:
    opf: str | None = None
    okved: str | None = None
    okved_name: str | None = None
    age_months: int | None = None
    statuses: set[str] = field(default_factory=set)
    products: dict[str, str] = field(default_factory=dict)  # code -> name


def _opf_by_inn(inn: str | None) -> str | None:
    if not inn:
        return None
    return "ИП" if len(inn) == 12 else "ООО" if len(inn) == 10 else None


def _age_months(registration_date: str | None) -> int | None:
    if not registration_date:
        return None
    try:
        registered = date.fromisoformat(registration_date[:10])
    except ValueError:
        return None
    today = datetime.now(timezone.utc).date()
    return max(0, (today.year - registered.year) * 12 + today.month - registered.month)


def build_context(db: Session, user: User, *, use_registry: bool = True) -> ClientContext:
    context = ClientContext(opf=_opf_by_inn(user.company_inn))
    registry: dict[str, Any] | None = None
    if user.company_inn:
        snapshot = db.scalar(
            select(EnrichmentSnapshot)
            .join(Application, Application.id == EnrichmentSnapshot.application_id)
            .where(
                Application.user_id == user.id,
                Application.company_inn == user.company_inn,
                EnrichmentSnapshot.registry_ok.is_(True),
            )
            .order_by(EnrichmentSnapshot.fetched_at.desc())
            .limit(1)
        )
        registry = snapshot.registry_data if snapshot else None
        if registry is None and use_registry:
            try:
                registry = fetch_registry(user.company_inn)
            except ExternalServiceError:
                registry = None
    if registry:
        context.okved = registry.get("okved")
        context.okved_name = registry.get("okved_name")
        context.age_months = _age_months(registry.get("registration_date"))

    rows = db.execute(
        select(Application.status, Product.code, Product.name)
        .join(Product, Product.id == Application.product_id)
        .where(Application.user_id == user.id)
    ).all()
    for status, code, name in rows:
        context.statuses.add(status)
        context.products[code] = name
    return context


def _match(targeting: dict[str, Any], context: ClientContext) -> list[str] | None:
    """Возвращает причины показа или None, если новость не подходит клиенту.

    Каждый заданный критерий обязателен. Новость без таргетинга — общая.
    """
    reasons: list[str] = []
    prefixes = targeting.get("okved_prefixes") or []
    if prefixes:
        if not context.okved or not any(context.okved.startswith(prefix) for prefix in prefixes):
            return None
        reasons.append(f"Ваш вид деятельности: ОКВЭД {context.okved}")
    opf = targeting.get("opf") or []
    if opf:
        if context.opf not in opf:
            return None
        reasons.append("Для индивидуальных предпринимателей" if context.opf == "ИП" else "Для юридических лиц")
    max_age = targeting.get("max_age_months")
    if max_age is not None:
        if context.age_months is None or context.age_months > int(max_age):
            return None
        reasons.append(f"Молодой бизнес: до {int(max_age)} мес. с регистрации")
    statuses = targeting.get("statuses") or []
    if statuses:
        hit = [status for status in statuses if status in context.statuses]
        if not hit:
            return None
        reasons.append(f"Ваша заявка: {STATUS_LABELS.get(hit[0], hit[0]).lower()}")
    products = targeting.get("products") or []
    if products:
        hit = [code for code in products if code in context.products]
        if not hit:
            return None
        reasons.append(f"Вы оформляли «{context.products[hit[0]]}»")
    return reasons


def personal_feed(db: Session, context: ClientContext, limit: int = 20) -> list[dict[str, Any]]:
    items = db.scalars(
        select(NewsItem).where(NewsItem.is_active.is_(True)).order_by(NewsItem.published_at.desc())
    ).all()
    feed: list[dict[str, Any]] = []
    for item in items:
        reasons = _match(item.targeting or {}, context)
        if reasons is None:
            continue
        feed.append(
            {
                "id": item.id,
                "title": item.title,
                "body": item.body,
                "category": item.category,
                "published_at": item.published_at,
                "personal": bool(reasons),
                "reasons": reasons,
            }
        )
    # Персональные новости выше общих; внутри группы — по числу совпадений и свежести.
    feed.sort(key=lambda entry: (len(entry["reasons"]), entry["published_at"]), reverse=True)
    return feed[:limit]
