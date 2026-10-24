from __future__ import annotations

from app.models import Application
from tests.conftest import login, make_application, user_by_name

SUBMIT = {"signer_position": "ceo", "authority_confirmed": True, "consent_bki": True, "consent_personal_data": True}
PDF = ("dover.pdf", b"%PDF-1.4 test", "application/pdf")


def stub_registry(monkeypatch, director: str):
    import app.api.client as client_api

    monkeypatch.setattr(client_api, "run_pipeline", lambda *args, **kwargs: None)
    monkeypatch.setattr(client_api, "fetch_registry", lambda inn: {"name": "ООО «Чужая»", "director": director})


def foreign_draft(db, username: str = "client1", inn: str = "9900000031") -> Application:
    draft = make_application(db, user=user_by_name(db, username))
    draft.company_inn = inn
    db.commit()
    return draft


def test_profile_company_is_trusted(client, db, monkeypatch):
    stub_registry(monkeypatch, "Кто-то Другой")
    draft = make_application(db, user=user_by_name(db, "client1"))

    response = client.post(f"/api/client/applications/{draft.id}/submit", headers=login(client, "client1"), json=SUBMIT)

    assert response.status_code == 202, response.text
    assert response.json()["authority_basis"] == "profile"


def test_foreign_company_without_power_of_attorney_is_rejected(client, db, monkeypatch):
    stub_registry(monkeypatch, "Орлов Денис Павлович")
    draft = foreign_draft(db)

    response = client.post(f"/api/client/applications/{draft.id}/submit", headers=login(client, "client1"), json=SUBMIT)

    assert response.status_code == 422
    assert "доверенность" in response.json()["detail"]
    db.expire_all()
    assert db.get(Application, draft.id).status == "DRAFT"


def test_director_by_registry_is_accepted(client, db, monkeypatch):
    stub_registry(monkeypatch, "СМИРНОВ  Артем Владимирович")
    draft = foreign_draft(db, inn="9900000024")

    response = client.post(f"/api/client/applications/{draft.id}/submit", headers=login(client, "client1"), json=SUBMIT)

    assert response.status_code == 202, response.text
    assert response.json()["authority_basis"] == "registry"


def test_power_of_attorney_needs_employee_check(client, db, monkeypatch):
    stub_registry(monkeypatch, "Орлов Денис Павлович")
    draft = foreign_draft(db)
    headers = login(client, "client1")
    upload = client.post(
        f"/api/client/applications/{draft.id}/documents?purpose=power_of_attorney", headers=headers, files={"file": PDF}
    )
    assert upload.status_code == 201, upload.text

    submitted = client.post(f"/api/client/applications/{draft.id}/submit", headers=headers, json=SUBMIT)
    assert submitted.status_code == 202, submitted.text
    assert submitted.json()["authority_basis"] == "power_of_attorney"
    assert submitted.json()["authority_document_id"] == upload.json()["id"]

    employee = user_by_name(db, "employee1")
    employee.is_active = True  # соседние тесты назначения выключают сид-сотрудников
    db.commit()
    db.expire_all()
    application = db.get(Application, draft.id)
    application.status = "IN_REVIEW"
    application.assigned_employee_id = employee.id
    db.commit()
    staff = login(client, "employee1")
    url = f"/api/employee/applications/{draft.id}/decision"

    blocked = client.post(url, headers=staff, json={"action": "approve"})
    assert blocked.status_code == 422
    assert "доверенность" in blocked.json()["detail"]

    approved = client.post(url, headers=staff, json={"action": "approve", "authority_verified": True})
    assert approved.status_code == 200, approved.text


def test_self_registration_is_disabled(client):
    response = client.post(
        "/api/auth/register",
        json={"username": "newbie", "password": "Secret123", "full_name": "Новый Клиент"},
    )
    assert response.status_code in {404, 405}
