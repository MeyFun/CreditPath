from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import (
    Application,
    AuditLog,
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
    ProductCreate,
    ProductOut,
    ProductUpdate,
    RoleUpdateRequest,
    UserCreate,
    ScoringConfigOut,
    ScoringConfigUpdate,
    UserOut,
)
from ..security import hash_password, require_admin
from ..services.assignment import chain_reviewer_ids
from ..services.audit import verify_audit_chain, write_audit
from ..services.external import ExternalServiceError, fetch_registry
from ..services.inn import validate_inn
from ..services.notifications import notify, notify_admins
from ..services.scoring_config import get_active_config, validate_config
from ..services.serializers import application_base_dict, application_detail_dict, document_response, matches_search, product_dict
from ..services.state_machine import (
    DRAFT,
    DECISION_DRAFT,
    ENRICHMENT,
    IN_REVIEW,
    NEED_INFO,
    SCORING,
    SUBMITTED,
    VALIDATION,
    add_event,
)

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


@router.post("/users", response_model=UserOut, status_code=201)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> User:
    """Банк заводит клиента или сотрудника. ИНН профиля — основание полномочий клиента, поэтому проверяется по реестру."""
    username = payload.username.lower()
    if db.scalar(select(User).where(User.username == username)) is not None:
        raise HTTPException(status_code=409, detail="Логин уже занят")
    if payload.company_inn:
        if payload.role != "client":
            raise HTTPException(status_code=422, detail="ИНН компании задаётся только клиенту")
        valid, message = validate_inn(payload.company_inn)
        if not valid:
            raise HTTPException(status_code=422, detail=message)
        try:
            fetch_registry(payload.company_inn)
        except ExternalServiceError as exc:
            if exc.code == "not_found":
                raise HTTPException(status_code=422, detail="Компания с таким ИНН не найдена в реестре") from exc
    user = User(
        username=username,
        password_hash=hash_password(payload.password),
        full_name=payload.full_name.strip(),
        role=payload.role,
        company_inn=payload.company_inn,
    )
    db.add(user)
    db.flush()
    write_audit(
        db,
        actor=admin,
        action="user.created",
        entity_type="user",
        entity_id=user.id,
        after={"username": user.username, "role": user.role, "company_inn": user.company_inn},
    )
    db.commit()
    db.refresh(user)
    return user


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
        rows = [item for item in rows if matches_search(item, search)]
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
    if employee.id == application.assigned_employee_id:
        raise HTTPException(status_code=409, detail="Заявка уже назначена этому сотруднику")
    if employee.id == application.user_id:
        raise HTTPException(status_code=422, detail="Нельзя назначить заявку её автору")
    applicant = db.get(User, application.user_id)
    if applicant is not None and applicant.related_employee_id == employee.id:
        raise HTTPException(status_code=422, detail="Сотрудник — связанное лицо заявителя")
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
    if before["employee_id"]:
        notify(
            db,
            user_id=before["employee_id"],
            application_id=application.id,
            title="Заявка передана другому сотруднику",
            body=f"Заявка {application.public_number} переназначена администратором.",
            kind="info",
        )
    db.commit()
    product = db.get(Product, application.product_id)
    return application_detail_dict(db, application, product, admin, assigned=employee)


@router.get("/audit", response_model=list[AuditOut])
def audit_log(
    action: str | None = None,
    entity_type: str | None = None,
    actor_id: int | None = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
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
    return list(db.scalars(query.order_by(AuditLog.id.desc()).offset(offset).limit(limit)).all())


@router.get("/audit/verify", response_model=AuditVerifyOut)
def verify_audit(db: Session = Depends(get_db), admin: User = Depends(require_admin)) -> dict:
    return verify_audit_chain(db)


@router.get("/products", response_model=list[ProductOut])
def all_products(db: Session = Depends(get_db), admin: User = Depends(require_admin)) -> list[dict]:
    rows = db.scalars(select(Product).order_by(Product.sort_order, Product.id)).all()
    return [product_dict(item) for item in rows]


OPEN_STATUSES = (DRAFT, SUBMITTED, VALIDATION, ENRICHMENT, SCORING, DECISION_DRAFT, IN_REVIEW, NEED_INFO)


def _check_product_limits(product: Product) -> None:
    if float(product.min_amount) >= float(product.max_amount):
        raise HTTPException(status_code=422, detail="Минимальная сумма должна быть меньше максимальной")
    if product.min_term_months >= product.max_term_months:
        raise HTTPException(status_code=422, detail="Минимальный срок должен быть меньше максимального")


@router.post("/products", response_model=ProductOut, status_code=201)
def create_product(
    payload: ProductCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    if db.scalar(select(Product).where(Product.code == payload.code)) is not None:
        raise HTTPException(status_code=409, detail="Продукт с таким кодом уже есть")
    data = payload.model_dump()
    for field in ("min_amount", "max_amount", "rate", "revenue_limit_ratio"):
        data[field] = Decimal(str(data[field]))
    data["purposes"] = [item.model_dump() for item in payload.purposes]
    data["sort_order"] = (db.scalar(select(func.max(Product.sort_order))) or 0) + 1
    product = Product(**data)
    _check_product_limits(product)
    db.add(product)
    db.flush()
    write_audit(
        db,
        actor=admin,
        action="product.created",
        entity_type="product",
        entity_id=product.id,
        after=product_dict(product),
    )
    db.commit()
    db.refresh(product)
    return product_dict(product)


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
    if changes.get("purposes") is not None:
        kept = {item["code"] for item in changes["purposes"]}
        removed = {item.get("code") for item in product.purposes or []} - kept
        if removed:
            busy = db.scalar(
                select(func.count(Application.id)).where(
                    Application.product_id == product.id,
                    Application.purpose.in_(removed),
                    Application.status.in_(OPEN_STATUSES),
                )
            )
            if busy:
                raise HTTPException(
                    status_code=409,
                    detail=f"Цель нельзя убрать: по ней есть незавершённые заявки ({busy}). Скройте цель после их обработки.",
                )
    for field, value in changes.items():
        if field in {"min_amount", "max_amount", "rate", "revenue_limit_ratio"} and value is not None:
            value = Decimal(str(value))
        setattr(product, field, value)
    _check_product_limits(product)
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


@router.delete("/products/{product_id}", status_code=204)
def delete_product(
    product_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> Response:
    """Удаляет продукт без заявок. Продукт с заявками только скрывается: история и аудит ссылаются на него."""
    product = db.get(Product, product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Продукт не найден")
    used = db.scalar(select(func.count(Application.id)).where(Application.product_id == product.id))
    if used:
        raise HTTPException(
            status_code=409,
            detail=f"По продукту есть заявки ({used}), удалить его нельзя. Скройте продукт: клиенты перестанут его видеть.",
        )
    write_audit(
        db,
        actor=admin,
        action="product.deleted",
        entity_type="product",
        entity_id=product.id,
        before=product_dict(product),
    )
    db.delete(product)
    db.commit()
    return Response(status_code=204)


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
    except (ValueError, TypeError, KeyError) as exc:
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
    return document_response(db, application_id, document_id)
