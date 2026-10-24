from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, aliased

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
    OUTCOME_LABELS,
    REJECTED,
    add_event,
    transition_application,
)

router = APIRouter(prefix="/employee", tags=["Рабочее место сотрудника"])

STOP_FACTOR_LABELS = {
    "active_overdue": "активная просроченная задолженность",
    "company_inactive": "компания не действует",
    "company_not_found": "компания не найдена в реестре",
    "registry_not_found": "компания не найдена в реестре",
    "product_age": "возраст бизнеса ниже требования продукта",
    "collateral_required": "не выполнено требование по обеспечению",
}


def _risk_override_reasons(application: Application, action: str, config: dict) -> list[str]:
    """Причины риск-исключения, если сотрудник одобряет вопреки рекомендации системы."""
    if action not in {"approve", "approve_changed"}:
        return []
    draft = application.decision_draft or {}
    stop_factors = list(draft.get("stop_factors") or [])
    score = int(application.scoring_score or 0)
    threshold = int(config["decision"].get("approve_threshold", 70))
    reasons: list[str] = []
    if stop_factors:
        labels = [STOP_FACTOR_LABELS.get(code, code) for code in stop_factors]
        reasons.append("Сработали стоп-факторы: " + ", ".join(labels))
    if draft.get("outcome") == "reject" and not stop_factors:
        reasons.append("Предварительное решение системы — отказ")
    if score < threshold:
        reasons.append(f"Скоринг {score}/100 ниже порога одобрения {threshold}")
    return reasons


def _assigned(db: Session, application_id: int, user: User, *, lock: bool = False) -> Application:
    # lock=True блокирует строку до конца транзакции: два одновременных решения не пройдут оба.
    application = db.get(Application, application_id, with_for_update=lock)
    # Сотрудник не может получить в служебном контуре собственную заявку или заявку связанного лица.
    applicant = db.get(User, application.user_id) if application else None
    if (
        application is None
        or application.assigned_employee_id != user.id
        or application.user_id == user.id
        or (applicant is not None and applicant.related_employee_id == user.id)
    ):
        raise HTTPException(status_code=404, detail="Заявка не найдена среди назначенных вам")
    return application


def _reviewer_scope(user: User):
    """Заявки, которые сотрудник может видеть: назначенные ему, кроме своих и заявок связанных лиц."""
    applicant = aliased(User)
    return (
        select(Application)
        .join(applicant, applicant.id == Application.user_id)
        .where(
            Application.assigned_employee_id == user.id,
            Application.user_id != user.id,
            or_(applicant.related_employee_id.is_(None), applicant.related_employee_id != user.id),
        )
    )


@router.get("/stats", response_model=EmployeeStatsOut)
def stats(db: Session = Depends(get_db), user: User = Depends(require_employee)) -> dict:
    rows = db.scalars(_reviewer_scope(user)).all()
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
    query = _reviewer_scope(user)
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
    detail = application_detail_dict(db, application, product, user, assigned=user)
    # Те же правила, что при решении: интерфейс предупреждает ровно о том, что попадёт в аудит.
    # Конфиг читаем только пока решение возможно: на опросах завершённых заявок он не нужен.
    if application.status == IN_REVIEW:
        config, _ = get_active_config(db)
        detail["risk_override_reasons"] = _risk_override_reasons(application, "approve", config)
    return detail


@router.post("/applications/{application_id}/decision", response_model=ApplicationDetail)
def decide(
    application_id: int,
    payload: DecisionRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_employee),
) -> dict:
    application = _assigned(db, application_id, user, lock=True)
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
        if payload.product_id is not None and payload.product_id != product.id:
            offered = db.get(Product, payload.product_id)
            if offered is None or not offered.is_active:
                raise HTTPException(status_code=422, detail="Предложенный продукт недоступен")
            before["product_id"] = product.id
            product = offered
            application.product_id = offered.id
            purposes = [item.get("code") for item in offered.purposes or []]
            if application.purpose not in purposes and purposes:
                application.purpose = purposes[0]
        if float(payload.approved_amount) > float(application.amount):
            raise HTTPException(status_code=422, detail="Сумма по новым условиям не может превышать запрошенную")
        if (
            float(payload.approved_amount) == float(application.amount)
            and payload.approved_term_months == application.term_months
            and "product_id" not in before
        ):
            raise HTTPException(status_code=422, detail="Новые условия совпадают с запрошенными — выберите «Одобрить»")
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
            "product_id": product.id,
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
        body=f"Заявка {application.public_number}: {OUTCOME_LABELS[final_outcome].lower()}. Откройте карточку заявки.",
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
            "product_id": product.id,
            "comment": comment,
        },
    )

    risk_reasons = _risk_override_reasons(application, payload.action, config)
    if risk_reasons:
        draft = application.decision_draft or {}
        risk_comment = "Риск-исключение: " + "; ".join(risk_reasons) + "."
        add_event(
            db,
            application,
            event_type="RISK_OVERRIDE",
            actor=user,
            comment=risk_comment,
            details={
                "score": application.scoring_score,
                "approve_threshold": int(config["decision"].get("approve_threshold", 70)),
                "system_outcome": draft.get("outcome"),
                "stop_factors": draft.get("stop_factors") or [],
                "final_outcome": final_outcome,
                "employee_id": user.id,
            },
        )
        write_audit(
            db,
            actor=user,
            action="application.risk_override",
            entity_type="application",
            entity_id=application.id,
            before={
                "score": application.scoring_score,
                "system_outcome": draft.get("outcome"),
                "stop_factors": draft.get("stop_factors") or [],
                "approve_threshold": int(config["decision"].get("approve_threshold", 70)),
            },
            after={
                "final_outcome": final_outcome,
                "approved_amount": approved_amount,
                "approved_term_months": approved_term,
                "employee_id": user.id,
                "reasons": risk_reasons,
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
