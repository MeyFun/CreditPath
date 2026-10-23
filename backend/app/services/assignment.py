from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import Application, ROLE_EMPLOYEE, User
from .state_machine import IN_REVIEW, NEED_INFO, REVIEW_STATUSES


def _chain_application_ids(db: Session, application: Application) -> list[int]:
    ids: list[int] = []
    current = application
    seen: set[int] = {application.id}
    while current.previous_application_id is not None:
        previous_id = current.previous_application_id
        if previous_id in seen or len(ids) >= 50:
            break
        previous = db.get(Application, previous_id)
        if previous is None:
            break
        ids.append(previous.id)
        seen.add(previous_id)
        current = previous
    return ids


def chain_reviewer_ids(db: Session, application: Application) -> set[int]:
    reviewers: set[int] = set()
    chain_ids = _chain_application_ids(db, application)
    if chain_ids:
        chain = db.scalars(select(Application).where(Application.id.in_(chain_ids))).all()
        for item in chain:
            if item.assigned_employee_id:
                reviewers.add(item.assigned_employee_id)
            if item.decision_by_id:
                reviewers.add(item.decision_by_id)
    return reviewers


def _load_by_employee(db: Session) -> dict[int, int]:
    rows = db.execute(
        select(Application.assigned_employee_id, func.count(Application.id))
        .where(Application.status.in_(REVIEW_STATUSES), Application.assigned_employee_id.is_not(None))
        .group_by(Application.assigned_employee_id)
    ).all()
    return {employee_id: count for employee_id, count in rows if employee_id is not None}


def pick_employee(
    db: Session,
    application: Application,
    *,
    preferred_employee_id: int | None = None,
) -> tuple[User | None, str | None]:
    excluded = chain_reviewer_ids(db, application)
    excluded.add(application.user_id)
    applicant = db.get(User, application.user_id)
    if applicant and applicant.related_employee_id:
        excluded.add(applicant.related_employee_id)

    if preferred_employee_id is not None and preferred_employee_id not in excluded:
        preferred = db.get(User, preferred_employee_id)
        if preferred and preferred.is_active and preferred.role == ROLE_EMPLOYEE:
            return preferred, None

    candidates = db.scalars(
        select(User)
        .where(User.role == ROLE_EMPLOYEE, User.is_active.is_(True))
        .order_by(User.id.asc())
    ).all()
    candidates = [candidate for candidate in candidates if candidate.id not in excluded]
    if not candidates:
        return None, "Нет доступных сотрудников с учётом правила «свежего взгляда». Требуется назначение администратора."

    loads = _load_by_employee(db)
    candidates.sort(key=lambda employee: (loads.get(employee.id, 0), employee.id))
    return candidates[0], None


def assign_reviewer(
    db: Session,
    application: Application,
    *,
    preferred_employee_id: int | None = None,
) -> User | None:
    employee, queue_reason = pick_employee(db, application, preferred_employee_id=preferred_employee_id)
    application.assigned_employee_id = employee.id if employee else None
    application.queue_reason = queue_reason
    return employee
