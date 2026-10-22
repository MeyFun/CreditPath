from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from ..models import Application, ApplicationEvent, User
from .audit import write_audit

DRAFT = "DRAFT"
SUBMITTED = "SUBMITTED"
VALIDATION = "VALIDATION"
ENRICHMENT = "ENRICHMENT"
SCORING = "SCORING"
DECISION_DRAFT = "DECISION_DRAFT"
IN_REVIEW = "IN_REVIEW"
NEED_INFO = "NEED_INFO"
APPROVED = "APPROVED"
APPROVED_CHANGED = "APPROVED_CHANGED"
REJECTED = "REJECTED"
OFFER_ACCEPTED = "OFFER_ACCEPTED"
OFFER_DECLINED = "OFFER_DECLINED"
SIGNED = "SIGNED"
DISBURSED = "DISBURSED"

TERMINAL_STATUSES = {REJECTED, OFFER_DECLINED, DISBURSED}
PIPELINE_STATUSES = {SUBMITTED, VALIDATION, ENRICHMENT, SCORING, DECISION_DRAFT}
REVIEW_STATUSES = {IN_REVIEW, NEED_INFO}
OFFER_STATUSES = {APPROVED, APPROVED_CHANGED}

ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    DRAFT: {SUBMITTED},
    SUBMITTED: {VALIDATION},
    VALIDATION: {ENRICHMENT, NEED_INFO},
    ENRICHMENT: {SCORING, NEED_INFO},
    SCORING: {DECISION_DRAFT, NEED_INFO},
    DECISION_DRAFT: {IN_REVIEW, NEED_INFO},
    IN_REVIEW: {APPROVED, APPROVED_CHANGED, REJECTED, NEED_INFO},
    NEED_INFO: {VALIDATION},
    APPROVED: {OFFER_ACCEPTED, OFFER_DECLINED},
    APPROVED_CHANGED: {OFFER_ACCEPTED, OFFER_DECLINED},
    OFFER_ACCEPTED: {SIGNED},
    SIGNED: {DISBURSED},
    REJECTED: set(),
    OFFER_DECLINED: set(),
    DISBURSED: set(),
}

STATUS_LABELS = {
    DRAFT: "Черновик",
    SUBMITTED: "Заявка отправлена",
    VALIDATION: "Заявка рассматривается",
    ENRICHMENT: "Заявка рассматривается",
    SCORING: "Заявка рассматривается",
    DECISION_DRAFT: "Заявка рассматривается",
    IN_REVIEW: "На рассмотрении у сотрудника",
    NEED_INFO: "Требуется уточнение",
    APPROVED: "Одобрено",
    APPROVED_CHANGED: "Одобрено на других условиях",
    REJECTED: "Отказ",
    OFFER_ACCEPTED: "Оферта принята",
    OFFER_DECLINED: "Оферта отклонена",
    SIGNED: "Договор подписан",
    DISBURSED: "Средства перечислены",
}

CLIENT_STATUS_BY_TECHNICAL = {
    DRAFT: "Черновик",
    SUBMITTED: "Заявка отправлена",
    VALIDATION: "Заявка рассматривается",
    ENRICHMENT: "Заявка рассматривается",
    SCORING: "Заявка рассматривается",
    DECISION_DRAFT: "Заявка рассматривается",
    IN_REVIEW: "На рассмотрении у сотрудника",
    NEED_INFO: "Требуется уточнение",
    APPROVED: "Рассмотрено",
    APPROVED_CHANGED: "Рассмотрено",
    REJECTED: "Рассмотрено",
    OFFER_ACCEPTED: "Рассмотрено",
    OFFER_DECLINED: "Рассмотрено",
    SIGNED: "Рассмотрено",
    DISBURSED: "Рассмотрено",
}

OUTCOME_LABELS = {
    "approve": "Одобрено",
    "approve_changed": "Одобрено на других условиях",
    "need_info": "Нужны дополнительные данные",
    "reject": "Отказ",
}


class InvalidTransition(Exception):
    def __init__(self, status_from: str, status_to: str):
        self.status_from = status_from
        self.status_to = status_to
        super().__init__(f"Недопустимый переход {status_from} → {status_to}")


def assert_transition(status_from: str, status_to: str) -> None:
    if status_to not in ALLOWED_TRANSITIONS.get(status_from, set()):
        raise InvalidTransition(status_from, status_to)


def transition_application(
    db: Session,
    application: Application,
    status_to: str,
    *,
    actor: User | None = None,
    actor_role: str | None = None,
    comment: str | None = None,
    details: dict[str, Any] | None = None,
) -> ApplicationEvent:
    status_from = application.status
    assert_transition(status_from, status_to)
    before = {"status": status_from}
    application.status = status_to
    after = {"status": status_to}
    role = actor_role or (actor.role if actor else "system")
    event = ApplicationEvent(
        application_id=application.id,
        event_type="STATUS_CHANGE",
        status_from=status_from,
        status_to=status_to,
        actor_id=actor.id if actor else None,
        actor_role=role,
        comment=comment,
        details=details,
    )
    db.add(event)
    write_audit(
        db,
        actor=actor,
        action="application.status_changed",
        entity_type="application",
        entity_id=application.id,
        before=before,
        after=after,
        actor_label=None if actor else "Система (автопроверка)",
    )
    return event


def add_event(
    db: Session,
    application: Application,
    *,
    event_type: str,
    actor: User | None,
    actor_role: str | None = None,
    comment: str | None = None,
    details: dict[str, Any] | None = None,
) -> ApplicationEvent:
    event = ApplicationEvent(
        application_id=application.id,
        event_type=event_type,
        actor_id=actor.id if actor else None,
        actor_role=actor_role or (actor.role if actor else "system"),
        comment=comment,
        details=details,
    )
    db.add(event)
    return event
