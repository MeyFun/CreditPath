from __future__ import annotations

from app.models import ApplicationEvent, Notification
from app.security import login_rate_limiter
from app.services.credit_logic import evaluate_application
from app.services.inn import validate_inn
from app.services.scoring_config import load_default_config
from sqlalchemy import select

import pytest

from tests.conftest import login, make_application, user_by_name
from tests.test_credit_logic import application, bki, product, registry, score


@pytest.fixture(autouse=True)
def active_seeded_employees(db):
    # Соседние тесты назначения временно выключают сид-сотрудников.
    for username in ("employee1", "employee2", "employee3"):
        user_by_name(db, username).is_active = True
    db.commit()


def _add_internal_events(db, app):
    db.add(ApplicationEvent(application_id=app.id, event_type="SCORING_COMPLETED", actor_role="system",
                            comment="Скоринг завершён: 55 из 100.", details={"score": 55, "factors": []}))
    db.add(ApplicationEvent(application_id=app.id, event_type="APPLICATION_SUBMITTED", actor_role="client",
                            comment="Заявка отправлена.", details={"idempotency_key": "x"}))
    db.commit()


def test_client_does_not_see_internal_events_or_draft(client, db):
    client1 = user_by_name(db, "client1")
    app = make_application(db, user=client1, status="IN_REVIEW", score=55)
    app.decision_draft = {"outcome": "reject", "summary": "Отказ", "reasons": ["Внутренняя причина"], "stop_factors": []}
    db.commit()
    _add_internal_events(db, app)

    body = client.get(f"/api/client/applications/{app.id}", headers=login(client, "client1")).json()
    types = {event["event_type"] for event in body["events"]}
    assert "SCORING_COMPLETED" not in types
    assert "APPLICATION_SUBMITTED" in types
    assert all(event["details"] is None for event in body["events"])
    assert body["decision_draft"] is None
    assert body["scoring"] is None


def test_reviewer_sees_previous_decisions(client, db):
    client1 = user_by_name(db, "client1")
    employee1 = user_by_name(db, "employee1")
    employee2 = user_by_name(db, "employee2")
    previous = make_application(db, user=client1, status="REJECTED", assigned=employee1)
    previous.decision_by_id = employee1.id
    previous.employee_comment = "Высокая долговая нагрузка"
    db.commit()
    current = make_application(db, user=client1, status="IN_REVIEW", assigned=employee2, previous=previous)

    body = client.get(f"/api/employee/applications/{current.id}", headers=login(client, "employee2")).json()
    assert body["previous_decisions"][0]["employee_comment"] == "Высокая долговая нагрузка"
    assert body["previous_decisions"][0]["decided_by"]["id"] == employee1.id


def test_approve_changed_can_offer_other_product_and_validates_amount(client, db):
    client1 = user_by_name(db, "client1")
    employee2 = user_by_name(db, "employee2")
    headers = login(client, "employee2")
    equipment = next(p for p in client.get("/api/public/products").json() if p["code"] == "EQUIPMENT")

    app = make_application(db, user=client1, status="IN_REVIEW", assigned=employee2)
    too_much = client.post(f"/api/employee/applications/{app.id}/decision", headers=headers,
                           json={"action": "approve_changed", "approved_amount": 2_000_000, "approved_term_months": 12})
    assert too_much.status_code == 422
    same = client.post(f"/api/employee/applications/{app.id}/decision", headers=headers,
                       json={"action": "approve_changed", "approved_amount": 1_000_000, "approved_term_months": 12})
    assert same.status_code == 422

    switched = client.post(f"/api/employee/applications/{app.id}/decision", headers=headers,
                           json={"action": "approve_changed", "product_id": equipment["id"],
                                 "approved_amount": 1_000_000, "approved_term_months": 24})
    assert switched.status_code == 200, switched.text
    assert switched.json()["product"]["code"] == "EQUIPMENT"
    assert switched.json()["status"] == "APPROVED_CHANGED"


def test_client_notification_reflects_employee_decision(client, db):
    client1 = user_by_name(db, "client1")
    employee2 = user_by_name(db, "employee2")
    app = make_application(db, user=client1, status="IN_REVIEW", assigned=employee2, score=80)
    app.decision_draft = {"outcome": "reject", "summary": "Отказ", "reasons": [], "stop_factors": []}
    db.commit()
    response = client.post(f"/api/employee/applications/{app.id}/decision", headers=login(client, "employee2"),
                           json={"action": "approve", "comment": "Одобряю"})
    assert response.status_code == 200, response.text
    note = db.scalars(
        select(Notification).where(Notification.application_id == app.id).order_by(Notification.id.desc())
    ).first()
    assert "одобрено" in note.body.lower()
    assert "отказ" not in note.body.lower()


def test_high_score_still_capped_by_revenue_limit():
    result = evaluate_application(
        application=application(amount=4_500_000, term=24),
        product=product(ratio="0.4"),
        registry=registry(revenue=10_000_000),
        bki=bki(),
        scoring=score(85),
        config=load_default_config(),
    )
    assert result["outcome"] == "approve_changed"
    assert result["proposed_amount"] <= 4_000_000


def test_inn_rejects_non_ascii_digits():
    assert validate_inn("99000000²7")[0] is False
    assert validate_inn("٩٩٠٠٠٠٠٠١٧")[0] is False
    assert validate_inn(" 9900000017 ")[0] is True


def test_client_can_fix_inn_when_answering_request(client, db, monkeypatch):
    import app.api.client as client_api

    monkeypatch.setattr(client_api, "run_pipeline", lambda *args, **kwargs: None)
    client1 = user_by_name(db, "client1")
    app = make_application(db, user=client1, status="NEED_INFO")
    headers = login(client, "client1")
    bad = client.post(f"/api/client/applications/{app.id}/respond", headers=headers,
                      json={"comment": "Исправил ИНН", "company_inn": "9900000018"})
    assert bad.status_code == 422
    ok = client.post(f"/api/client/applications/{app.id}/respond", headers=headers,
                     json={"comment": "Исправил ИНН", "company_inn": "9900000031"})
    assert ok.status_code == 202, ok.text
    db.refresh(app)
    assert app.company_inn == "9900000031"


def test_payment_schedule_rejects_infinity(client):
    response = client.get("/api/public/payment-schedule?amount=inf&rate=14&term_months=12")
    assert response.status_code == 422


def test_login_rate_limit_counts_per_username_regardless_of_ip(client):
    try:
        for index in range(5):
            client.post("/api/auth/login", json={"username": "client2", "password": "wrong"},
                        headers={"X-Forwarded-For": f"10.0.0.{index}"})
        blocked = client.post("/api/auth/login", json={"username": "client2", "password": "wrong"},
                              headers={"X-Forwarded-For": "10.0.0.99"})
        assert blocked.status_code == 429
    finally:
        login_rate_limiter._attempts.clear()
