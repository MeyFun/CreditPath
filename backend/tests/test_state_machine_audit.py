from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models import Application, ApplicationEvent, AuditLog
from app.services.audit import verify_audit_chain, write_audit
from app.services.state_machine import InvalidTransition, assert_transition, transition_application
from tests.conftest import make_application, user_by_name


def test_allowed_and_forbidden_transitions_are_declared():
    assert_transition("DRAFT", "SUBMITTED")
    assert_transition("SUBMITTED", "VALIDATION")
    assert_transition("VALIDATION", "ENRICHMENT")
    assert_transition("ENRICHMENT", "SCORING")
    assert_transition("SCORING", "DECISION_DRAFT")
    assert_transition("DECISION_DRAFT", "IN_REVIEW")
    assert_transition("IN_REVIEW", "NEED_INFO")
    assert_transition("NEED_INFO", "VALIDATION")
    assert_transition("APPROVED", "OFFER_ACCEPTED")
    assert_transition("SIGNED", "DISBURSED")
    with pytest.raises(InvalidTransition):
        assert_transition("DRAFT", "APPROVED")
    with pytest.raises(InvalidTransition):
        assert_transition("REJECTED", "IN_REVIEW")
    with pytest.raises(InvalidTransition):
        assert_transition("VALIDATION", "APPROVED")


def test_transition_writes_event_and_audit(db):
    client_user = user_by_name(db, "client1")
    application = make_application(db, user=client_user)
    before_audit = db.scalar(select(AuditLog.id).order_by(AuditLog.id.desc()).limit(1))
    before_events = len(
        db.scalars(select(ApplicationEvent).where(ApplicationEvent.application_id == application.id)).all()
    )
    transition_application(db, application, "SUBMITTED", actor=client_user, comment="Отправка")
    db.commit()
    assert application.status == "SUBMITTED"
    events = db.scalars(
        select(ApplicationEvent).where(ApplicationEvent.application_id == application.id)
    ).all()
    assert len(events) == before_events + 1
    assert events[-1].status_from == "DRAFT"
    assert events[-1].status_to == "SUBMITTED"
    latest_audit = db.scalar(select(AuditLog).order_by(AuditLog.id.desc()).limit(1))
    assert latest_audit.action == "application.status_changed"
    assert latest_audit.id != before_audit


def test_invalid_transition_does_not_change_status(db):
    client_user = user_by_name(db, "client1")
    application = make_application(db, user=client_user)
    with pytest.raises(InvalidTransition):
        transition_application(db, application, "DISBURSED", actor=client_user)
    db.rollback()
    db.refresh(application)
    assert application.status == "DRAFT"


def test_full_allowed_path_and_need_info_return(db):
    client_user = user_by_name(db, "client1")
    employee = user_by_name(db, "employee1")
    application = make_application(db, user=client_user)
    sequence = [
        ("SUBMITTED", client_user),
        ("VALIDATION", None),
        ("ENRICHMENT", None),
        ("SCORING", None),
        ("DECISION_DRAFT", None),
        ("IN_REVIEW", None),
        ("NEED_INFO", employee),
        ("VALIDATION", client_user),
    ]
    for target, actor in sequence:
        transition_application(db, application, target, actor=actor)
        db.commit()
    assert application.status == "VALIDATION"
    history = db.scalars(
        select(ApplicationEvent)
        .where(ApplicationEvent.application_id == application.id)
        .order_by(ApplicationEvent.id)
    ).all()
    assert [item.status_to for item in history] == [target for target, _ in sequence]


def test_audit_chain_verifies_and_detects_tampering(db):
    admin = user_by_name(db, "admin")
    for index in range(3):
        write_audit(
            db,
            actor=admin,
            action=f"test.action_{index}",
            entity_type="test",
            entity_id=index,
            before={"index": index - 1},
            after={"index": index},
        )
    db.commit()
    assert verify_audit_chain(db)["valid"] is True

    last = db.scalar(select(AuditLog).order_by(AuditLog.id.desc()).limit(1))
    original = last.after
    last.after = {"tampered": True}
    db.commit()
    result = verify_audit_chain(db)
    assert result["valid"] is False
    assert result["broken_at"] == last.id
    last.after = original
    db.commit()
    assert verify_audit_chain(db)["valid"] is True


def test_terminal_status_cannot_transition(db):
    client_user = user_by_name(db, "client1")
    application = make_application(db, user=client_user, status="DISBURSED")
    with pytest.raises(InvalidTransition):
        transition_application(db, application, "IN_REVIEW", actor=client_user)
