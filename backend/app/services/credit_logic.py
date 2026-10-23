from __future__ import annotations

import math
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any

from ..models import Application, Product


def _months_since(registration_date: str | None) -> int | None:
    if not registration_date:
        return None
    try:
        registered = date.fromisoformat(registration_date[:10])
    except ValueError:
        return None
    today = date.today()
    return max(0, (today.year - registered.year) * 12 + today.month - registered.month - (1 if today.day < registered.day else 0))


def _has_financials(registry: dict[str, Any]) -> bool:
    return registry.get("revenue") is not None and registry.get("profit") is not None


def _round_amount(value: float) -> int:
    return max(0, int(math.floor(value / 100_000) * 100_000))


def evaluate_application(
    *,
    application: Application,
    product: Product,
    registry: dict[str, Any] | None,
    bki: dict[str, Any] | None,
    scoring: dict[str, Any],
    config: dict[str, Any],
) -> dict[str, Any]:
    """Отдельный слой кредитной логики: стоп-факторы, правила банка и предложение."""
    registry = registry or {}
    bki = bki or {}
    score = int(scoring["score"])
    decision_cfg = config["decision"]
    approve_threshold = int(decision_cfg["approve_threshold"])
    changed_threshold = int(decision_cfg["changed_threshold"])
    reasons: list[str] = []
    stop_factors: list[str] = []
    requested_amount = float(application.amount)
    requested_term = int(application.term_months)
    rate = float(product.rate)

    if not registry:
        return _result("reject", "Компания не найдена в реестре", ["Не удалось подтвердить компанию по ИНН."], score, 0, requested_term, rate, product, ["registry_not_found"])

    status = str(registry.get("status", "")).lower()
    if status != "действующая":
        stop_factors.append("company_inactive")
        return _result(
            "reject",
            "Компания не может получить финансирование",
            [f"Статус компании в реестре: «{registry.get('status', 'не подтверждён')}». Финансирование доступно только действующим компаниям."],
            score,
            0,
            requested_term,
            rate,
            product,
            stop_factors,
        )

    active_overdue = bool(bki.get("active_overdue")) or float(bki.get("current_overdue_amount") or 0) > 0
    if active_overdue:
        stop_factors.append("active_overdue")
        return _result(
            "reject",
            "Одобрение невозможно из-за просроченной задолженности",
            [
                "В кредитной истории есть активная просрочка.",
                "После полного погашения просроченной задолженности можно подать заявку повторно.",
            ],
            score,
            0,
            requested_term,
            rate,
            product,
            stop_factors,
        )

    if not _has_financials(registry):
        reasons.append("Не хватает финансовых показателей: выручки и прибыли за последний год.")
        reasons.append("Укажите выручку и прибыль за последний год в ответе на запрос — после этого проверки продолжатся автоматически.")
        return _result("need_info", "Нужны дополнительные данные", reasons, score, 0, requested_term, rate, product, [])

    age_months = _months_since(registry.get("registration_date"))
    if age_months is not None and age_months < int(product.min_business_age_months):
        return _result(
            "reject",
            "Не выполнено требование продукта",
            [
                f"Минимальный возраст бизнеса для продукта «{product.name}» — {product.min_business_age_months} мес.",
                f"Возраст компании по реестру — {age_months} мес.",
            ],
            score,
            0,
            requested_term,
            rate,
            product,
            ["product_age"],
        )

    if product.requires_collateral and not application.collateral:
        return _result(
            "reject",
            "Не выполнено требование продукта",
            [f"Для продукта «{product.name}» необходимо обеспечение."],
            score,
            0,
            requested_term,
            rate,
            product,
            ["collateral_required"],
        )

    revenue = float(registry.get("revenue") or 0)
    amount_limit = max(_round_amount(revenue * float(product.revenue_limit_ratio)), int(product.min_amount))

    if score >= approve_threshold and requested_amount <= amount_limit:
        reasons.append(f"Оценка {score} из 100 — выше порога одобрения {approve_threshold}.")
        reasons.append("Стоп-факторы не выявлены, финансовые показатели подтверждены.")
        return _result(
            "approve",
            "Одобрено",
            reasons,
            score,
            requested_amount,
            requested_term,
            rate,
            product,
            [],
        )

    if score >= changed_threshold:
        proposed_amount = min(requested_amount, amount_limit)
        proposed_term = min(requested_term, int(decision_cfg["changed_term_cap_months"]), int(product.max_term_months))
        proposed_term = max(proposed_term, int(product.min_term_months))

        if score >= approve_threshold:
            reasons.append(f"Оценка {score} из 100 выше порога одобрения, но запрошенная сумма превышает лимит к выручке.")
        else:
            reasons.append(f"Оценка {score} из 100 находится в диапазоне {changed_threshold}–{approve_threshold - 1}: банк готов одобрить на скорректированных условиях.")
        if proposed_amount < requested_amount:
            reasons.append(
                f"Сумма снижена с {requested_amount:,.0f} ₽ до {proposed_amount:,.0f} ₽: комфортный лимит привязан к годовой выручке и продукту."
            )
        if proposed_term != requested_term:
            reasons.append(f"Срок скорректирован с {requested_term} до {proposed_term} мес. для снижения риска.")
        if proposed_amount == requested_amount and proposed_term == requested_term:
            proposed_amount = max(int(product.min_amount), _round_amount(requested_amount * 0.9))
            reasons.append(
                f"Сумма скорректирована до {proposed_amount:,.0f} ₽, чтобы привести риск к допустимому уровню."
            )
        top_negative = scoring.get("negative_reasons", [])[:2]
        reasons.extend(top_negative)
        return _result(
            "approve_changed",
            "Одобрено на других условиях",
            reasons,
            score,
            proposed_amount,
            proposed_term,
            rate,
            product,
            [],
        )

    reasons.append(f"Оценка {score} из 100 ниже минимального порога {changed_threshold}.")
    reasons.extend(scoring.get("negative_reasons", [])[:4])
    reasons.append("Можно устранить замечания и подать заявку повторно.")
    return _result("reject", "Отказ", reasons, score, 0, requested_term, rate, product, [])


def _result(
    outcome: str,
    summary: str,
    reasons: list[str],
    score: int,
    amount: float,
    term: int,
    rate: float,
    product: Product,
    stop_factors: list[str],
) -> dict[str, Any]:
    return {
        "outcome": outcome,
        "summary": summary,
        "reasons": reasons,
        "score": score,
        "proposed_amount": round(amount, 2),
        "proposed_term_months": int(term),
        "proposed_rate": round(rate, 2),
        "product_code": product.code,
        "product_name": product.name,
        "stop_factors": stop_factors,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "requires_human": True,
    }
