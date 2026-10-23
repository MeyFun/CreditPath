from __future__ import annotations

import uuid

from sqlalchemy import select, update

from app.models import Application, AuditLog, ROLE_EMPLOYEE, User
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


def test_admin_changes_role_and_action_is_audited(client, db):
    employee = user_by_name(db, "employee3")
    admin_headers = login(client, "admin")
    response = client.patch(
        f"/api/admin/users/{employee.id}/role",
        headers=admin_headers,
        json={"role": "client"},
    )
    assert response.status_code == 200
    assert response.json()["role"] == "client"
    audit = client.get("/api/admin/audit?action=user.role_changed", headers=admin_headers)
    assert audit.status_code == 200
    assert any(str(item["entity_id"]) == str(employee.id) for item in audit.json())
    restore = client.patch(
        f"/api/admin/users/{employee.id}/role",
        headers=admin_headers,
        json={"role": "employee"},
    )
    assert restore.status_code == 200


def test_swagger_docs_use_only_local_assets(client):
    response = client.get("/docs")
    assert response.status_code == 200
    assert "/static/swagger/swagger-ui-bundle.js" in response.text
    assert "cdn.jsdelivr.net" not in response.text


def test_client_cannot_manage_users(client):
    response = client.get("/api/admin/users", headers=login(client, "client1"))
    assert response.status_code == 403


def test_employee_cannot_access_own_application_in_service_workspace(client, db):
    employee = user_by_name(db, "employee1")
    application = make_application(db, user=employee, status="IN_REVIEW", assigned=employee)
    headers = login(client, "employee1")

    detail = client.get(f"/api/employee/applications/{application.id}", headers=headers)
    assert detail.status_code == 404

    queue = client.get("/api/employee/applications?scope=mine", headers=headers)
    assert queue.status_code == 200
    assert all(item["id"] != application.id for item in queue.json())

    decision = client.post(
        f"/api/employee/applications/{application.id}/decision",
        headers=headers,
        json={"action": "approve"},
    )
    assert decision.status_code == 404
    assert "назначенных" in decision.json()["detail"].lower()


def test_employee_and_admin_have_client_cabinet(client, db):
    product = client.get("/api/public/products").json()[0]
    for username in ("employee1", "admin"):
        headers = login(client, username)
        dashboard = client.get("/api/client/dashboard", headers=headers)
        assert dashboard.status_code == 200, dashboard.text

        created = client.post(
            "/api/client/applications",
            headers=headers,
            json={
                "product_id": product["id"],
                "amount": 1_000_000,
                "term_months": 12,
                "purpose": product["purposes"][0]["code"],
                "company_inn": "9900000017",
                "company_name": "ООО «Северный Ветер»",
                "collateral": False,
            },
        )
        assert created.status_code == 201, created.text
        application_id = created.json()["id"]

        detail = client.get(f"/api/client/applications/{application_id}", headers=headers)
        assert detail.status_code == 200
        assert detail.json()["company_name"] == "ООО «Северный Ветер»"

        mine = client.get("/api/client/applications", headers=headers)
        assert mine.status_code == 200
        assert any(item["id"] == application_id for item in mine.json())
        expected_user = user_by_name(db, username)
        assert all(
            db.get(Application, item["id"]).user_id == expected_user.id for item in mine.json()
        )


def test_admin_cannot_approve_own_client_application(client, db):
    admin = user_by_name(db, "admin")
    employee = user_by_name(db, "employee2")
    application = make_application(db, user=admin, status="IN_REVIEW", assigned=employee)

    forbidden = client.post(
        f"/api/employee/applications/{application.id}/decision",
        headers=login(client, "admin"),
        json={"action": "approve"},
    )
    assert forbidden.status_code == 403

    allowed = client.post(
        f"/api/employee/applications/{application.id}/decision",
        headers=login(client, "employee2"),
        json={"action": "approve", "comment": "Проверено сотрудником"},
    )
    assert allowed.status_code == 200, allowed.text
    assert allowed.json()["status"] == "APPROVED"


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


def test_low_score_approval_creates_separate_risk_audit_event(client, db):
    client_user = user_by_name(db, "client1")
    employee = user_by_name(db, "employee2")
    application = make_application(
        db, user=client_user, status="IN_REVIEW", assigned=employee, score=50
    )
    application.decision_draft = {
        "outcome": "reject",
        "summary": "Отказ",
        "reasons": ["Есть активная просрочка", "Низкий скоринг"],
        "stop_factors": ["active_overdue"],
    }
    db.commit()

    response = client.post(
        f"/api/employee/applications/{application.id}/decision",
        headers=login(client, "employee2"),
        json={"action": "approve", "comment": "Одобрено под ответственность сотрудника"},
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["status"] == "APPROVED"
    assert any(event["event_type"] == "RISK_OVERRIDE" for event in data["events"])

    risk_audit = db.scalar(
        select(AuditLog).where(
            AuditLog.action == "application.risk_override",
            AuditLog.entity_id == str(application.id),
        )
    )
    assert risk_audit is not None
    reasons = " ".join(risk_audit.after["reasons"]).lower()
    assert "активная просроченная задолженность" in reasons
    assert "50/100" in reasons


def test_normal_approval_does_not_create_risk_override(client, db):
    client_user = user_by_name(db, "client1")
    employee = user_by_name(db, "employee2")
    application = make_application(
        db, user=client_user, status="IN_REVIEW", assigned=employee, score=88
    )
    application.decision_draft = {
        "outcome": "approve",
        "summary": "Одобрено",
        "reasons": ["Проверки пройдены"],
        "stop_factors": [],
    }
    db.commit()

    response = client.post(
        f"/api/employee/applications/{application.id}/decision",
        headers=login(client, "employee2"),
        json={"action": "approve", "comment": "Проверено"},
    )
    assert response.status_code == 200
    assert not any(event["event_type"] == "RISK_OVERRIDE" for event in response.json()["events"])
    risk_audit = db.scalar(
        select(AuditLog).where(
            AuditLog.action == "application.risk_override",
            AuditLog.entity_id == str(application.id),
        )
    )
    assert risk_audit is None


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
