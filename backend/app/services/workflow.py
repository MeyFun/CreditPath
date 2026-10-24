from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select

from ..db import SessionLocal
from ..models import Application, EnrichmentSnapshot, Product
from .assignment import assign_reviewer
from .audit import write_audit
from .credit_logic import evaluate_application
from .external import ExternalServiceError, fetch_bki, fetch_registry
from .inn import validate_inn
from .notifications import notify, notify_admins
from .scoring import calculate_score
from .scoring_config import get_active_config
from .state_machine import (
    DECISION_DRAFT,
    ENRICHMENT,
    IN_REVIEW,
    NEED_INFO,
    SCORING,
    SUBMITTED,
    VALIDATION,
    add_event,
    transition_application,
)
from .state_machine import PIPELINE_STATUSES

logger = logging.getLogger("creditpath.workflow")


def run_pipeline(application_id: int, preferred_employee_id: int | None = None) -> None:
    """Асинхронный конвейер. Каждый этап фиксируется отдельным коммитом."""
    db = SessionLocal()
    application: Application | None = None
    try:
        application = db.get(Application, application_id)
        if application is None or application.status not in PIPELINE_STATUSES:
            return
        product = db.get(Product, application.product_id)
        if product is None:
            _set_technical_need_info(application_id, "Продукт заявки больше недоступен.")
            return

        if application.status == SUBMITTED:
            transition_application(
                db,
                application,
                VALIDATION,
                comment="Заявка принята и передана на автоматическую проверку.",
            )
            notify(
                db,
                user_id=application.user_id,
                application_id=application.id,
                title="Заявка отправлена",
                body=f"Заявка {application.public_number} принята. Автоматические проверки уже начались.",
                kind="info",
            )
            db.commit()

        if application.status == VALIDATION:
            validation_error = _validate_application(application, product)
            if validation_error:
                _move_to_need_info(
                    db,
                    application,
                    "Проверка данных",
                    validation_error,
                    notify_client=True,
                )
                db.commit()
                return
            add_event(
                db,
                application,
                event_type="VALIDATION_PASSED",
                actor=None,
                comment="Формат данных и ИНН проверены.",
                details={"inn_valid": True, "fields_complete": True},
            )
            transition_application(
                db,
                application,
                ENRICHMENT,
                comment="Данные корректны, запрашиваем сведения в реестре и кредитной истории.",
            )
            db.commit()

        if application.status == ENRICHMENT:
            if not _enrich(db, application):
                return
            db.commit()

        if application.status == SCORING:
            config, _ = get_active_config(db)
            registry = _registry_for_scoring(db, application)
            bki = _bki_snapshot(db, application)
            scoring = calculate_score(
                registry=registry,
                bki=bki,
                amount=float(application.amount),
                collateral=application.collateral,
                config=config,
            )
            application.scoring_score = scoring["score"]
            application.scoring_result = scoring
            add_event(
                db,
                application,
                event_type="SCORING_COMPLETED",
                actor=None,
                comment=f"Скоринг завершён: {scoring['score']} из 100.",
                details={"score": scoring["score"], "factors": scoring["factors"]},
            )
            transition_application(
                db,
                application,
                DECISION_DRAFT,
                comment="Скоринг завершён, применяем правила кредитной логики.",
            )
            db.commit()

        if application.status == DECISION_DRAFT:
            config, _ = get_active_config(db)
            registry = _registry_for_scoring(db, application)
            bki = _bki_snapshot(db, application)
            scoring = application.scoring_result or {"score": 0, "negative_reasons": []}
            decision = evaluate_application(
                application=application,
                product=product,
                registry=registry,
                bki=bki,
                scoring=scoring,
                config=config,
            )
            application.decision_draft = decision
            add_event(
                db,
                application,
                event_type="DECISION_DRAFT",
                actor=None,
                comment=f"Предварительное решение: {decision['summary']}.",
                details=decision,
            )
            if decision["outcome"] == "need_info":
                _move_to_need_info(
                    db,
                    application,
                    "Нужны дополнительные данные",
                    " ".join(decision["reasons"]),
                    notify_client=True,
                )
                db.commit()
                return
            transition_application(
                db,
                application,
                IN_REVIEW,
                comment="Автоматические проверки завершены. Заявка передана сотруднику банка.",
                details={"draft_outcome": decision["outcome"], "score": decision["score"]},
            )
            employee = assign_reviewer(
                db,
                application,
                preferred_employee_id=preferred_employee_id or application.assigned_employee_id,
            )
            if employee:
                add_event(
                    db,
                    application,
                    event_type="ASSIGNED",
                    actor=None,
                    comment=f"Заявка назначена сотруднику {employee.full_name}.",
                    details={"employee_id": employee.id},
                )
                write_audit(
                    db,
                    actor=None,
                    action="application.assigned",
                    entity_type="application",
                    entity_id=application.id,
                    after={"employee_id": employee.id, "employee_name": employee.full_name},
                    actor_label="Система (назначение)",
                )
                notify(
                    db,
                    user_id=employee.id,
                    application_id=application.id,
                    title="Новая заявка в работе",
                    body=f"Заявка {application.public_number} от {application.company_name or 'компании'} назначена вам.",
                    kind="action",
                )
                notify(
                    db,
                    user_id=application.user_id,
                    application_id=application.id,
                    title="Заявка на рассмотрении у сотрудника",
                    body=f"Заявка {application.public_number} прошла автоматические проверки и передана сотруднику банка.",
                    kind="info",
                )
            else:
                add_event(
                    db,
                    application,
                    event_type="QUEUED_FOR_ADMIN",
                    actor=None,
                    comment=application.queue_reason,
                )
                write_audit(
                    db,
                    actor=None,
                    action="application.queued_for_admin",
                    entity_type="application",
                    entity_id=application.id,
                    after={"reason": application.queue_reason},
                    actor_label="Система (назначение)",
                )
                notify_admins(
                    db,
                    title="Заявка без назначенного сотрудника",
                    body=f"Заявка {application.public_number} ожидает назначения: {application.queue_reason}",
                    application_id=application.id,
                )
                notify(
                    db,
                    user_id=application.user_id,
                    application_id=application.id,
                    title="Заявка на рассмотрении",
                    body=f"Заявка {application.public_number} прошла автоматические проверки и ожидает назначения сотрудника.",
                    kind="info",
                )
            db.commit()

    except Exception:
        logger.exception("Сбой конвейера заявки %s", application_id)
        db.rollback()
        _set_technical_need_info(
            application_id,
            "Автоматическая проверка прервалась. Заявка сохранена, сотрудник банка увидит её и свяжется с вами через центр уведомлений.",
        )
    finally:
        db.close()


def resume_stalled_pipelines() -> int:
    """Конвейер живёт в процессе API: после рестарта дожимаем заявки, застрявшие на автоматических этапах."""
    db = SessionLocal()
    try:
        ids = list(db.scalars(select(Application.id).where(Application.status.in_(PIPELINE_STATUSES))))
    finally:
        db.close()
    for application_id in ids:
        logger.info("Возобновляем конвейер заявки %s после перезапуска", application_id)
        run_pipeline(application_id)
    return len(ids)


def _validate_application(application: Application, product: Product) -> str | None:
    valid, message = validate_inn(application.company_inn)
    if not valid:
        return message
    if not application.company_name:
        return "Не заполнено наименование компании."
    if not product.is_active:
        return "Выбранный кредитный продукт временно недоступен."
    if float(application.amount) < float(product.min_amount) or float(application.amount) > float(product.max_amount):
        return f"Сумма должна быть в диапазоне продукта «{product.name}»."
    if application.term_months < product.min_term_months or application.term_months > product.max_term_months:
        return f"Срок должен быть в диапазоне продукта «{product.name}»."
    purposes = {item.get("code") for item in product.purposes or []}
    if purposes and application.purpose not in purposes:
        return "Цель кредита не соответствует выбранному продукту."
    if product.requires_collateral and not application.collateral:
        return f"Для продукта «{product.name}» необходимо обеспечение."
    return None


def _enrich(db, application: Application) -> bool:
    with ThreadPoolExecutor(max_workers=2) as executor:
        registry_future = executor.submit(fetch_registry, application.company_inn or "")
        bki_future = executor.submit(fetch_bki, application.company_inn or "")
        registry: dict[str, Any] | None = None
        bki: dict[str, Any] | None = None
        errors: dict[str, Any] = {}
        try:
            registry = registry_future.result()
        except ExternalServiceError as exc:
            errors["registry"] = {"code": exc.code, "message": exc.message}
        try:
            bki = bki_future.result()
        except ExternalServiceError as exc:
            errors["bki"] = {"code": exc.code, "message": exc.message}

    snapshot = db.scalar(
        select(EnrichmentSnapshot).where(EnrichmentSnapshot.application_id == application.id).limit(1)
    )
    if snapshot is None:
        snapshot = EnrichmentSnapshot(application_id=application.id)
        db.add(snapshot)
    snapshot.registry_data = registry
    snapshot.bki_data = bki
    snapshot.registry_ok = registry is not None
    snapshot.bki_ok = bki is not None
    snapshot.errors = errors or None
    snapshot.fetched_at = datetime.now(timezone.utc)
    application.company_name = (registry or {}).get("name") or application.company_name
    db.flush()

    if registry is None:
        error = errors.get("registry", {})
        if error.get("code") == "not_found":
            _move_to_need_info(
                db,
                application,
                "Компания не найдена в реестре",
                "Компания с таким ИНН не найдена в реестре. Укажите верный ИНН в ответе на запрос.",
                notify_client=True,
            )
            db.commit()
            return False
        _move_to_need_info(
            db,
            application,
            "Проверка временно недоступна",
            "Реестр компаний не ответил. Данные заявки сохранены; проверку можно повторить позже.",
            notify_client=True,
        )
        db.commit()
        return False

    if bki is None:
        error = errors.get("bki", {})
        if error.get("code") == "not_found":
            snapshot.bki_data = {"credit_history_found": False}
            add_event(
                db,
                application,
                event_type="ENRICHMENT_PARTIAL",
                actor=None,
                comment="Кредитная история не найдена; заявка обработана без истории БКИ.",
            )
        else:
            _move_to_need_info(
                db,
                application,
                "Проверка временно недоступна",
                "Сервис кредитной истории не ответил. Данные заявки сохранены; проверку можно повторить позже.",
                notify_client=True,
            )
            db.commit()
            return False

    add_event(
        db,
        application,
        event_type="ENRICHMENT_COMPLETED",
        actor=None,
        comment="Сведения реестра и кредитной истории получены и сохранены как снимок.",
        details={"registry_ok": registry is not None, "bki_ok": bki is not None, "errors": errors or None},
    )
    transition_application(
        db,
        application,
        SCORING,
        comment="Обогащение завершено, рассчитываем скоринговую оценку.",
    )
    db.commit()
    return True


def _registry_for_scoring(db, application: Application) -> dict[str, Any]:
    snapshot = db.scalar(
        select(EnrichmentSnapshot).where(EnrichmentSnapshot.application_id == application.id).limit(1)
    )
    registry = deepcopy(snapshot.registry_data) if snapshot and snapshot.registry_data else {}
    if registry and (registry.get("revenue") is None or registry.get("profit") is None):
        if application.declared_revenue is not None:
            registry["revenue"] = float(application.declared_revenue)
            registry["financial_source"] = "client_declared"
        if application.declared_profit is not None:
            registry["profit"] = float(application.declared_profit)
            registry["financial_source"] = "client_declared"
    return registry


def _bki_snapshot(db, application: Application) -> dict[str, Any]:
    snapshot = db.scalar(
        select(EnrichmentSnapshot).where(EnrichmentSnapshot.application_id == application.id).limit(1)
    )
    return snapshot.bki_data if snapshot and snapshot.bki_data else {}


def _move_to_need_info(
    db,
    application: Application,
    title: str,
    message: str,
    *,
    notify_client: bool,
) -> None:
    transition_application(
        db,
        application,
        NEED_INFO,
        comment=message,
        details={"request_title": title},
    )
    add_event(
        db,
        application,
        event_type="INFO_REQUESTED",
        actor=None,
        comment=message,
        details={"title": title},
    )
    if notify_client:
        notify(
            db,
            user_id=application.user_id,
            application_id=application.id,
            title=title,
            body=message,
            kind="warning",
        )
    if application.assigned_employee_id:
        notify(
            db,
            user_id=application.assigned_employee_id,
            application_id=application.id,
            title="Клиенту требуется уточнение",
            body=f"По заявке {application.public_number}: {message}",
            kind="action",
        )


def _set_technical_need_info(application_id: int, message: str) -> None:
    db = SessionLocal()
    try:
        application = db.get(Application, application_id)
        if application is None or application.status not in PIPELINE_STATUSES:
            return
        if application.status == SUBMITTED:
            transition_application(db, application, VALIDATION, comment="Заявка принята.")
        if application.status in (VALIDATION, ENRICHMENT, SCORING, DECISION_DRAFT):
            transition_application(
                db,
                application,
                NEED_INFO,
                comment=message,
                details={"technical_error": True},
            )
            add_event(
                db,
                application,
                event_type="TECHNICAL_RETRY_REQUIRED",
                actor=None,
                comment=message,
            )
            notify(
                db,
                user_id=application.user_id,
                application_id=application.id,
                title="Проверка приостановлена",
                body=message,
                kind="warning",
            )
            db.commit()
    except Exception:
        logger.exception("Не удалось перевести заявку %s в NEED_INFO", application_id)
        db.rollback()
    finally:
        db.close()
