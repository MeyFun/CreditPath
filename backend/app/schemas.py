from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    full_name: str
    role: str
    company_inn: str | None = None
    is_active: bool
    created_at: datetime
    last_login_at: datetime | None = None


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserOut


class ProductOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str
    short_description: str
    description: str
    min_amount: float
    max_amount: float
    min_term_months: int
    max_term_months: int
    rate: float
    min_business_age_months: int
    requires_collateral: bool
    revenue_limit_ratio: float
    purposes: list[dict[str, Any]]
    is_active: bool
    sort_order: int


class PurposeIn(BaseModel):
    code: str = Field(pattern=r"^[a-z][a-z0-9_]{1,39}$")
    label: str = Field(min_length=2, max_length=120)


def _unique_purposes(items: list[PurposeIn]) -> list[PurposeIn]:
    if not items:
        raise ValueError("Добавьте хотя бы одну цель кредитования")
    if len({item.code for item in items}) != len(items):
        raise ValueError("Коды целей не должны повторяться")
    return items


class ProductCreate(BaseModel):
    code: str = Field(pattern=r"^[A-Z][A-Z0-9_]{1,31}$")
    name: str = Field(min_length=2, max_length=120)
    short_description: str = Field(min_length=2, max_length=255)
    description: str = Field(default="")
    min_amount: float = Field(gt=0)
    max_amount: float = Field(gt=0)
    min_term_months: int = Field(ge=1, le=120)
    max_term_months: int = Field(ge=1, le=120)
    rate: float = Field(gt=0, le=100)
    min_business_age_months: int = Field(default=0, ge=0, le=120)
    requires_collateral: bool = False
    revenue_limit_ratio: float = Field(default=0.4, gt=0, le=1.5)
    is_active: bool = True
    purposes: list[PurposeIn]

    @field_validator("purposes")
    @classmethod
    def check_purposes(cls, value: list[PurposeIn]) -> list[PurposeIn]:
        return _unique_purposes(value)


class ProductUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    short_description: str | None = Field(default=None, max_length=255)
    description: str | None = None
    min_amount: float | None = Field(default=None, gt=0)
    max_amount: float | None = Field(default=None, gt=0)
    min_term_months: int | None = Field(default=None, ge=1, le=120)
    max_term_months: int | None = Field(default=None, ge=1, le=120)
    rate: float | None = Field(default=None, gt=0, le=100)
    min_business_age_months: int | None = Field(default=None, ge=0, le=120)
    requires_collateral: bool | None = None
    revenue_limit_ratio: float | None = Field(default=None, gt=0, le=1.5)
    is_active: bool | None = None
    purposes: list[PurposeIn] | None = None

    @field_validator("purposes")
    @classmethod
    def check_purposes(cls, value: list[PurposeIn] | None) -> list[PurposeIn] | None:
        return None if value is None else _unique_purposes(value)


class ApplicationCreate(BaseModel):
    product_id: int
    amount: float = Field(gt=0)
    term_months: int = Field(ge=1, le=120)
    purpose: str = Field(min_length=1, max_length=80)
    company_inn: str | None = Field(default=None, min_length=10, max_length=12)
    company_name: str | None = Field(default=None, max_length=255)
    collateral: bool = False


class ApplicationUpdate(BaseModel):
    product_id: int | None = None
    amount: float | None = Field(default=None, gt=0)
    term_months: int | None = Field(default=None, ge=1, le=120)
    purpose: str | None = Field(default=None, min_length=1, max_length=80)
    company_inn: str | None = Field(default=None, min_length=10, max_length=12)
    company_name: str | None = Field(default=None, max_length=255)
    collateral: bool | None = None


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    original_name: str
    content_type: str
    size_bytes: int
    created_at: datetime


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    event_type: str
    status_from: str | None
    status_to: str | None
    actor_role: str
    comment: str | None
    details: dict[str, Any] | None
    created_at: datetime


class ApplicationOut(BaseModel):
    id: int
    number: str
    status: str
    status_label: str
    client_status: str
    product: ProductOut
    company_inn: str | None
    company_name: str | None
    authority_basis: str | None = None
    authority_document_id: int | None = None
    amount: float
    term_months: int
    purpose: str
    purpose_label: str
    collateral: bool
    created_at: datetime
    submitted_at: datetime | None
    updated_at: datetime
    scoring_score: int | None
    final_outcome: str | None
    approved_amount: float | None
    approved_term_months: int | None
    approved_rate: float | None
    assigned_employee: dict[str, Any] | None = None
    queue_reason: str | None = None
    previous_application_id: int | None = None
    documents_count: int = 0


class ApplicationDetail(ApplicationOut):
    scoring: dict[str, Any] | None = None
    decision_draft: dict[str, Any] | None = None
    employee_comment: str | None = None
    decision_by: dict[str, Any] | None = None
    declared_revenue: float | None = None
    declared_profit: float | None = None
    client_comment: str | None = None
    offer_expires_at: datetime | None = None
    accepted_at: datetime | None = None
    signed_at: datetime | None = None
    disbursed_at: datetime | None = None
    events: list[EventOut] = []
    documents: list[DocumentOut] = []
    registry_snapshot: dict[str, Any] | None = None
    bki_snapshot: dict[str, Any] | None = None
    enrichment_errors: dict[str, Any] | None = None
    can_edit: bool = False
    can_submit: bool = False
    can_respond: bool = False
    can_accept_offer: bool = False
    can_decline_offer: bool = False
    can_sign: bool = False
    can_disburse: bool = False
    can_resubmit: bool = False
    can_decide: bool = False
    previous_decisions: list[dict[str, Any]] = []
    related_party: bool = False
    risk_override_reasons: list[str] = []


class DashboardOut(BaseModel):
    applications: list[ApplicationOut]
    counts: dict[str, int]
    total_approved_amount: float
    unread_notifications: int
    company: dict[str, Any] | None = None


class DecisionRequest(BaseModel):
    action: Literal["approve", "approve_changed", "need_info", "reject"]
    # Для «других условий» банк может предложить другой продукт.
    product_id: int | None = None
    approved_amount: float | None = Field(default=None, gt=0, allow_inf_nan=False)
    approved_term_months: int | None = Field(default=None, ge=1, le=120)
    comment: str | None = Field(default=None, max_length=4000)
    # Обязательно при одобрении заявки, поданной по доверенности.
    authority_verified: bool = False


SIGNER_POSITIONS = {
    "owner": "Собственник бизнеса",
    "ceo": "Генеральный директор",
    "cfo": "Финансовый директор",
    "accountant": "Бухгалтер",
    "authorized": "Уполномоченный сотрудник",
    "entrepreneur": "Индивидуальный предприниматель",
}


class SubmitRequest(BaseModel):
    """Подтверждения заявителя при отправке: полномочия и согласия."""

    signer_position: Literal["owner", "ceo", "cfo", "accountant", "authorized", "entrepreneur"]
    authority_confirmed: bool
    consent_bki: bool
    consent_personal_data: bool


class RespondInfoRequest(BaseModel):
    comment: str = Field(min_length=2, max_length=4000)
    declared_revenue: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    declared_profit: float | None = Field(default=None, allow_inf_nan=False)
    company_inn: str | None = Field(default=None, max_length=20)


class OfferRequest(BaseModel):
    accept: bool


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=32, pattern=r"^[A-Za-z0-9_.-]+$")
    full_name: str = Field(min_length=2, max_length=160)
    password: str = Field(min_length=8, max_length=128)
    role: Literal["client", "employee"] = "client"
    company_inn: str | None = Field(default=None, min_length=10, max_length=12)

    @field_validator("password")
    @classmethod
    def password_strength(cls, value: str) -> str:
        if not any(char.isdigit() for char in value) or not any(char.isalpha() for char in value):
            raise ValueError("Пароль должен содержать буквы и цифры")
        return value


class RoleUpdateRequest(BaseModel):
    role: Literal["client", "employee"]


class AssignRequest(BaseModel):
    employee_id: int


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    application_id: int | None
    title: str
    body: str
    kind: str
    is_read: bool
    created_at: datetime


class NotificationsResponse(BaseModel):
    items: list[NotificationOut]
    unread: int


class AuditOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    actor_id: int | None
    actor_label: str
    action: str
    entity_type: str
    entity_id: str | None
    before: dict[str, Any] | None
    after: dict[str, Any] | None
    previous_hash: str
    entry_hash: str


class AuditVerifyOut(BaseModel):
    valid: bool
    checked: int
    broken_at: int | None = None
    message: str


class ScoringConfigUpdate(BaseModel):
    config: dict[str, Any]


class ScoringConfigOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    version: int
    config: dict[str, Any]
    is_active: bool
    created_at: datetime


class EmployeeStatsOut(BaseModel):
    in_review: int
    need_info: int
    total_assigned: int
    approved_total: float


class MessageOut(BaseModel):
    message: str


class HealthOut(BaseModel):
    status: str
    version: str
