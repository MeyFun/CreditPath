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
