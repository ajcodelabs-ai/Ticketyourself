"""Stripe helpers — raw stripe SDK pointed at Emergent's proxy."""
import logging
import os
from typing import Optional, Tuple

import stripe

logger = logging.getLogger("tys.stripe")

stripe.api_key = os.environ.get("STRIPE_API_KEY", "")
# Emergent's wrapper proxies the Stripe API. The lib is `stripe`, so we just
# change api_base. The SDK appends `/v1/...` to whatever we set here.
stripe.api_base = os.environ.get("STRIPE_API_BASE", "https://api.stripe.com")


async def get_or_create_customer(
    organizer: dict,
    user_email: str,
) -> Tuple[str, bool]:
    """
    Returns (customer_id, created_now). Tries to reuse existing
    organizer.stripe_customer_id; if Stripe says it doesn't exist
    (organizer was created in a different test mode account, etc.),
    transparently create a fresh one.
    """
    existing = organizer.get("stripe_customer_id")
    if existing and not existing.startswith("demo_"):
        try:
            stripe.Customer.retrieve(existing)
            return existing, False
        except stripe.error.InvalidRequestError as e:
            # Customer not found in current Stripe account → fall through.
            if "No such customer" not in str(e):
                raise
    customer = stripe.Customer.create(
        email=user_email,
        name=organizer.get("company_name"),
        metadata={
            "organizer_id": organizer["id"],
            "slug": organizer.get("slug", ""),
        },
    )
    return customer.id, True


def create_subscription_checkout(
    *,
    customer_id: str,
    plan: dict,
    success_url: str,
    cancel_url: str,
    organizer_id: str,
) -> dict:
    """Mode=subscription with ad-hoc price_data (no need to pre-create Products)."""
    if plan["billing_period"] != "monthly":
        raise ValueError("create_subscription_checkout expects monthly plan")

    session = stripe.checkout.Session.create(
        customer=customer_id,
        mode="subscription",
        payment_method_types=["card"],
        line_items=[
            {
                "price_data": {
                    "currency": plan.get("currency", "usd"),
                    "product_data": {
                        "name": plan["name"],
                        "description": plan.get("description", ""),
                    },
                    "unit_amount": plan["price_cents"],
                    "recurring": {"interval": "month"},
                },
                "quantity": 1,
            }
        ],
        success_url=success_url,
        cancel_url=cancel_url,
        metadata={
            "organizer_id": organizer_id,
            "plan_code": plan["code"],
            "plan_id": plan["id"],
        },
    )
    return {"id": session.id, "url": session.url}


def create_one_time_checkout(
    *,
    customer_id: str,
    plan: dict,
    success_url: str,
    cancel_url: str,
    organizer_id: str,
) -> dict:
    """Mode=payment for evento_unico style one-shot plans."""
    if plan["billing_period"] != "one_time":
        raise ValueError("create_one_time_checkout expects one_time plan")

    session = stripe.checkout.Session.create(
        customer=customer_id,
        mode="payment",
        payment_method_types=["card"],
        line_items=[
            {
                "price_data": {
                    "currency": plan.get("currency", "usd"),
                    "product_data": {
                        "name": plan["name"],
                        "description": plan.get("description", ""),
                    },
                    "unit_amount": plan["price_cents"],
                },
                "quantity": 1,
            }
        ],
        success_url=success_url,
        cancel_url=cancel_url,
        metadata={
            "organizer_id": organizer_id,
            "plan_code": plan["code"],
            "plan_id": plan["id"],
        },
    )
    return {"id": session.id, "url": session.url}


def create_billing_portal(customer_id: str, return_url: str) -> str:
    """Stripe Customer Portal — manage subscription, change card, etc."""
    portal = stripe.billing_portal.Session.create(
        customer=customer_id,
        return_url=return_url,
    )
    return portal.url


def retrieve_session(session_id: str):
    return stripe.checkout.Session.retrieve(session_id)


def retrieve_subscription(subscription_id: str):
    return stripe.Subscription.retrieve(subscription_id)


def construct_event(payload: bytes, sig_header: str, webhook_secret: Optional[str]):
    """Verify Stripe webhook signature. Returns the Event object or raises."""
    if not webhook_secret:
        raise ValueError("STRIPE_WEBHOOK_SECRET not configured")
    return stripe.Webhook.construct_event(payload, sig_header, webhook_secret)
