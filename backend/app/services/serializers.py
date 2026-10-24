from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import (
    Application,
    ApplicationEvent,
    Document,
    EnrichmentSnapshot,
    Product,
    ROLE_ADMIN,
    ROLE_CLIENT,
    ROLE_EMPLOYEE,
    User,
)
from .state_machine import (
    APPROVED,
    APPROVED_CHANGED,
    CLIENT_STATUS_BY_TECHNICAL,
    DRAFT,
    IN_REVIEW,
    NEED_INFO,
    OFFER_ACCEPTED,
    OFFER_STATUSES,
    REJECTED,
    SIGNED,
    STATUS_LABELS,
)


def product_dict(product: Product) -> dict[str, Any]:
    return {
        "id": product.id,
        "code": product.code,
        "name": product.name,
        "short_description": product.short_description,
        "description": product.description,
        "min_amount": float(product.min_amount),
        "max_amount": float(product.max_amount),
        "min_term_months": product.min_term_months,
        "max_term_months": product.max_term_months,
        "rate": float(product.rate),
        "min_business_age_months": product.min_business_age_months,
        "requires_collateral": product.requires_collateral,
        "revenue_limit_ratio": float(product.revenue_limit_ratio),
        "purposes": product.purposes or [],
        "is_active": product.is_active,
        "sort_order": product.sort_order,
    }


# События, которые описывают внутреннюю кухню банка (скоринг, черновик решения,
# назначение сотрудника, риск-исключения). Клиенту они не показываются.
INTERNAL_EVENT_TYPES = {
    "SCORING_COMPLETED",
    "DECISION_DRAFT",
    "RISK_OVERRIDE",
    "ASSIGNED",
    "QUEUED_FOR_ADMIN",
    "REASSIGNMENT_REQUIRED",
    "MANUALLY_ASSIGNED",
    "TECHNICAL_RETRY_REQUIRED",
    "ENRICHMENT_PARTIAL",
}


def _client_event(event: ApplicationEvent) -> dict[str, Any]:
    return {
        "id": event.id,
        "event_type": event.event_type,
        "status_from": event.status_from,
        "status_to": event.status_to,
        "actor_role": event.actor_role,
        "comment": event.comment,
        "details": None,
        "created_at": event.created_at,
    }


def _previous_decisions(db: Session, application: Application) -> list[dict[str, Any]]:
    """История прошлых заявок цепочки для правила «свежего взгляда»."""
    history: list[dict[str, Any]] = []
    current = application
    seen = {application.id}
    while current.previous_application_id and current.previous_application_id not in seen and len(history) < 20:
        previous = db.get(Application, current.previous_application_id)
        if previous is None:
            break
        seen.add(previous.id)
        decided_by = db.get(User, previous.decision_by_id) if previous.decision_by_id else None
        history.append(
            {
                "id": previous.id,
                "number": previous.public_number,
                "status": previous.status,
                "status_label": STATUS_LABELS.get(previous.status, previous.status),
                "amount": float(previous.amount),
                "submitted_at": previous.submitted_at,
                "decided_by": user_min(decided_by),
                "employee_comment": previous.employee_comment,
            }
        )
        current = previous
    return history


def user_min(user: User | None) -> dict[str, Any] | None:
    if user is None:
        return None
    return {"id": user.id, "full_name": user.full_name, "role": user.role}


def _purpose_label(product: Product, purpose: str) -> str:
    for item in product.purposes or []:
        if item.get("code") == purpose:
            return item.get("label", purpose)
    return purpose


def _documents_count(db: Session, application_id: int) -> int:
    return int(
        db.scalar(select(func.count(Document.id)).where(Document.application_id == application_id)) or 0
    )


def _as_aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _is_offer_expired(application: Application) -> bool:
    expiry = _as_aware(application.offer_expires_at)
    return expiry is not None and expiry < datetime.now(timezone.utc)


def application_base_dict(
    db: Session,
    application: Application,
    product: Product,
    *,
    assigned: User | None = None,
    documents_count: int | None = None,
) -> dict[str, Any]:
    return {
        "id": application.id,
        "number": application.public_number,
        "status": application.status,
        "status_label": STATUS_LABELS.get(application.status, application.status),
        "client_status": CLIENT_STATUS_BY_TECHNICAL.get(application.status, "В обработке"),
        "product": product_dict(product),
        "company_inn": application.company_inn,
        "company_name": application.company_name,
        "authority_basis": application.authority_basis,
        "authority_document_id": application.authority_document_id,
        "amount": float(application.amount),
        "term_months": application.term_months,
        "purpose": application.purpose,
        "purpose_label": _purpose_label(product, application.purpose),
        "collateral": application.collateral,
        "created_at": application.created_at,
        "submitted_at": application.submitted_at,
        "updated_at": application.updated_at,
        "scoring_score": application.scoring_score,
        "final_outcome": application.final_outcome,
        "approved_amount": float(application.approved_amount) if application.approved_amount else None,
        "approved_term_months": application.approved_term_months,
        "approved_rate": float(application.approved_rate) if application.approved_rate else None,
        "assigned_employee": user_min(assigned),
        "queue_reason": application.queue_reason,
        "previous_application_id": application.previous_application_id,
        "documents_count": documents_count if documents_count is not None else _documents_count(db, application.id),
    }


def application_detail_dict(
    db: Session,
    application: Application,
    product: Product,
    viewer: User,
    *,
    assigned: User | None = None,
) -> dict[str, Any]:
    base = application_base_dict(db, application, product, assigned=assigned)
    internal = viewer.role in (ROLE_EMPLOYEE, ROLE_ADMIN)
    is_owner = application.user_id == viewer.id
    offer_expired = _is_offer_expired(application)
    can_decide = (
        viewer.role == ROLE_EMPLOYEE
        and application.status == IN_REVIEW
        and application.assigned_employee_id == viewer.id
        and application.user_id != viewer.id
    )
    decision_by = db.get(User, application.decision_by_id) if application.decision_by_id else None
    events = list(
        db.scalars(
            select(ApplicationEvent)
            .where(ApplicationEvent.application_id == application.id)
            .order_by(ApplicationEvent.created_at.asc(), ApplicationEvent.id.asc())
        ).all()
    )
    documents = list(
        db.scalars(
            select(Document).where(Document.application_id == application.id).order_by(Document.created_at.asc())
        ).all()
    )
    snapshot = db.scalar(
        select(EnrichmentSnapshot).where(EnrichmentSnapshot.application_id == application.id).limit(1)
    )

    scoring = application.scoring_result if internal else None
    decision_draft: dict[str, Any] | None = application.decision_draft
    if not internal:
        # Клиент видит решение человека, а не черновик системы. Исключение — автоматический
        # запрос данных: тогда причины черновика и есть то, что нужно дослать.
        if decision_draft and application.status == NEED_INFO and decision_draft.get("outcome") == "need_info":
            decision_draft = {
                "outcome": "need_info",
                "summary": decision_draft.get("summary"),
                "reasons": decision_draft.get("reasons", []),
            }
        else:
            decision_draft = None
        events = [_client_event(event) for event in events if event.event_type not in INTERNAL_EVENT_TYPES]
    applicant = db.get(User, application.user_id) if internal else None
    registry = snapshot.registry_data if snapshot else None
    bki_data = snapshot.bki_data if snapshot and internal else None

    base.update(
        {
            "scoring": scoring,
            "decision_draft": decision_draft,
            "employee_comment": application.employee_comment,
            "decision_by": user_min(decision_by),
            "declared_revenue": float(application.declared_revenue) if application.declared_revenue is not None else None,
            "declared_profit": float(application.declared_profit) if application.declared_profit is not None else None,
            "client_comment": application.client_comment,
            "offer_expires_at": application.offer_expires_at,
            "accepted_at": application.accepted_at,
            "signed_at": application.signed_at,
            "disbursed_at": application.disbursed_at,
            "events": events,
            "documents": documents,
            "registry_snapshot": registry,
            "bki_snapshot": bki_data,
            "enrichment_errors": snapshot.errors if snapshot and internal else None,
            "can_edit": is_owner and application.status == DRAFT,
            "can_submit": is_owner and application.status == DRAFT,
            "can_respond": is_owner and application.status == NEED_INFO,
            "can_accept_offer": is_owner and application.status in OFFER_STATUSES and not offer_expired,
            "can_decline_offer": is_owner and application.status in OFFER_STATUSES and not offer_expired,
            "can_sign": is_owner and application.status == OFFER_ACCEPTED,
            "can_disburse": is_owner and application.status == SIGNED,
            "can_resubmit": is_owner and application.status == REJECTED,
            "can_decide": can_decide,
            "previous_decisions": _previous_decisions(db, application) if internal else [],
            "related_party": bool(applicant and applicant.related_employee_id),
        }
    )
    return base
