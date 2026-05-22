"""Pydantic models for TYS. UUID strings as `id`; no Mongo `_id` leakage."""
from datetime import datetime
from typing import List, Literal, Optional
from pydantic import BaseModel, ConfigDict, EmailStr, Field

# ──────────────────────────────────────────────────────────────────────────────
# Common
# ──────────────────────────────────────────────────────────────────────────────
class TimestampedModel(BaseModel):
    model_config = ConfigDict(extra="ignore")


# ──────────────────────────────────────────────────────────────────────────────
# Tenants (from POC)
# ──────────────────────────────────────────────────────────────────────────────
class TenantOut(TimestampedModel):
    slug: str
    name: str
    status: Literal["active", "suspended", "inactive"]


class ResolveResponse(BaseModel):
    tenant: Optional[TenantOut] = None


# ──────────────────────────────────────────────────────────────────────────────
# Users / Auth
# ──────────────────────────────────────────────────────────────────────────────
UserRole = Literal["super_admin", "organizer"]
OrgStatus = Literal["pending", "approved", "rejected", "suspended"]
SubStatus = Literal["none", "trialing", "active", "past_due", "canceled"]


class UserOut(TimestampedModel):
    id: str
    email: EmailStr
    role: UserRole
    organizer_id: Optional[str] = None
    created_at: datetime
    last_login: Optional[datetime] = None


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    company_name: str = Field(min_length=2, max_length=120)
    legal_id: str = Field(min_length=2, max_length=40)
    org_type: Literal["individual", "company"]
    phone: str = Field(min_length=4, max_length=40)
    country: str = Field(min_length=2, max_length=40)
    slug: Optional[str] = Field(default=None, max_length=60)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class AuthMeResponse(BaseModel):
    user: UserOut
    organizer: Optional["OrganizerOut"] = None
    access_token: Optional[str] = None
    refresh_token: Optional[str] = None


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    user: UserOut
    organizer: Optional["OrganizerOut"] = None


class SlugCheckResponse(BaseModel):
    slug: str
    available: bool
    suggestion: Optional[str] = None


# ──────────────────────────────────────────────────────────────────────────────
# Plans
# ──────────────────────────────────────────────────────────────────────────────
PlanCode = Literal["evento_unico", "basico", "profesional", "enterprise"]
BillingPeriod = Literal["one_time", "monthly"]


class PlanOut(TimestampedModel):
    id: str
    code: str
    name: str
    description: str
    price_cents: int
    currency: str
    billing_period: BillingPeriod
    features: List[str]
    max_events: int  # -1 unlimited
    max_tickets_per_event: int  # -1 unlimited
    includes_numbered: bool
    includes_ai_design: bool
    includes_custom_domain: bool
    active: bool
    stripe_price_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class PlanCreate(BaseModel):
    code: str = Field(min_length=2, max_length=40)
    name: str = Field(min_length=2, max_length=80)
    description: str = Field(min_length=2, max_length=500)
    price_cents: int = Field(ge=0, le=100_000_00)
    currency: str = "usd"
    billing_period: BillingPeriod
    features: List[str] = Field(default_factory=list)
    max_events: int = -1
    max_tickets_per_event: int = -1
    includes_numbered: bool = False
    includes_ai_design: bool = False
    includes_custom_domain: bool = False
    active: bool = True
    stripe_price_id: Optional[str] = None


class PlanUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=80)
    description: Optional[str] = Field(default=None, min_length=2, max_length=500)
    price_cents: Optional[int] = Field(default=None, ge=0, le=100_000_00)
    currency: Optional[str] = None
    billing_period: Optional[BillingPeriod] = None
    features: Optional[List[str]] = None
    max_events: Optional[int] = None
    max_tickets_per_event: Optional[int] = None
    includes_numbered: Optional[bool] = None
    includes_ai_design: Optional[bool] = None
    includes_custom_domain: Optional[bool] = None
    active: Optional[bool] = None
    stripe_price_id: Optional[str] = None


# ──────────────────────────────────────────────────────────────────────────────
# Organizers
# ──────────────────────────────────────────────────────────────────────────────
class AdminCommentOut(TimestampedModel):
    id: str
    admin_id: str
    admin_email: Optional[str] = None
    comment: str
    created_at: datetime


class OrganizerOut(TimestampedModel):
    id: str
    user_id: str
    company_name: str
    legal_id: str
    org_type: Literal["individual", "company"]
    email: EmailStr
    phone: str
    country: str
    slug: str
    status: OrgStatus
    rejection_reason: Optional[str] = None
    admin_comments: List[AdminCommentOut] = Field(default_factory=list)
    plan_id: Optional[str] = None
    plan_code: Optional[str] = None
    subscription_status: SubStatus
    stripe_customer_id: Optional[str] = None
    stripe_subscription_id: Optional[str] = None
    current_period_end: Optional[datetime] = None
    created_at: datetime
    approved_at: Optional[datetime] = None
    approved_by: Optional[str] = None


class OrganizerProfileUpdate(BaseModel):
    company_name: Optional[str] = Field(default=None, min_length=2, max_length=120)
    phone: Optional[str] = Field(default=None, min_length=4, max_length=40)
    country: Optional[str] = Field(default=None, min_length=2, max_length=40)
    legal_id: Optional[str] = Field(default=None, min_length=2, max_length=40)


class OrganizerDocumentOut(TimestampedModel):
    id: str
    organizer_id: str
    doc_type: Literal["ruc", "id_card", "operating_permit", "other"]
    original_filename: str
    mime_type: str
    size_bytes: int
    uploaded_at: datetime


# ──────────────────────────────────────────────────────────────────────────────
# Admin actions
# ──────────────────────────────────────────────────────────────────────────────
class ApproveBody(BaseModel):
    comment: Optional[str] = Field(default=None, max_length=1000)


class RejectBody(BaseModel):
    comment: str = Field(min_length=2, max_length=1000)


class SuspendBody(BaseModel):
    comment: str = Field(min_length=2, max_length=1000)


class CommentBody(BaseModel):
    comment: str = Field(min_length=2, max_length=1000)


class AdminStats(BaseModel):
    organizers_total: int
    organizers_pending: int
    organizers_approved: int
    organizers_rejected: int
    organizers_suspended: int
    active_subscriptions: int
    monthly_revenue_estimate_cents: int


class OrganizersList(BaseModel):
    items: List[OrganizerOut]
    total: int
    page: int
    limit: int


# ──────────────────────────────────────────────────────────────────────────────
# Billing / Stripe
# ──────────────────────────────────────────────────────────────────────────────
class CheckoutRequest(BaseModel):
    plan_code: str = Field(min_length=2, max_length=40)
    origin_url: str


class CheckoutResponse(BaseModel):
    checkout_url: str
    session_id: str
    mode: Literal["subscription", "payment"]


class PortalResponse(BaseModel):
    portal_url: str


class SimulateWebhookBody(BaseModel):
    event_type: Literal[
        "checkout.session.completed",
        "customer.subscription.updated",
        "customer.subscription.deleted",
        "invoice.paid",
        "invoice.payment_failed",
        "payment_intent.succeeded",
    ]
    session_id: Optional[str] = None
    subscription_status: Optional[SubStatus] = None
    organizer_id: Optional[str] = None
    order_number: Optional[str] = None  # for ticket purchase simulation
    purpose: Optional[Literal["subscription", "ticket_purchase"]] = None


# Resolve forward refs
AuthMeResponse.model_rebuild()
TokenResponse.model_rebuild()
