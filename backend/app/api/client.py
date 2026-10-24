from __future__ import annotations

import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Header,
    HTTPException,
    Query,
    Response,
    UploadFile,
)
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..models import (
    Application,
    ApplicationEvent,
    Document,
    EnrichmentSnapshot,
    IdempotencyRecord,
    Notification,
    Product,
    User,
)
from ..schemas import (
    ApplicationCreate,
    ApplicationDetail,
    ApplicationOut,
    ApplicationUpdate,
    DashboardOut,
    DocumentOut,
    OfferRequest,
    RespondInfoRequest,
    SIGNER_POSITIONS,
    SubmitRequest,
    UserOut,
)
from ..security import get_current_user, require_client
from ..services.audit import write_audit
from ..services.authority import resolve_authority
from ..services.external import ExternalServiceError, fetch_registry
from ..services.inn import validate_inn
from ..services.serializers import (
    application_base_dict,
    application_detail_dict,
    document_response,
    is_offer_expired,
    matches_search,
)
from ..services.state_machine import (
    APPROVED,
    APPROVED_CHANGED,
    DISBURSED,
    DRAFT,
    NEED_INFO,
    OFFER_ACCEPTED,
    OFFER_DECLINED,
    PIPELINE_STATUSES,
    REJECTED,
    REVIEW_STATUSES,
    SIGNED,
    SUBMITTED,
    add_event,
    transition_application,
)
from ..services.workflow import run_pipeline

# Рабочие учётки сотрудника и администратора не могут действовать как заявитель.
router = APIRouter(prefix="/client", tags=["Кабинет клиента"], dependencies=[Depends(require_client)])

ACTIVE_STATUSES = PIPELINE_STATUSES | REVIEW_STATUSES
MAX_UPLOAD_BYTES = settings.max_upload_mb * 1024 * 1024
ALLOWED_TYPES = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
}


def _owned(db: Session, application_id: int, user: User, *, lock: bool = False) -> Application:
    # lock=True блокирует строку до конца транзакции: повторный клик не запустит действие дважды.
    application = db.get(Application, application_id, with_for_update=lock)
    if application is None or application.user_id != user.id:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    return application


def _product(db: Session, product_id: int, allow_inactive: bool = False) -> Product:
    product = db.get(Product, product_id)
    if product is None or (not allow_inactive and not product.is_active):
        raise HTTPException(status_code=404, detail="Кредитный продукт не найден")
    return product


def _check_purpose(product: Product, purpose: str | None) -> None:
    codes = {item.get("code") for item in product.purposes or []}
    if codes and purpose not in codes:
        raise HTTPException(status_code=422, detail="Выберите цель из списка для этого продукта")


def _number() -> str:
    year = datetime.now(timezone.utc).year
    return f"CP-{year}-{uuid.uuid4().hex[:8].upper()}"


def _consents(payload: SubmitRequest) -> dict:
    return {
        "signer_position": payload.signer_position,
        "authority_confirmed": payload.authority_confirmed,
        "consent_bki": payload.consent_bki,
        "consent_personal_data": payload.consent_personal_data,
        "confirmed_at": datetime.now(timezone.utc).isoformat(),
    }


def _registry_or_none(inn: str) -> dict | None:
    # Неизвестный ИНН отклоняем на сервере, а не только в мастере: иначе через API заявка уйдёт в бесконечный NEED_INFO.
    # Если реестр недоступен, не блокируем — полномочия тогда подтверждает профиль или доверенность.
    try:
        return fetch_registry(inn)
    except ExternalServiceError as exc:
        if exc.code == "not_found":
            raise HTTPException(status_code=422, detail="Компания с таким ИНН не найдена в реестре") from exc
        return None


def _is_approved(application: Application) -> bool:
    # Истёкшая неподписанная оферта уже не одобрение: деньги по ней не выдадут.
    if application.status in {APPROVED, APPROVED_CHANGED}:
        return not is_offer_expired(application)
    return application.status in {OFFER_ACCEPTED, SIGNED, DISBURSED}


def _event_payload(application: Application) -> dict:
    return {
        "number": application.public_number,
        "status": application.status,
        "amount": float(application.amount),
    }


@router.get("/dashboard", response_model=DashboardOut)
def dashboard(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    rows = db.scalars(
        select(Application).where(Application.user_id == user.id).order_by(Application.created_at.desc())
    ).all()
    counts = {
        "total": len(rows),
        "draft": sum(1 for item in rows if item.status == DRAFT),
        "active": sum(1 for item in rows if item.status in ACTIVE_STATUSES),
        "needs_action": sum(1 for item in rows if item.status == NEED_INFO),
        "approved": sum(1 for item in rows if _is_approved(item)),
        "rejected": sum(1 for item in rows if item.status == REJECTED),
    }
    approved_total = sum(float(item.approved_amount or 0) for item in rows if _is_approved(item))
    unread = int(
        db.scalar(
            select(func.count(Notification.id)).where(
                Notification.user_id == user.id, Notification.is_read.is_(False)
            )
        )
        or 0
    )
    latest = rows[:8]
    items = []
    for item in latest:
        product = _product(db, item.product_id, allow_inactive=True)
        assigned = db.get(User, item.assigned_employee_id) if item.assigned_employee_id else None
        items.append(application_base_dict(db, item, product, assigned=assigned, internal=False))
    company = None
    if user.company_inn:
        snapshot = db.scalar(
            select(EnrichmentSnapshot)
            .join(Application, Application.id == EnrichmentSnapshot.application_id)
            .where(
                Application.user_id == user.id,
                Application.company_inn == user.company_inn,
                EnrichmentSnapshot.registry_ok.is_(True),
            )
            .order_by(EnrichmentSnapshot.fetched_at.desc())
            .limit(1)
        )
        if snapshot:
            company = snapshot.registry_data
        else:
            try:
                company = fetch_registry(user.company_inn)
            except ExternalServiceError:
                company = None
    return {
        "applications": items,
        "counts": counts,
        "total_approved_amount": approved_total,
        "unread_notifications": unread,
        "company": company,
    }


@router.get("/company")
def company_profile(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    snapshot = db.scalar(
        select(EnrichmentSnapshot)
        .join(Application, Application.id == EnrichmentSnapshot.application_id)
        .where(Application.user_id == user.id, EnrichmentSnapshot.registry_ok.is_(True))
        .order_by(EnrichmentSnapshot.fetched_at.desc())
        .limit(1)
    )
    cached = snapshot.registry_data if snapshot else None
    if not user.company_inn:
        return {"user": UserOut.model_validate(user), "company": None, "source": "profile"}
    try:
        company = fetch_registry(user.company_inn)
        source = "Реестр компаний"
    except ExternalServiceError:
        company = cached
        source = "Сохранённый снимок" if cached else None
    if company is None:
        raise HTTPException(
            status_code=503,
            detail="Данные компании временно недоступны. Попробуйте позже.",
        )
    return {"user": UserOut.model_validate(user), "company": company, "source": source}


@router.get("/applications", response_model=list[ApplicationOut])
def list_applications(
    status_group: str = "all",
    search: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict]:
    query = select(Application).where(Application.user_id == user.id)
    if status_group == "draft":
        query = query.where(Application.status == DRAFT)
    elif status_group == "active":
        query = query.where(Application.status.in_(ACTIVE_STATUSES))
    elif status_group == "completed":
        query = query.where(
            Application.status.in_(
                [APPROVED, APPROVED_CHANGED, REJECTED, OFFER_ACCEPTED, OFFER_DECLINED, SIGNED, DISBURSED]
            )
        )
    rows = db.scalars(query.order_by(Application.created_at.desc())).all()
    if search:
        rows = [item for item in rows if matches_search(item, search)]
    result = []
    for item in rows:
        product = _product(db, item.product_id, allow_inactive=True)
        assigned = db.get(User, item.assigned_employee_id) if item.assigned_employee_id else None
        result.append(application_base_dict(db, item, product, assigned=assigned, internal=False))
    return result


@router.post("/applications", response_model=ApplicationDetail, status_code=201)
def create_application(
    payload: ApplicationCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    product = _product(db, payload.product_id)
    if payload.company_inn:
        valid, message = validate_inn(payload.company_inn)
        if not valid:
            raise HTTPException(status_code=422, detail=message)
    _check_purpose(product, payload.purpose)
    previous = None
    if payload.company_inn:
        previous = db.scalar(
            select(Application)
            .where(
                Application.user_id == user.id,
                Application.company_inn == payload.company_inn,
                Application.status == REJECTED,
            )
            .order_by(Application.created_at.desc())
            .limit(1)
        )
    application = Application(
        public_number=_number(),
        user_id=user.id,
        product_id=product.id,
        amount=payload.amount,
        term_months=payload.term_months,
        purpose=payload.purpose,
        collateral=payload.collateral,
        company_inn=payload.company_inn,
        company_name=payload.company_name,
        status=DRAFT,
        previous_application_id=previous.id if previous else None,
    )
    db.add(application)
    db.flush()
    add_event(
        db,
        application,
        event_type="DRAFT_CREATED",
        actor=user,
        comment="Черновик заявки создан.",
        details={"product": product.name},
    )
    write_audit(
        db,
        actor=user,
        action="application.created",
        entity_type="application",
        entity_id=application.id,
        after=_event_payload(application),
    )
    db.commit()
    return application_detail_dict(db, application, product, user)


@router.get("/applications/{application_id}", response_model=ApplicationDetail)
def get_application(
    application_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    application = _owned(db, application_id, user)
    product = _product(db, application.product_id, allow_inactive=True)
    assigned = db.get(User, application.assigned_employee_id) if application.assigned_employee_id else None
    return application_detail_dict(db, application, product, user, assigned=assigned)


@router.put("/applications/{application_id}", response_model=ApplicationDetail)
def update_application(
    application_id: int,
    payload: ApplicationUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    application = _owned(db, application_id, user, lock=True)
    if application.status != DRAFT:
        raise HTTPException(status_code=409, detail="Редактировать можно только черновик")
    before = _event_payload(application)
    data = payload.model_dump(exclude_unset=True)
    if "product_id" in data:
        product = _product(db, data["product_id"])
        application.product_id = product.id
    else:
        product = _product(db, application.product_id, allow_inactive=True)
    if "company_inn" in data and data["company_inn"]:
        valid, message = validate_inn(data["company_inn"])
        if not valid:
            raise HTTPException(status_code=422, detail=message)
    if "purpose" in data or "product_id" in data:
        # При смене продукта старая цель может ему не подходить.
        _check_purpose(product, data.get("purpose") or application.purpose)
    for field in ("amount", "term_months", "purpose", "company_inn", "company_name", "collateral"):
        if field in data and data[field] is not None:
            setattr(application, field, data[field])
    write_audit(
        db,
        actor=user,
        action="application.updated",
        entity_type="application",
        entity_id=application.id,
        before=before,
        after=_event_payload(application),
    )
    db.commit()
    return application_detail_dict(db, application, product, user)


@router.delete("/applications/{application_id}", status_code=204)
def delete_draft(
    application_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    application = _owned(db, application_id, user, lock=True)
    if application.status != DRAFT:
        raise HTTPException(status_code=409, detail="Удалить можно только черновик")
    write_audit(
        db,
        actor=user,
        action="application.draft_deleted",
        entity_type="application",
        entity_id=application.id,
        before=_event_payload(application),
    )
    # Дочерние строки удаляем явно: SQLite в тестах не применяет ON DELETE CASCADE.
    for model in (Document, ApplicationEvent, EnrichmentSnapshot, Notification, IdempotencyRecord):
        db.execute(delete(model).where(model.application_id == application.id))
    db.delete(application)
    db.commit()
    shutil.rmtree(Path(settings.upload_dir) / f"application_{application_id}", ignore_errors=True)
    return Response(status_code=204)


@router.post("/applications/{application_id}/submit", response_model=ApplicationDetail, status_code=202)
def submit_application(
    application_id: int,
    payload: SubmitRequest,
    background_tasks: BackgroundTasks,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    application = _owned(db, application_id, user, lock=True)
    if idempotency_key:
        existing = db.scalar(
            select(IdempotencyRecord).where(
                IdempotencyRecord.user_id == user.id,
                IdempotencyRecord.key == idempotency_key,
                IdempotencyRecord.action == "submit",
            )
        )
        if existing and existing.application_id:
            same = db.get(Application, existing.application_id)
            if same and same.user_id == user.id:
                product = _product(db, same.product_id, allow_inactive=True)
                return application_detail_dict(db, same, product, user)
    if application.status != DRAFT:
        raise HTTPException(status_code=409, detail="Отправить можно только черновик")
    if not (payload.authority_confirmed and payload.consent_bki and payload.consent_personal_data):
        raise HTTPException(
            status_code=422,
            detail="Подтвердите полномочия и согласия на запрос в БКИ и обработку персональных данных",
        )
    product = _product(db, application.product_id)
    valid, message = validate_inn(application.company_inn)
    if not valid:
        raise HTTPException(status_code=422, detail=message)
    if not application.company_name:
        raise HTTPException(status_code=422, detail="Проверьте компанию по ИНН перед отправкой")
    if float(application.amount) < float(product.min_amount) or float(application.amount) > float(product.max_amount):
        raise HTTPException(
            status_code=422,
            detail=f"Сумма должна быть от {float(product.min_amount):,.0f} до {float(product.max_amount):,.0f} ₽",
        )
    if application.term_months < product.min_term_months or application.term_months > product.max_term_months:
        raise HTTPException(
            status_code=422,
            detail=f"Срок должен быть от {product.min_term_months} до {product.max_term_months} мес.",
        )
    if product.requires_collateral and not application.collateral:
        raise HTTPException(status_code=422, detail="Для этого продукта требуется обеспечение")
    # В ответе на запрос цель не меняется, поэтому несовпадение здесь зациклило бы заявку в NEED_INFO.
    _check_purpose(product, application.purpose)
    # Неизвестный ИНН отклоняем на сервере, а не только в мастере: иначе через API заявка уйдёт в бесконечный NEED_INFO.
    # Если реестр недоступен, не блокируем отправку — проверка повторится в конвейере.
    registry = _registry_or_none(application.company_inn)
    if registry:
        application.company_name = registry.get("name") or application.company_name
    application.authority_basis = resolve_authority(user, application, registry)
    if idempotency_key:
        db.add(
            IdempotencyRecord(
                user_id=user.id,
                key=idempotency_key[:128],
                action="submit",
                application_id=application.id,
            )
        )
    application.submitted_at = datetime.now(timezone.utc)
    transition_application(
        db,
        application,
        SUBMITTED,
        actor=user,
        comment="Клиент отправил заявку на рассмотрение.",
    )
    add_event(
        db,
        application,
        event_type="APPLICATION_SUBMITTED",
        actor=user,
        comment=f"Заявка отправлена ({SIGNER_POSITIONS[payload.signer_position].lower()}). Автоматические проверки начались.",
        details=_consents(payload),
    )
    write_audit(
        db,
        actor=user,
        action="application.submitted",
        entity_type="application",
        entity_id=application.id,
        after={
            "number": application.public_number,
            "status": application.status,
            "authority_basis": application.authority_basis,
            **_consents(payload),
        },
    )
    try:
        db.commit()
    except Exception:
        db.rollback()
        if idempotency_key:
            existing = db.scalar(
                select(IdempotencyRecord).where(
                    IdempotencyRecord.user_id == user.id,
                    IdempotencyRecord.key == idempotency_key,
                    IdempotencyRecord.action == "submit",
                )
            )
            if existing and existing.application_id:
                same = db.get(Application, existing.application_id)
                if same:
                    return application_detail_dict(db, same, product, user)
        raise
    background_tasks.add_task(run_pipeline, application.id)
    db.refresh(application)
    return application_detail_dict(db, application, product, user)


@router.post("/applications/{application_id}/respond", response_model=ApplicationDetail, status_code=202)
def respond_info(
    application_id: int,
    payload: RespondInfoRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    application = _owned(db, application_id, user, lock=True)
    if application.status != NEED_INFO:
        raise HTTPException(status_code=409, detail="Сейчас заявка не ожидает уточнений")
    before = {"status": application.status, "client_comment": application.client_comment}
    if payload.company_inn:
        inn = payload.company_inn.strip()
        valid, reason = validate_inn(inn)
        if not valid:
            raise HTTPException(status_code=422, detail=reason)
        before["company_inn"] = application.company_inn
        application.company_inn = inn
        registry = _registry_or_none(inn)
        if registry:
            application.company_name = registry.get("name") or application.company_name
        application.authority_basis = resolve_authority(user, application, registry)
    application.client_comment = payload.comment
    if payload.declared_revenue is not None:
        application.declared_revenue = payload.declared_revenue
    if payload.declared_profit is not None:
        application.declared_profit = payload.declared_profit
    transition_application(
        db,
        application,
        "VALIDATION",
        actor=user,
        comment="Клиент ответил на запрос уточнений.",
        details={"comment": payload.comment},
    )
    add_event(
        db,
        application,
        event_type="CLIENT_RESPONDED",
        actor=user,
        comment=payload.comment,
        details={
            "declared_revenue": payload.declared_revenue,
            "declared_profit": payload.declared_profit,
        },
    )
    write_audit(
        db,
        actor=user,
        action="application.info_provided",
        entity_type="application",
        entity_id=application.id,
        before=before,
        after={
            "status": application.status,
            "declared_revenue": payload.declared_revenue,
            "declared_profit": payload.declared_profit,
        },
    )
    db.commit()
    preferred = application.assigned_employee_id
    background_tasks.add_task(run_pipeline, application.id, preferred)
    product = _product(db, application.product_id, allow_inactive=True)
    return application_detail_dict(db, application, product, user)


@router.post("/applications/{application_id}/offer", response_model=ApplicationDetail)
def respond_offer(
    application_id: int,
    payload: OfferRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    application = _owned(db, application_id, user, lock=True)
    if application.status not in {APPROVED, APPROVED_CHANGED}:
        raise HTTPException(status_code=409, detail="Оферта сейчас недоступна")
    if application.offer_expires_at:
        expires = application.offer_expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires < datetime.now(timezone.utc):
            raise HTTPException(status_code=409, detail="Срок действия оферты истёк")
    target = OFFER_ACCEPTED if payload.accept else OFFER_DECLINED
    before_status = application.status
    transition_application(
        db,
        application,
        target,
        actor=user,
        comment="Клиент принял оферту." if payload.accept else "Клиент отклонил оферту.",
    )
    if payload.accept:
        application.accepted_at = datetime.now(timezone.utc)
    else:
        application.declined_at = datetime.now(timezone.utc)
    add_event(
        db,
        application,
        event_type="OFFER_ACCEPTED" if payload.accept else "OFFER_DECLINED",
        actor=user,
        comment="Решение клиента по оферте зафиксировано.",
    )
    write_audit(
        db,
        actor=user,
        action="offer.accepted" if payload.accept else "offer.declined",
        entity_type="application",
        entity_id=application.id,
        before={"status": before_status},
        after={"status": application.status, "accepted": payload.accept},
    )
    if application.assigned_employee_id:
        from ..services.notifications import notify

        notify(
            db,
            user_id=application.assigned_employee_id,
            application_id=application.id,
            title="Клиент ответил на оферту",
            body=f"Заявка {application.public_number}: {'оферта принята' if payload.accept else 'оферта отклонена'}.",
            kind="info",
        )
    db.commit()
    product = _product(db, application.product_id, allow_inactive=True)
    return application_detail_dict(db, application, product, user)


@router.post("/applications/{application_id}/sign", response_model=ApplicationDetail)
def sign_offer(
    application_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    application = _owned(db, application_id, user, lock=True)
    if application.status != OFFER_ACCEPTED:
        raise HTTPException(status_code=409, detail="Сначала примите оферту")
    application.signed_at = datetime.now(timezone.utc)
    transition_application(
        db,
        application,
        SIGNED,
        actor=user,
        comment="Демонстрационное подписание договора подтверждено клиентом.",
    )
    add_event(
        db,
        application,
        event_type="SIGNED_DEMO",
        actor=user,
        comment="Договор подписан.",
        details={"demo": True},
    )
    write_audit(
        db,
        actor=user,
        action="contract.signed_demo",
        entity_type="application",
        entity_id=application.id,
        after={"status": application.status, "demo": True},
    )
    db.commit()
    product = _product(db, application.product_id, allow_inactive=True)
    return application_detail_dict(db, application, product, user)


@router.post("/applications/{application_id}/disburse", response_model=ApplicationDetail)
def disburse(
    application_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    application = _owned(db, application_id, user, lock=True)
    if application.status != SIGNED:
        raise HTTPException(status_code=409, detail="Сначала подпишите договор")
    application.disbursed_at = datetime.now(timezone.utc)
    transition_application(
        db,
        application,
        DISBURSED,
        actor=user,
        comment="Демонстрационное зачисление средств подтверждено.",
    )
    add_event(
        db,
        application,
        event_type="DISBURSED_DEMO",
        actor=user,
        comment="Средства зачислены на расчётный счёт компании.",
        details={"demo": True},
    )
    write_audit(
        db,
        actor=user,
        action="funds.disbursed_demo",
        entity_type="application",
        entity_id=application.id,
        after={"status": application.status, "demo": True},
    )
    db.commit()
    product = _product(db, application.product_id, allow_inactive=True)
    return application_detail_dict(db, application, product, user)


@router.post("/applications/{application_id}/resubmit", response_model=ApplicationDetail, status_code=201)
def resubmit(
    application_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    source = _owned(db, application_id, user, lock=True)
    if source.status != REJECTED:
        raise HTTPException(status_code=409, detail="Повторно подать можно только отклонённую заявку")
    product = _product(db, source.product_id, allow_inactive=True)
    if not product.is_active:
        raise HTTPException(status_code=409, detail="Этот продукт больше не выдаётся. Создайте новую заявку на другой продукт.")
    existing = db.scalar(
        select(Application)
        .where(
            Application.previous_application_id == source.id,
            Application.user_id == user.id,
            Application.status == DRAFT,
        )
        .limit(1)
    )
    if existing is not None:
        # Повторный клик открывает уже созданный черновик, а не плодит копии.
        return application_detail_dict(db, existing, _product(db, existing.product_id, allow_inactive=True), user)
    copy = Application(
        public_number=_number(),
        user_id=user.id,
        product_id=source.product_id,
        amount=source.amount,
        term_months=source.term_months,
        purpose=source.purpose,
        collateral=source.collateral,
        company_inn=source.company_inn,
        company_name=source.company_name,
        status=DRAFT,
        previous_application_id=source.id,
    )
    db.add(copy)
    db.flush()
    add_event(
        db,
        copy,
        event_type="RESUBMITTED_DRAFT",
        actor=user,
        comment=f"Черновик создан на основе заявки {source.public_number}.",
        details={"source_application_id": source.id},
    )
    write_audit(
        db,
        actor=user,
        action="application.resubmitted",
        entity_type="application",
        entity_id=copy.id,
        after={"source_application_id": source.id},
    )
    db.commit()
    return application_detail_dict(db, copy, product, user)


@router.post("/applications/{application_id}/documents", response_model=DocumentOut, status_code=201)
def upload_document(
    application_id: int,
    file: UploadFile = File(...),
    purpose: Literal["general", "power_of_attorney"] = Query("general"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Document:
    application = _owned(db, application_id, user)
    if application.status not in {DRAFT, NEED_INFO}:
        raise HTTPException(status_code=409, detail="Загрузка документов доступна для черновика и запроса уточнений")
    content_type = file.content_type or ""
    if content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=415, detail="Допустимы только PDF, JPEG и PNG")
    original = Path(file.filename or "document").name[:255]
    suffix = Path(original).suffix.lower()
    if suffix not in {".pdf", ".jpg", ".jpeg", ".png"}:
        raise HTTPException(status_code=415, detail="Недопустимое расширение файла")
    # Синхронный обработчик: FastAPI выполнит его в пуле потоков и не заблокирует event loop работой с БД.
    data = file.file.read(MAX_UPLOAD_BYTES + 1)
    file.file.close()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"Файл больше {settings.max_upload_mb} МБ")
    if not _valid_signature(data, content_type):
        raise HTTPException(status_code=415, detail="Содержимое файла не соответствует формату")
    stored = f"{uuid.uuid4().hex}{'.jpg' if suffix == '.jpeg' else suffix}"
    directory = Path(settings.upload_dir) / f"application_{application.id}"
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / stored
    target.write_bytes(data)
    document = Document(
        application_id=application.id,
        uploaded_by_id=user.id,
        original_name=original,
        stored_name=stored,
        content_type=content_type,
        size_bytes=len(data),
    )
    db.add(document)
    db.flush()
    if purpose == "power_of_attorney":
        application.authority_document_id = document.id
    add_event(
        db,
        application,
        event_type="DOCUMENT_UPLOADED",
        actor=user,
        comment=f"Загружена доверенность: {original}" if purpose == "power_of_attorney" else f"Загружен документ: {original}",
        details={"document_id": document.id, "size": len(data), "purpose": purpose},
    )
    write_audit(
        db,
        actor=user,
        action="document.uploaded",
        entity_type="application",
        entity_id=application.id,
        after={"filename": original, "size": len(data), "mime": content_type},
    )
    try:
        db.commit()
    except Exception:
        db.rollback()
        target.unlink(missing_ok=True)
        raise
    db.refresh(document)
    return document


def _valid_signature(data: bytes, content_type: str) -> bool:
    if content_type == "application/pdf":
        return data.startswith(b"%PDF")
    if content_type == "image/png":
        return data.startswith(b"\x89PNG\r\n\x1a\n")
    if content_type == "image/jpeg":
        return data.startswith(b"\xff\xd8\xff")
    return False


@router.get("/applications/{application_id}/documents/{document_id}")
def download_document(
    application_id: int,
    document_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    _owned(db, application_id, user)
    return document_response(db, application_id, document_id)

