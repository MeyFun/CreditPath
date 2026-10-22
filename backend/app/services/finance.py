from __future__ import annotations

import math


def annuity_payment(amount: float, annual_rate: float, term_months: int) -> float:
    """Ежемесячный аннуитетный платёж."""
    if term_months <= 0:
        raise ValueError("Срок должен быть больше нуля")
    monthly_rate = annual_rate / 100 / 12
    if monthly_rate == 0:
        return amount / term_months
    coefficient = monthly_rate / (1 - math.pow(1 + monthly_rate, -term_months))
    return amount * coefficient


def payment_schedule(amount: float, annual_rate: float, term_months: int) -> dict[str, float]:
    payment = annuity_payment(amount, annual_rate, term_months)
    total = payment * term_months
    return {
        "monthly_payment": round(payment, 2),
        "total_payment": round(total, 2),
        "overpayment": round(total - amount, 2),
        "amount": round(amount, 2),
        "rate": annual_rate,
        "term_months": term_months,
    }
