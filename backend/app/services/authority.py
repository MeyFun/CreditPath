"""Полномочия заявителя действовать от имени компании.

Как в банках: руководитель или учредитель из ЕГРЮЛ/ЕГРИП подтверждается автоматически
по реестру, остальные прикладывают доверенность (МЧД), которую проверяет сотрудник.
"""

from __future__ import annotations

from fastapi import HTTPException

from ..models import Application, User

PROFILE = "profile"
REGISTRY = "registry"
POWER_OF_ATTORNEY = "power_of_attorney"

AUTHORITY_LABELS = {
    PROFILE: "Компания из профиля клиента",
    REGISTRY: "Руководитель или учредитель по ЕГРЮЛ",
    POWER_OF_ATTORNEY: "Доверенность (МЧД) — требует проверки сотрудником",
}


def _normalize(name: str | None) -> str:
    return " ".join((name or "").lower().replace("ё", "е").split())


def resolve_authority(user: User, application: Application, registry: dict | None) -> str:
    """Возвращает основание полномочий или 422, если подтвердить их нечем."""
    if user.company_inn and application.company_inn == user.company_inn:
        return PROFILE
    if registry:
        people = [registry.get("director")] + [item.get("name") for item in registry.get("founders") or []]
        if _normalize(user.full_name) in {_normalize(person) for person in people if person}:
            return REGISTRY
    if application.authority_document_id:
        return POWER_OF_ATTORNEY
    company = application.company_name or application.company_inn
    raise HTTPException(
        status_code=422,
        detail=(
            f"Вы не указаны руководителем или учредителем «{company}» в реестре. "
            "Приложите доверенность (МЧД) — её проверит сотрудник банка."
        ),
    )
