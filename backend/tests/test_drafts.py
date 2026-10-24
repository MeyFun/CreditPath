from __future__ import annotations

from app.models import Application, ApplicationEvent, AuditLog
from sqlalchemy import select

from tests.conftest import login, make_application, user_by_name


def test_client_deletes_own_draft(client, db):
    client1 = user_by_name(db, "client1")
    draft = make_application(db, user=client1)
    db.add(ApplicationEvent(application_id=draft.id, event_type="DRAFT_CREATED", actor_role="client"))
    db.commit()
    draft_id = draft.id

    response = client.delete(f"/api/client/applications/{draft_id}", headers=login(client, "client1"))

    assert response.status_code == 204
    db.expire_all()
    assert db.get(Application, draft_id) is None
    assert db.scalar(select(ApplicationEvent).where(ApplicationEvent.application_id == draft_id)) is None
    audit = db.scalar(
        select(AuditLog).where(AuditLog.action == "application.draft_deleted", AuditLog.entity_id == str(draft_id))
    )
    assert audit is not None


def test_client_cannot_delete_foreign_draft(client, db):
    draft = make_application(db, user=user_by_name(db, "client1"))

    response = client.delete(f"/api/client/applications/{draft.id}", headers=login(client, "client2"))

    assert response.status_code == 404


def test_submitted_application_cannot_be_deleted(client, db):
    submitted = make_application(db, user=user_by_name(db, "client1"), status="IN_REVIEW")

    response = client.delete(f"/api/client/applications/{submitted.id}", headers=login(client, "client1"))

    assert response.status_code == 409


def test_resubmit_reuses_existing_draft(client, db):
    rejected = make_application(db, user=user_by_name(db, "client1"), status="REJECTED")
    headers = login(client, "client1")

    first = client.post(f"/api/client/applications/{rejected.id}/resubmit", headers=headers)
    second = client.post(f"/api/client/applications/{rejected.id}/resubmit", headers=headers)

    assert first.status_code == 201
    assert second.json()["id"] == first.json()["id"]


def test_submit_rejects_inn_missing_from_registry(client, db, monkeypatch):
    import app.api.client as client_api
    from app.services.external import ExternalServiceError

    def not_found(inn):
        raise ExternalServiceError("registry", "Запись не найдена", "not_found")

    monkeypatch.setattr(client_api, "fetch_registry", not_found)
    monkeypatch.setattr(client_api, "run_pipeline", lambda *args, **kwargs: None)
    draft = make_application(db, user=user_by_name(db, "client1"))
    body = {"signer_position": "ceo", "authority_confirmed": True, "consent_bki": True, "consent_personal_data": True}

    response = client.post(f"/api/client/applications/{draft.id}/submit", headers=login(client, "client1"), json=body)

    assert response.status_code == 422
    assert "не найдена в реестре" in response.json()["detail"]
    db.expire_all()
    assert db.get(Application, draft.id).status == "DRAFT"
