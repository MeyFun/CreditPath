from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..models import (
    Application,
    AuditLog,
    Document,
    Product,
    ROLE_ADMIN,
    ROLE_EMPLOYEE,
    ScoringConfig,
    User,
)
from ..schemas import (
    ApplicationDetail,
    ApplicationOut,
    AssignRequest,
    AuditOut,
    AuditVerifyOut,
    ProductOut,
    ProductUpdate,
    RoleUpdateRequest,
    ScoringConfigOut,
    ScoringConfigUpdate,
    UserOut,
)
from ..security import require_admin
from ..services.assignment import chain_reviewer_ids
from ..services.audit import verify_audit_chain, write_audit
from ..services.notifications import notify, notify_admins
from ..services.scoring_config import get_active_config, validate_config
from ..services.serializers import application_base_dict, application_detail_dict, product_dict
from ..services.state_machine import IN_REVIEW, NEED_INFO, add_event

router = APIRouter(prefix="/admin", tags=["Администрирование"])


@router.get("/users", response_model=list[UserOut])
def list_users(
    search: str | None = None,
    role: str | None = None,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[User]:
    query = select(User)
    if role:
        query = query.where(User.role == role)
    if search:
        needle = f"%{search.lower().strip()}%"
        query = query.where(
            func.lower(User.full_name).like(needle)
            | func.lower(User.username).like(needle)
            | User.company_inn.like(needle)
        )
    return list(db.scalars(query.order_by(User.role, User.full_name)).all())


@router.patch("/users/{user_id}/role", response_model=UserOut)
def change_role(
    user_id: int,
    payload: RoleUpdateRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> User:
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    if target.role == ROLE_ADMIN or target.id == admin.id:
        raise HTTPException(status_code=400, detail="Роль администратора через этот интерфейс не меняется")
    if target.role == payload.role:
        return target
    before_role = target.role
    target.role = payload.role
    if payload.role == "client" and before_role == ROLE_EMPLOYEE:
        active = db.scalars(
            select(Application).where(
                Application.assigned_employee_id == target.id,
                Application.status.in_([IN_REVIEW, NEED_INFO]),
            )
        ).all()
        for application in active:
            application.assigned_employee_id = None
            application.queue_reason = (
                "Сотрудник переведён в клиенты. Требуется назначение другого сотрудника администратором."
            )
            add_event(
                db,
                application,
                event_type="REASSIGNMENT_REQUIRED",
                actor=admin,
                comment=application.queue_reason,
            )
        if active:
            notify_admins(
                db,
                title="Требуется переназначение",
                body=f"У сотрудника {target.full_name} было {len(active)} активных заявок. Они возвращены в очередь администратора.",
                kind="warning",
            )
    write_audit(
        db,
        actor=admin,
        action="user.role_changed",
        entity_type="user",
        entity_id=target.id,
        before={"role": before_role},
        after={"role": payload.role},
    )
    db.commit()
    db.refresh(target)
    return target


@router.get("/applications", response_model=list[ApplicationOut])
def all_applications(
    status_filter: str | None = None,
    unassigned: bool = False,
    search: str | None = None,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[dict]:
    query = select(Application)
    if status_filter:
        query = query.where(Application.status == status_filter)
    if unassigned:
        query = query.where(Application.assigned_employee_id.is_(None))
    rows = db.scalars(query.order_by(Application.created_at.desc()).limit(500)).all()
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
        assigned = db.get(User, item.assigned_employee_id) if item.assigned_employee_id else None
        result.append(application_base_dict(db, item, product, assigned=assigned))
    return result


@router.get("/applications/{application_id}", response_model=ApplicationDetail)
def application_detail(
    application_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    application = db.get(Application, application_id)
    if application is None:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    product = db.get(Product, application.product_id)
    assigned = db.get(User, application.assigned_employee_id) if application.assigned_employee_id else None
    return application_detail_dict(db, application, product, admin, assigned=assigned)


@router.patch("/applications/{application_id}/assign", response_model=ApplicationDetail)
def assign_application(
    application_id: int,
    payload: AssignRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    application = db.get(Application, application_id)
    if application is None:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    if application.status not in {IN_REVIEW, NEED_INFO}:
        raise HTTPException(status_code=409, detail="Назначение доступно для заявок в работе")
    employee = db.get(User, payload.employee_id)
    if employee is None or employee.role != ROLE_EMPLOYEE or not employee.is_active:
        raise HTTPException(status_code=422, detail="Выбранный сотрудник недоступен")
    if employee.id == application.user_id:
        raise HTTPException(status_code=422, detail="Нельзя назначить заявку её автору")
    if employee.id in chain_reviewer_ids(db, application):
        raise HTTPException(status_code=422, detail="Сотрудник уже рассматривал заявки этой цепочки")
    before = {"employee_id": application.assigned_employee_id, "queue_reason": application.queue_reason}
    application.assigned_employee_id = employee.id
    application.queue_reason = None
    add_event(
        db,
        application,
        event_type="MANUALLY_ASSIGNED",
        actor=admin,
        comment=f"Заявка назначена администратором сотруднику {employee.full_name}.",
        details={"employee_id": employee.id},
    )
    write_audit(
        db,
        actor=admin,
        action="application.manually_assigned",
        entity_type="application",
        entity_id=application.id,
        before=before,
        after={"employee_id": employee.id},
    )
    notify(
        db,
        user_id=employee.id,
        application_id=application.id,
        title="Заявка назначена вам",
        body=f"Заявка {application.public_number} назначена администратором.",
        kind="action",
    )
    db.commit()
    product = db.get(Product, application.product_id)
    return application_detail_dict(db, application, product, admin, assigned=employee)


@router.get("/audit", response_model=list[AuditOut])
def audit_log(
    action: str | None = None,
    entity_type: str | None = None,
    actor_id: int | None = None,
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[AuditLog]:
    query = select(AuditLog)
    if action:
        query = query.where(AuditLog.action == action)
    if entity_type:
        query = query.where(AuditLog.entity_type == entity_type)
    if actor_id:
        query = query.where(AuditLog.actor_id == actor_id)
    return list(db.scalars(query.order_by(AuditLog.id.desc()).offset(offset).limit(min(limit, 500))).all())


@router.get("/audit/verify", response_model=AuditVerifyOut)
def verify_audit(db: Session = Depends(get_db), admin: User = Depends(require_admin)) -> dict:
    return verify_audit_chain(db)


@router.get("/products", response_model=list[ProductOut])
def all_products(db: Session = Depends(get_db), admin: User = Depends(require_admin)) -> list[dict]:
    rows = db.scalars(select(Product).order_by(Product.sort_order, Product.id)).all()
    return [product_dict(item) for item in rows]


@router.patch("/products/{product_id}", response_model=ProductOut)
def update_product(
    product_id: int,
    payload: ProductUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    product = db.get(Product, product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Продукт не найден")
    before = product_dict(product)
    changes = payload.model_dump(exclude_unset=True)
    for field, value in changes.items():
        if field in {"min_amount", "max_amount", "rate", "revenue_limit_ratio"} and value is not None:
            value = Decimal(str(value))
        setattr(product, field, value)
    if float(product.min_amount) >= float(product.max_amount):
        raise HTTPException(status_code=422, detail="Минимальная сумма должна быть меньше максимальной")
    if product.min_term_months >= product.max_term_months:
        raise HTTPException(status_code=422, detail="Минимальный срок должен быть меньше максимального")
    write_audit(
        db,
        actor=admin,
        action="product.updated",
        entity_type="product",
        entity_id=product.id,
        before=before,
        after=product_dict(product),
    )
    db.commit()
    db.refresh(product)
    return product_dict(product)


@router.get("/scoring-config", response_model=ScoringConfigOut)
def current_scoring_config(db: Session = Depends(get_db), admin: User = Depends(require_admin)) -> ScoringConfig:
    config, row = get_active_config(db)
    if row is None:
        raise HTTPException(status_code=500, detail="Активная конфигурация скоринга не найдена")
    return row


@router.get("/scoring-config/history", response_model=list[ScoringConfigOut])
def scoring_history(db: Session = Depends(get_db), admin: User = Depends(require_admin)) -> list[ScoringConfig]:
    return list(db.scalars(select(ScoringConfig).order_by(ScoringConfig.version.desc()).limit(100)).all())


@router.post("/scoring-config", response_model=ScoringConfigOut, status_code=201)
def update_scoring_config(
    payload: ScoringConfigUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> ScoringConfig:
    try:
        validate_config(payload.config)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    latest_version = int(db.scalar(select(func.max(ScoringConfig.version))) or 0)
    previous = db.scalar(select(ScoringConfig).where(ScoringConfig.is_active.is_(True)))
    before = previous.config if previous else None
    db.execute(
        ScoringConfig.__table__.update().where(ScoringConfig.is_active.is_(True)).values(is_active=False)
    )
    new_config = ScoringConfig(
        version=latest_version + 1,
        config=payload.config,
        is_active=True,
        created_by_id=admin.id,
    )
    db.add(new_config)
    db.flush()
    write_audit(
        db,
        actor=admin,
        action="scoring_config.updated",
        entity_type="scoring_config",
        entity_id=new_config.id,
        before={"version": previous.version if previous else None, "config": before},
        after={"version": new_config.version, "config": payload.config},
    )
    db.commit()
    db.refresh(new_config)
    return new_config


@router.get("/applications/{application_id}/documents/{document_id}")
def admin_download_document(
    application_id: int,
    document_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    document = db.get(Document, document_id)
    if document is None or document.application_id != application_id:
        raise HTTPException(status_code=404, detail="Документ не найден")
    path = Path(settings.upload_dir) / f"application_{application_id}" / Path(document.stored_name).name
    if not path.exists():
        raise HTTPException(status_code=404, detail="Файл не найден")
    return FileResponse(path, media_type=document.content_type, filename=document.original_name)
