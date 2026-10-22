from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.services.inn import generate_inn, validate_inn
from app.services.scoring import calculate_score
from app.services.scoring_config import load_default_config


@pytest.mark.parametrize(
    "inn,expected",
    [
        ("9900000017", True),
        ("9900000024", True),
        ("9900000031", True),
        ("990000001246", True),
        ("9900000018", False),
        ("990000001", False),
        ("990000001X", False),
        ("", False),
    ],
)
def test_inn_validation(inn, expected):
    valid, _ = validate_inn(inn)
    assert valid is expected


def test_inn_generation_produces_valid_checksum():
    for base in ("990000001", "990000002", "770123456"):
        generated = generate_inn(base)
        assert len(generated) == 10
        assert validate_inn(generated)[0]
    for base in ("9900000012", "7701234567"):
        generated = generate_inn(base, "individual")
        assert len(generated) == 12
        assert validate_inn(generated)[0]


def test_inn_checksum_specific_error():
    valid, message = validate_inn("9900000018")
    assert not valid
    assert "контрольная сумма" in message.lower()


def base_registry(**overrides):
    data = {
        "registration_date": "2012-01-01",
        "revenue": 10_000_000,
        "profit": 2_000_000,
        "okved": "46.73",
        "status": "Действующая",
    }
    data.update(overrides)
    return data


def base_bki(**overrides):
    data = {
        "current_debt": 1_000_000,
        "active_overdue": False,
        "current_overdue_amount": 0,
        "closed_overdue_12m": False,
    }
    data.update(overrides)
    return data


def factor(result, code):
    return next(item for item in result["factors"] if item["code"] == code)


def test_age_factor_variants():
    config = load_default_config()
    young = base_registry(registration_date=(date.today() - timedelta(days=200)).isoformat())
    result = calculate_score(registry=young, bki=base_bki(), amount=1_000_000, collateral=False, config=config)
    assert factor(result, "age")["points"] == -15

    middle = base_registry(registration_date="2021-01-01")
    result = calculate_score(registry=middle, bki=base_bki(), amount=1_000_000, collateral=False, config=config)
    assert factor(result, "age")["points"] == 8

    old = base_registry(registration_date="2012-01-01")
    result = calculate_score(registry=old, bki=base_bki(), amount=1_000_000, collateral=False, config=config)
    assert factor(result, "age")["points"] == 15


def test_amount_ratio_and_debt_factors():
    config = load_default_config()
    result = calculate_score(
        registry=base_registry(revenue=10_000_000, profit=2_000_000),
        bki=base_bki(current_debt=6_000_000),
        amount=8_000_000,
        collateral=False,
        config=config,
    )
    assert factor(result, "amount_to_revenue")["points"] == -15
    assert factor(result, "debt_load")["points"] == -15

    result = calculate_score(
        registry=base_registry(revenue=10_000_000, profit=2_000_000),
        bki=base_bki(current_debt=500_000),
        amount=1_000_000,
        collateral=False,
        config=config,
    )
    assert factor(result, "amount_to_revenue")["points"] == 10
    assert factor(result, "debt_load")["points"] == 5


def test_profit_bki_okved_collateral_factors():
    config = load_default_config()
    result = calculate_score(
        registry=base_registry(profit=-100_000, revenue=10_000_000, okved="92.00"),
        bki=base_bki(active_overdue=True, current_overdue_amount=500_000),
        amount=1_000_000,
        collateral=True,
        config=config,
    )
    assert factor(result, "profit")["points"] == -20
    assert factor(result, "bki_overdue")["points"] == -35
    assert factor(result, "okved")["points"] == -10
    assert factor(result, "collateral")["points"] == 5

    result = calculate_score(
        registry=base_registry(profit=3_000_000, revenue=10_000_000),
        bki=base_bki(closed_overdue_12m=True),
        amount=1_000_000,
        collateral=False,
        config=config,
    )
    assert factor(result, "profit")["points"] == 10
    assert factor(result, "bki_overdue")["points"] == -15

    result = calculate_score(
        registry=base_registry(),
        bki=base_bki(),
        amount=1_000_000,
        collateral=False,
        config=config,
    )
    assert factor(result, "bki_overdue")["points"] == 10


def test_score_is_bounded_and_missing_financials_no_ratio_points():
    config = load_default_config()
    result = calculate_score(
        registry=base_registry(revenue=None, profit=None),
        bki={"credit_history_found": False},
        amount=1_000_000,
        collateral=False,
        config=config,
    )
    assert 0 <= result["score"] <= 100
    assert factor(result, "profit")["points"] == 0
    assert factor(result, "bki_overdue")["points"] == 0
    assert "финансовая" in factor(result, "profit")["reason"].lower() or "отчётность" in factor(result, "profit")["reason"].lower()
