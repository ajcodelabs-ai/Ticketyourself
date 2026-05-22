"""Models POC reused in routers/poc.py — declared in main `models.py`."""
# Add POC models here so they live alongside the rest.
from typing import Literal, Optional
from datetime import datetime
from pydantic import BaseModel, Field


class CreateSubscriptionRequest(BaseModel):
    tenant_slug: str
    plan_name: Literal["basic", "pro"]
    origin_url: str


class CreateTicketRequest(BaseModel):
    tenant_slug: str
    event_name: str
    amount_cents: int = Field(..., gt=0, le=10_000_00)
    origin_url: str


class CheckoutCreatedResponse(BaseModel):
    checkout_url: str
    session_id: str


class PocPaymentOut(BaseModel):
    id: str
    tenant_slug: str
    stripe_session_id: str
    type: Literal["subscription", "ticket"]
    status: Literal["pending", "paid", "failed"]
    amount_cents: int
    currency: str
    description: Optional[str] = None
    plan_name: Optional[str] = None
    event_name: Optional[str] = None
    created_at: datetime
    paid_at: Optional[datetime] = None


class StatusResponse(BaseModel):
    session_id: str
    payment_status: str
    status: str
    amount_total: int
    currency: str
    db_status: Literal["pending", "paid", "failed"]
