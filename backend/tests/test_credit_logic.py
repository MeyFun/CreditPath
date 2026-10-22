from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace

from app.services.credit_logic import evaluate_application
from app.services.scoring_config import load_default_config


def product(code="OBOROT", ratio="0.4", min_age=6, collateral=False):
    return SimpleNamespace(
        code=code,
        name="Тестовый продукт",
        min_amount=Decimal("300000"),
        max_amount=Decimal("30000000"),
        min_term_months=3,
        max_term_months=36,
        rate=Decimal("14.50"),
        min_business_age_months=min_age,
        requires_collateral=collateral,
        revenue_limit_ratio=Decimal(ratio),
        purposes=[],
    )


def application(amount=1_000_000, term=36, collateral=False):
    return SimpleNamespace(amount=Decimal(str(amount)), term_months=term, collateral=collateral)


def registry(**overrides):
    data = {
        "name": "ООО «Тест»",
        "status": "Действующая",
        "registration_date": "2014-01-01",
        "revenue": 10_000_000,
        "profit": 2_000_000,
        "okved": "46.73",
    }
    data.update(overrides)
    return data


def bki(**overrides):
    data = {
        "current_debt": 1_000_000,
        "active_overdue": False,
        "current_overdue_amount": 0,
        "closed_overdue_12m": False,
    }
    data.update(overrides)
    return data


def score(value):
    return {"score": value, "negative_reasons": ["Отрицательный фактор"], "positive_reasons": []}


def test_high_score_approved_as_requested():
    config = load_default_config()
    result = evaluate_application(
        application=application(),
        product=product(),
        registry=registry(),
        bki=bki(),
        scoring=score(85),
        config=config,
    )
    assert result["outcome"] == "approve"
    assert result["proposed_amount"] == 1_000_000
    assert result["proposed_term_months"] == 36


def test_middle_score_gets_changed_conditions_amount_capped_by_revenue():
    config = load_default_config()
    result = evaluate_application(
        application=application(amount=8_000_000, term=36),
        product=product(ratio="0.4"),
        registry=registry(revenue=10_000_000),
        bki=bki(),
        scoring=score(55),
        config=config,
    )
    assert result["outcome"] == "approve_changed"
    assert result["proposed_amount"] == 4_000_000
    assert result["proposed_amount"] < 8_000_000


def test_same_score_different_product_gives_different_conditions():
    config = load_default_config()
    base = dict(
        application=application(amount=8_000_000, term=36),
        registry=registry(revenue=10_000_000),
        bki=bki(),
        scoring=score(55),
        config=config,
    )
    first = evaluate_application(product=product("OBOROT", "0.4"), **base)
    second = evaluate_application(product=product("OVERDRAFT", "0.25"), **base)
    assert first["outcome"] == second["outcome"] == "approve_changed"
    assert first["proposed_amount"] != second["proposed_amount"]
    assert second["proposed_amount"] == 2_500_000


def test_low_score_rejected_with_reasons():
    config = load_default_config()
    result = evaluate_application(
        application=application(),
        product=product(),
        registry=registry(),
        bki=bki(),
        scoring=score(20),
        config=config,
    )
    assert result["outcome"] == "reject"
    assert result["reasons"]
    assert "ниже" in " ".join(result["reasons"]).lower()


def test_active_overdue_stop_factor_overrides_high_score():
    config = load_default_config()
    result = evaluate_application(
        application=application(),
        product=product(),
        registry=registry(),
        bki=bki(active_overdue=True, current_overdue_amount=250_000),
        scoring=score(95),
        config=config,
    )
    assert result["outcome"] == "reject"
    assert "active_overdue" in result["stop_factors"]


def test_inactive_company_stop_factor():
    config = load_default_config()
    result = evaluate_application(
        application=application(),
        product=product(),
        registry=registry(status="Ликвидирована"),
        bki=bki(),
        scoring=score(95),
        config=config,
    )
    assert result["outcome"] == "reject"
    assert "company_inactive" in result["stop_factors"]


def test_missing_financials_requests_info():
    config = load_default_config()
    result = evaluate_application(
        application=application(),
        product=product(),
        registry=registry(revenue=None, profit=None),
        bki=bki(),
        scoring=score(75),
        config=config,
    )
    assert result["outcome"] == "need_info"
    assert "финансов" in " ".join(result["reasons"]).lower()


def test_product_age_requirement():
    config = load_default_config()
    result = evaluate_application(
        application=application(),
        product=product(min_age=120),
        registry=registry(registration_date="2025-12-10"),
        bki=bki(),
        scoring=score(90),
        config=config,
    )
    assert result["outcome"] == "reject"
    assert "product_age" in result["stop_factors"]
