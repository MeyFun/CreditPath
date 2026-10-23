from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..models import Application, Document, Product, User
from ..schemas import (
    ApplicationDetail,
    ApplicationOut,
    DecisionRequest,
    EmployeeStatsOut,
)
from ..security import require_employee
from ..services.assignment import chain_reviewer_ids
from ..services.audit import write_audit
from ..services.notifications import notify
from ..services.scoring_config import get_active_config
from ..services.serializers import application_base_dict, application_detail_dict
from ..services.state_machine import (
    APPROVED,
    APPROVED_CHANGED,
    IN_REVIEW,
    NEED_INFO,
    REJECTED,
    add_event,
    transition_application,
)

router = APIRouter(prefix="/employee", tags=["Рабочее место сотрудника"])


def _assigned(db: Session, application_id: int, user: User) -> Application:
    application = db.get(Application, application_id)
    # Сотрудник не может получить в служебном контуре собственную клиентскую заявку.
    if (
        application is None
        or application.assigned_employee_id != user.id
        or application.user_id == user.id
    ):
        raise HTTPException(status_code=404, detail="Заявка не найдена среди назначенных вам")
    return application


@router.get("/stats", response_model=EmployeeStatsOut)
def stats(db: Session = Depends(get_db), user: User = Depends(require_employee)) -> dict:
    rows = db.scalars(
        select(Application).where(
            Application.assigned_employee_id == user.id,
            Application.user_id != user.id,
        )
    ).all()
    approved_total = sum(
        float(item.approved_amount or 0) for item in rows if item.status in {APPROVED, APPROVED_CHANGED}
    )
    return {
        "in_review": sum(1 for item in rows if item.status == IN_REVIEW),
        "need_info": sum(1 for item in rows if item.status == NEED_INFO),
        "total_assigned": len(rows),
        "approved_total": approved_total,
    }


@router.get("/applications", response_model=list[ApplicationOut])
def list_applications(
    scope: str = "queue",
    status_filter: str | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_employee),
) -> list[dict]:
    query = select(Application).where(
        Application.assigned_employee_id == user.id,
        Application.user_id != user.id,
    )
    if scope == "queue":
        query = query.where(Application.status.in_([IN_REVIEW, NEED_INFO]))
    if status_filter:
        query = query.where(Application.status == status_filter)
    rows = db.scalars(query.order_by(Application.updated_at.desc())).all()
    if search:
        needle = search.lower()
        rows = [
            item
            for item in rows
            if needle in item.public_number.lower()
            or needle in (item.company_name or "").lower()
            or needle in (item.company_inn or "")
        ]
    result = []
    for item in rows:
        product = db.get(Product, item.product_id)
        result.append(application_base_dict(db, item, product))
    return result


@router.get("/applications/{application_id}", response_model=ApplicationDetail)
def get_application(
    application_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_employee),
) -> dict:
    application = _assigned(db, application_id, user)
    product = db.get(Product, application.product_id)
    return application_detail_dict(db, application, product, user, assigned=user)


@router.post("/applications/{application_id}/decision", response_model=ApplicationDetail)
def decide(
    application_id: int,
    payload: DecisionRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_employee),
) -> dict:
    application = _assigned(db, application_id, user)
    if application.status != IN_REVIEW:
        raise HTTPException(status_code=409, detail="Решение можно принять только по заявке на рассмотрении")
    if application.user_id == user.id:
        raise HTTPException(status_code=403, detail="Нельзя рассматривать собственную заявку")
    if user.id in chain_reviewer_ids(db, application):
        raise HTTPException(
            status_code=403,
            detail="Нарушено правило «свежего взгляда»: вы уже рассматривали заявки этой цепочки",
        )
    if payload.action in {"reject", "need_info"} and not (payload.comment or "").strip():
        raise HTTPException(status_code=422, detail="Для этого решения обязателен комментарий")
    product = db.get(Product, application.product_id)
    before = {
        "status": application.status,
        "approved_amount": float(application.approved_amount) if application.approved_amount else None,
        "approved_term_months": application.approved_term_months,
    }
    config, _ = get_active_config(db)

    if payload.action == "need_info":
        comment = (payload.comment or "").strip()
        application.employee_comment = comment
        transition_application(
            db,
            application,
            NEED_INFO,
            actor=user,
            comment=comment,
            details={"requested_by_employee": True},
        )
        add_event(
            db,
            application,
            event_type="INFO_REQUESTED_BY_EMPLOYEE",
            actor=user,
            comment=comment,
            details={"employee_id": user.id},
        )
        notify(
            db,
            user_id=application.user_id,
            application_id=application.id,
            title="Сотрудник запросил уточнения",
            body=comment,
            kind="warning",
        )
        write_audit(
            db,
            actor=user,
            action="application.need_info",
            entity_type="application",
            entity_id=application.id,
            before=before,
            after={"status": application.status, "comment": comment},
        )
        db.commit()
        return application_detail_dict(db, application, product, user, assigned=user)

    if payload.action == "reject":
        comment = (payload.comment or "").strip()
        application.final_outcome = "reject"
        application.employee_comment = comment
        application.decision_by_id = user.id
        transition_application(
            db,
            application,
            REJECTED,
            actor=user,
            comment=comment,
            details={"final_outcome": "reject"},
        )
        add_event(
            db,
            application,
            event_type="FINAL_DECISION",
            actor=user,
            comment=comment,
            details={"outcome": "reject", "employee_id": user.id},
        )
        notify(
            db,
            user_id=application.user_id,
            application_id=application.id,
            title="По заявке принято решение",
            body=f"Заявка {application.public_number}: отказ. Причина: {comment}",
            kind="danger",
        )
        write_audit(
            db,
            actor=user,
            action="application.decision",
            entity_type="application",
            entity_id=application.id,
            before=before,
            after={"status": application.status, "outcome": "reject", "comment": comment},
        )
        db.commit()
        return application_detail_dict(db, application, product, user, assigned=user)

    if payload.action == "approve_changed":
        if not payload.approved_amount or not payload.approved_term_months:
            raise HTTPException(status_code=422, detail="Укажите сумму и срок новых условий")
        if float(payload.approved_amount) < float(product.min_amount) or float(payload.approved_amount) > float(product.max_amount):
            raise HTTPException(
                status_code=422,
                detail=f"Сумма должна быть от {float(product.min_amount):,.0f} до {float(product.max_amount):,.0f} ₽",
            )
        if payload.approved_term_months < product.min_term_months or payload.approved_term_months > product.max_term_months:
            raise HTTPException(
                status_code=422,
                detail=f"Срок должен быть от {product.min_term_months} до {product.max_term_months} мес.",
            )
        approved_amount = float(payload.approved_amount)
        approved_term = int(payload.approved_term_months)
        target = APPROVED_CHANGED
        final_outcome = "approve_changed"
    else:
        approved_amount = float(application.amount)
        approved_term = int(application.term_months)
        target = APPROVED
        final_outcome = "approve"

    comment = (payload.comment or "").strip() or "Решение принято по результатам проверки."
    offer_days = int(config["decision"].get("offer_valid_days", 5))
    application.approved_amount = approved_amount
    application.approved_term_months = approved_term
    application.approved_rate = product.rate
    application.final_outcome = final_outcome
    application.employee_comment = comment
    application.decision_by_id = user.id
    application.offer_expires_at = datetime.now(timezone.utc) + timedelta(days=offer_days)
    transition_application(
        db,
        application,
        target,
        actor=user,
        comment=comment,
        details={
            "final_outcome": final_outcome,
            "approved_amount": approved_amount,
            "approved_term_months": approved_term,
        },
    )
    add_event(
        db,
        application,
        event_type="FINAL_DECISION",
        actor=user,
        comment=comment,
        details={
            "outcome": final_outcome,
            "approved_amount": approved_amount,
            "approved_term_months": approved_term,
            "approved_rate": float(product.rate),
            "employee_id": user.id,
        },
    )
    notify(
        db,
        user_id=application.user_id,
        application_id=application.id,
        title="Решение по заявке готово",
        body=f"Заявка {application.public_number}: {application.decision_draft.get('summary') if application.decision_draft else 'решение принято'}. Откройте карточку заявки.",
        kind="success",
    )
    write_audit(
        db,
        actor=user,
        action="application.decision",
        entity_type="application",
        entity_id=application.id,
        before=before,
        after={
            "status": application.status,
            "outcome": final_outcome,
            "approved_amount": approved_amount,
            "approved_term_months": approved_term,
            "comment": comment,
        },
    )
    db.commit()
    return application_detail_dict(db, application, product, user, assigned=user)


@router.get("/applications/{application_id}/documents/{document_id}")
def download_document(
    application_id: int,
    document_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_employee),
):
    _assigned(db, application_id, user)
    document = db.get(Document, document_id)
    if document is None or document.application_id != application_id:
        raise HTTPException(status_code=404, detail="Документ не найден")
    path = Path(settings.upload_dir) / f"application_{application_id}" / Path(document.stored_name).name
    if not path.exists():
        raise HTTPException(status_code=404, detail="Файл не найден")
    return FileResponse(path, media_type=document.content_type, filename=document.original_name)
