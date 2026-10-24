from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any


def age_months(registration_date: str | None) -> int | None:
    if not registration_date:
        return None
    try:
        registered = date.fromisoformat(registration_date[:10])
    except ValueError:
        return None
    today = date.today()
    return max(0, (today.year - registered.year) * 12 + today.month - registered.month - (1 if today.day < registered.day else 0))


def _money(value: Any) -> float | None:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def calculate_score(
    *,
    registry: dict[str, Any] | None,
    bki: dict[str, Any] | None,
    amount: float,
    collateral: bool,
    config: dict[str, Any],
) -> dict[str, Any]:
    """Прозрачная факторная модель. Возвращает балл, факторы и объяснения."""
    registry = registry or {}
    bki = bki or {}
    factors: list[dict[str, Any]] = []

    def add(code: str, label: str, points: float, reason: str, value: Any | None = None) -> None:
        factors.append(
            {
                "code": code,
                "label": label,
                "points": round(float(points), 2),
                "reason": reason,
                "value": value,
            }
        )

    base = float(config.get("base_score", 50))
    add("base", "Базовая оценка", base, "Стартовая оценка профиля", base)

    age_cfg = config["age"]
    months = age_months(registry.get("registration_date"))
    if months is None:
        add("age", "Возраст бизнеса", 0, "Дата регистрации не получена — фактор не применён")
    elif months < 12:
        add("age", "Возраст бизнеса", age_cfg["lt_1_year"], f"Бизнес работает менее 1 года ({months} мес.)", months)
    elif months > 84:
        add("age", "Возраст бизнеса", age_cfg["gt_7_years"], f"Бизнес работает более 7 лет ({months // 12} лет)", months)
    elif months >= 36:
        add("age", "Возраст бизнеса", age_cfg["from_3_to_7_years"], f"Бизнес работает от 3 до 7 лет ({months // 12} лет)", months)
    else:
        add("age", "Возраст бизнеса", 0, f"Бизнес работает {months} мес. — нейтрально", months)

    revenue = _money(registry.get("revenue"))
    profit = _money(registry.get("profit"))
    debt = _money(bki.get("current_debt"))

    ratio_cfg = config["amount_to_revenue"]
    if revenue is None or revenue <= 0:
        add("amount_to_revenue", "Сумма к выручке", 0, "Выручка не подтверждена — коэффициент не рассчитан")
    else:
        ratio = amount / revenue
        if ratio > float(ratio_cfg["high_threshold"]):
            add(
                "amount_to_revenue",
                "Сумма к выручке",
                ratio_cfg["high_penalty"],
                f"Запрошенная сумма — {ratio:.0%} годовой выручки, это выше порога {float(ratio_cfg['high_threshold']):.0%}",
                round(ratio, 3),
            )
        elif ratio < float(ratio_cfg["low_threshold"]):
            add(
                "amount_to_revenue",
                "Сумма к выручке",
                ratio_cfg["low_bonus"],
                f"Запрошенная сумма — {ratio:.0%} годовой выручки, комфортная нагрузка",
                round(ratio, 3),
            )
        else:
            add("amount_to_revenue", "Сумма к выручке", 0, f"Сумма — {ratio:.0%} выручки, в допустимом диапазоне", round(ratio, 3))

    profit_cfg = config["profit"]
    if revenue is None or profit is None:
        add("profit", "Прибыль и рентабельность", 0, "Финансовая отчётность не предоставлена")
    elif profit < 0:
        add("profit", "Прибыль и рентабельность", profit_cfg["loss_penalty"], "По данным отчётности компания убыточна", round(profit, 2))
    else:
        margin = profit / revenue * 100 if revenue > 0 else 0
        if margin > float(profit_cfg["margin_threshold_percent"]):
            add(
                "profit",
                "Прибыль и рентабельность",
                profit_cfg["margin_bonus"],
                f"Рентабельность {margin:.1f}% выше порога {float(profit_cfg['margin_threshold_percent']):.0f}%",
                round(margin, 2),
            )
        else:
            add("profit", "Прибыль и рентабельность", 0, f"Рентабельность {margin:.1f}% — без корректировки", round(margin, 2))

    bki_cfg = config["bki"]
    active_overdue = bool(bki.get("active_overdue")) or (_money(bki.get("current_overdue_amount")) or 0) > 0
    closed_recent = bool(bki.get("closed_overdue_12m"))
    if not bki or bki.get("credit_history_found") is False:
        add("bki_overdue", "Просрочки по данным БКИ", 0, "Кредитная история не найдена — фактор не применён")
    elif active_overdue:
        days = bki.get("max_overdue_days")
        add(
            "bki_overdue",
            "Просрочки по данным БКИ",
            bki_cfg["active_overdue_penalty"],
            f"Есть активная просрочка{f' глубиной {days} дн.' if days else ''}",
            days,
        )
    elif closed_recent:
        add(
            "bki_overdue",
            "Просрочки по данным БКИ",
            bki_cfg["closed_overdue_recent_penalty"],
            f"Просрочка была закрыта за последние {bki_cfg['recent_months']} мес.",
        )
    else:
        add("bki_overdue", "Просрочки по данным БКИ", bki_cfg["no_overdue_bonus"], "Активных и недавно закрытых просрочек нет")

    debt_cfg = config["debt_load"]
    if revenue is None or revenue <= 0 or debt is None:
        add("debt_load", "Долговая нагрузка", 0, "Недостаточно данных для расчёта долговой нагрузки")
    else:
        debt_ratio = debt / revenue
        if debt_ratio > float(debt_cfg["high_threshold"]):
            add(
                "debt_load",
                "Долговая нагрузка",
                debt_cfg["high_penalty"],
                f"Обязательства — {debt_ratio:.0%} выручки, выше безопасного порога",
                round(debt_ratio, 3),
            )
        elif debt_ratio < float(debt_cfg["low_threshold"]):
            add(
                "debt_load",
                "Долговая нагрузка",
                debt_cfg["low_bonus"],
                f"Обязательства — {debt_ratio:.0%} выручки, низкая нагрузка",
                round(debt_ratio, 3),
            )
        else:
            add("debt_load", "Долговая нагрузка", 0, f"Обязательства — {debt_ratio:.0%} выручки", round(debt_ratio, 3))

    okved_cfg = config["okved"]
    okved = str(registry.get("okved") or "")
    if any(okved.startswith(str(prefix)) for prefix in okved_cfg["risky_prefixes"]):
        add("okved", "Отраслевой риск", okved_cfg["penalty"], f"ОКВЭД {okved} отнесён к рискованным", okved)
    else:
        add("okved", "Отраслевой риск", 0, f"ОКВЭД {okved or 'не указан'} не входит в рискованные", okved)

    if collateral:
        add("collateral", "Обеспечение", config["collateral"]["bonus"], "Предоставлено обеспечение по заявке")
    else:
        add("collateral", "Обеспечение", 0, "Заявка без обеспечения")

    score = int(round(max(0, min(100, sum(factor["points"] for factor in factors)))))
    negatives = [factor for factor in factors if factor["points"] < 0]
    positives = [factor for factor in factors if factor["points"] > 0]
    return {
        "score": score,
        "factors": factors,
        "reasons": [factor["reason"] for factor in factors if factor["code"] != "base"],
        "negative_reasons": [factor["reason"] for factor in negatives],
        "positive_reasons": [factor["reason"] for factor in positives],
        "calculated_at": datetime.now(timezone.utc).isoformat(),
    }
