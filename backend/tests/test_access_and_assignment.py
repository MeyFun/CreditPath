from __future__ import annotations

import uuid

from sqlalchemy import update

from app.models import Application, ROLE_EMPLOYEE, User
from app.services.assignment import assign_reviewer, chain_reviewer_ids, pick_employee
from tests.conftest import login, make_application, user_by_name


def test_demo_hint_returns_accounts_and_password(client):
    response = client.get("/api/auth/demo-hint")
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["demo_mode"] is True
    assert "client1" in data["accounts"]
    assert data["password_hint"] == "DemoPass123!"


def test_client_cannot_see_other_clients_application(client, db):
    client1 = user_by_name(db, "client1")
    client2 = user_by_name(db, "client2")
    employee = user_by_name(db, "employee2")
    application = make_application(db, user=client1, status="IN_REVIEW", assigned=employee)
    headers = login(client, "client2")
    response = client.get(f"/api/client/applications/{application.id}", headers=headers)
    assert response.status_code == 404


def test_employee_only_sees_assigned_application(client, db):
    client_user = user_by_name(db, "client1")
    employee1 = user_by_name(db, "employee1")
    employee2 = user_by_name(db, "employee2")
    application = make_application(db, user=client_user, status="IN_REVIEW", assigned=employee2)

    other = client.get(f"/api/employee/applications/{application.id}", headers=login(client, "employee1"))
    assert other.status_code == 404

    assigned = client.get(f"/api/employee/applications/{application.id}", headers=login(client, "employee2"))
    assert assigned.status_code == 200
    assert assigned.json()["company_name"] == "ООО «Тестовая Компания»"


def test_admin_cannot_make_credit_decision(client, db):
    client_user = user_by_name(db, "client1")
    employee = user_by_name(db, "employee2")
    application = make_application(db, user=client_user, status="IN_REVIEW", assigned=employee)
    response = client.post(
        f"/api/employee/applications/{application.id}/decision",
        headers=login(client, "admin"),
        json={"action": "approve"},
    )
    assert response.status_code == 403


def test_employee_cannot_manage_users(client):
    response = client.get("/api/admin/users", headers=login(client, "employee1"))
    assert response.status_code == 403


def test_client_cannot_manage_users(client):
    response = client.get("/api/admin/users", headers=login(client, "client1"))
    assert response.status_code == 403


def test_employee_cannot_decide_own_application(client, db):
    employee = user_by_name(db, "employee1")
    application = make_application(db, user=employee, status="IN_REVIEW", assigned=employee)
    response = client.post(
        f"/api/employee/applications/{application.id}/decision",
        headers=login(client, "employee1"),
        json={"action": "approve"},
    )
    assert response.status_code == 403
    assert "собственную" in response.json()["detail"].lower()


def test_fresh_look_rule_blocks_chain_reviewer(client, db):
    client_user = user_by_name(db, "client1")
    employee = user_by_name(db, "employee1")
    previous = make_application(db, user=client_user, status="REJECTED", assigned=employee)
    previous.decision_by_id = employee.id
    db.commit()
    application = make_application(
        db, user=client_user, status="IN_REVIEW", assigned=employee, previous=previous
    )
    assert employee.id in chain_reviewer_ids(db, application)
    response = client.post(
        f"/api/employee/applications/{application.id}/decision",
        headers=login(client, "employee1"),
        json={"action": "reject", "comment": "Причина"},
    )
    assert response.status_code == 403
    assert "свежего взгляда" in response.json()["detail"].lower()


def test_decision_requires_comments_for_reject_and_need_info(client, db):
    client_user = user_by_name(db, "client1")
    employee = user_by_name(db, "employee2")
    application = make_application(db, user=client_user, status="IN_REVIEW", assigned=employee)
    response = client.post(
        f"/api/employee/applications/{application.id}/decision",
        headers=login(client, "employee2"),
        json={"action": "reject", "comment": ""},
    )
    assert response.status_code == 422
    response = client.post(
        f"/api/employee/applications/{application.id}/decision",
        headers=login(client, "employee2"),
        json={"action": "need_info", "comment": ""},
    )
    assert response.status_code == 422


def test_employee_approval_updates_status_and_creates_offer(client, db):
    client_user = user_by_name(db, "client1")
    employee = user_by_name(db, "employee2")
    application = make_application(db, user=client_user, status="IN_REVIEW", assigned=employee)
    response = client.post(
        f"/api/employee/applications/{application.id}/decision",
        headers=login(client, "employee2"),
        json={"action": "approve", "comment": "Проверено"},
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["status"] == "APPROVED"
    assert data["approved_amount"] == 1_000_000
    assert data["offer_expires_at"]


def test_admin_sees_all_and_audit_chain(client, db):
    client_user = user_by_name(db, "client1")
    employee = user_by_name(db, "employee2")
    make_application(db, user=client_user, status="IN_REVIEW", assigned=employee)
    response = client.get("/api/admin/applications", headers=login(client, "admin"))
    assert response.status_code == 200
    assert len(response.json()) > 0
    verify = client.get("/api/admin/audit/verify", headers=login(client, "admin"))
    assert verify.status_code == 200
    assert verify.json()["valid"] is True


def _make_employee(db, prefix: str) -> User:
    employee = User(
        username=f"test_{prefix}_{uuid.uuid4().hex[:6]}",
        password_hash="not-used",
        full_name=f"Тестовый {prefix}",
        role=ROLE_EMPLOYEE,
        is_active=True,
    )
    db.add(employee)
    db.commit()
    db.refresh(employee)
    return employee


def _deactivate_seeded_employees(db):
    rows = db.scalars(update(User).where(User.role == ROLE_EMPLOYEE).values(is_active=False).returning(User)).all()
    db.commit()
    return list(rows)


def test_assignment_round_robin_uses_min_load(db):
    seeded = _deactivate_seeded_employees(db)
    employees = [_make_employee(db, "rr1"), _make_employee(db, "rr2")]
    client_user = user_by_name(db, "client1")
    first = make_application(db, user=client_user, status="IN_REVIEW")
    assigned_first = assign_reviewer(db, first)
    db.commit()
    assert assigned_first is not None
    assert assigned_first.id in {item.id for item in employees}
    second = make_application(db, user=client_user, status="IN_REVIEW")
    assigned_second = assign_reviewer(db, second)
    db.commit()
    assert assigned_second is not None
    assert assigned_second.id != assigned_first.id
    db.execute(update(User).where(User.id.in_([item.id for item in seeded])).values(is_active=True))
    db.commit()


def test_assignment_excludes_author_and_chain_reviewer(db):
    _deactivate_seeded_employees(db)
    employee1 = _make_employee(db, "chain1")
    employee2 = _make_employee(db, "chain2")
    client_user = user_by_name(db, "client1")
    previous = make_application(db, user=client_user, status="REJECTED", assigned=employee1)
    current = make_application(
        db, user=client_user, status="IN_REVIEW", previous=previous
    )
    employee, reason = pick_employee(db, current, preferred_employee_id=employee1.id)
    assert reason is None
    assert employee is not None
    assert employee.id != employee1.id
    assert employee.id == employee2.id

    own = make_application(db, user=employee1, status="IN_REVIEW")
    picked, _ = pick_employee(db, own)
    assert picked is None or picked.id != employee1.id


def test_no_candidates_goes_to_admin_queue(db):
    _deactivate_seeded_employees(db)
    employee = _make_employee(db, "solo")
    application = make_application(db, user=employee, status="IN_REVIEW")
    assign_reviewer(db, application)
    db.commit()
    assert application.assigned_employee_id is None
    assert "администратора" in (application.queue_reason or "").lower()
