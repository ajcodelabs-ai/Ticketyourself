"""
Unit tests for Pydantic models (models.py).

Tests field validation, constraints, serialization, and edge cases.
"""

from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from models import (
    AdminCommentOut,
    AdminStats,
    ApproveBody,
    AuthMeResponse,
    CheckoutRequest,
    CheckoutResponse,
    CommentBody,
    DocumentTypeCreate,
    DocumentTypeOut,
    LoginRequest,
    OrganizerDocumentOut,
    OrganizerOut,
    OrganizerProfileUpdate,
    OrganizersList,
    PlanCreate,
    PlanOut,
    PlanUpdate,
    PortalResponse,
    RegisterRequest,
    RejectBody,
    RequiredDocumentsOut,
    RequiredDocumentsUpdate,
    ResolveResponse,
    SimulateWebhookBody,
    SlugCheckResponse,
    SuspendBody,
    TenantOut,
    TokenResponse,
    UserOut,
)


def _dt() -> datetime:
    return datetime.now(timezone.utc)


# ── Tenant ────────────────────────────────────────────────────────────────────


class TestTenantOut:
    def test_valid(self):
        t = TenantOut(slug="demo", name="Demo", status="active")
        assert t.slug == "demo"
        assert t.name == "Demo"
        assert t.status == "active"

    def test_invalid_status(self):
        with pytest.raises(ValidationError):
            TenantOut(slug="x", name="X", status="bogus")

    def test_invalid_slug_type(self):
        with pytest.raises(ValidationError):
            TenantOut(slug=123, name="X", status="active")


class TestResolveResponse:
    def test_with_tenant(self):
        t = TenantOut(slug="x", name="X", status="active")
        r = ResolveResponse(tenant=t)
        assert r.tenant is not None

    def test_without_tenant(self):
        r = ResolveResponse(tenant=None)
        assert r.tenant is None


# ── Auth ──────────────────────────────────────────────────────────────────────


class TestUserOut:
    def test_valid(self):
        u = UserOut(id="abc", email="a@b.com", role="organizer", created_at=_dt())
        assert u.email == "a@b.com"
        assert u.organizer_id is None

    def test_invalid_email(self):
        with pytest.raises(ValidationError):
            UserOut(id="x", email="not-an-email", role="organizer", created_at=_dt())

    def test_invalid_role(self):
        with pytest.raises(ValidationError):
            UserOut(id="x", email="a@b.com", role="bogus", created_at=_dt())

    def test_with_organizer_id(self):
        u = UserOut(
            id="x",
            email="a@b.com",
            role="organizer",
            organizer_id="org-123",
            created_at=_dt(),
        )
        assert u.organizer_id == "org-123"


class TestRegisterRequest:
    def test_valid(self):
        r = RegisterRequest(
            email="a@b.com",
            password="12345678",
            company_name="ACME",
            legal_id="J123",
            org_type="company",
            phone="+593991234567",
            country="EC",
        )
        assert r.email == "a@b.com"

    def test_password_too_short(self):
        with pytest.raises(ValidationError):
            RegisterRequest(
                email="a@b.com",
                password="123",
                company_name="ACME",
                legal_id="J123",
                org_type="company",
                phone="+593991234567",
                country="EC",
            )

    def test_password_too_long(self):
        with pytest.raises(ValidationError):
            RegisterRequest(
                email="a@b.com",
                password="x" * 200,
                company_name="ACME",
                legal_id="J123",
                org_type="company",
                phone="+593991234567",
                country="EC",
            )

    def test_invalid_email(self):
        with pytest.raises(ValidationError):
            RegisterRequest(
                email="bademail",
                password="12345678",
                company_name="ACME",
                legal_id="J123",
                org_type="company",
                phone="+593991234567",
                country="EC",
            )

    def test_invalid_org_type(self):
        with pytest.raises(ValidationError):
            RegisterRequest(
                email="a@b.com",
                password="12345678",
                company_name="ACME",
                legal_id="J123",
                org_type="ngo",
                phone="+593991234567",
                country="EC",
            )

    def test_company_name_too_short(self):
        with pytest.raises(ValidationError):
            RegisterRequest(
                email="a@b.com",
                password="12345678",
                company_name="A",
                legal_id="J123",
                org_type="company",
                phone="+593991234567",
                country="EC",
            )

    def test_phone_too_short(self):
        with pytest.raises(ValidationError):
            RegisterRequest(
                email="a@b.com",
                password="12345678",
                company_name="ACME",
                legal_id="J123",
                org_type="company",
                phone="+5",
                country="EC",
            )

    def test_optional_slug(self):
        r = RegisterRequest(
            email="a@b.com",
            password="12345678",
            company_name="ACME",
            legal_id="J123",
            org_type="company",
            phone="+593991234567",
            country="EC",
        )
        assert r.slug is None


class TestLoginRequest:
    def test_valid(self):
        lr = LoginRequest(email="a@b.com", password="secret")
        assert lr.email == "a@b.com"

    def test_invalid_email(self):
        with pytest.raises(ValidationError):
            LoginRequest(email="bad", password="secret")


class TestSlugCheckResponse:
    def test_available(self):
        r = SlugCheckResponse(slug="demo", available=True)
        assert r.available is True
        assert r.suggestion is None
        assert r.reason is None

    def test_taken(self):
        r = SlugCheckResponse(
            slug="demo", available=False, suggestion="demo-1", reason="taken"
        )
        assert r.available is False
        assert r.suggestion == "demo-1"
        assert r.reason == "taken"

    def test_invalid_reason(self):
        with pytest.raises(ValidationError):
            SlugCheckResponse(slug="x", available=False, reason="bogus")


# ── Plans ─────────────────────────────────────────────────────────────────────


class TestPlanOut:
    def test_valid(self):
        p = PlanOut(
            id="p1",
            code="basico",
            name="Básico",
            description="Desc",
            price_cents=2000,
            currency="usd",
            billing_period="monthly",
            features=["f1"],
            max_events=5,
            max_tickets_per_event=500,
            includes_numbered=False,
            includes_ai_design=False,
            includes_custom_domain=False,
            active=True,
            created_at=_dt(),
            updated_at=_dt(),
        )
        assert p.code == "basico"
        assert p.price_cents == 2000


class TestPlanCreate:
    def test_valid(self):
        p = PlanCreate(
            code="basic",
            name="Basic",
            description="A basic plan",
            price_cents=1000,
            billing_period="monthly",
        )
        assert p.currency == "usd"
        assert p.active is True
        assert p.features == []

    def test_price_cents_negative(self):
        with pytest.raises(ValidationError):
            PlanCreate(
                code="x",
                name="X",
                description="D",
                price_cents=-1,
                billing_period="monthly",
            )

    def test_price_cents_too_high(self):
        with pytest.raises(ValidationError):
            PlanCreate(
                code="x",
                name="X",
                description="D",
                price_cents=100_000_01,
                billing_period="monthly",
            )

    def test_invalid_billing_period(self):
        with pytest.raises(ValidationError):
            PlanCreate(
                code="x",
                name="X",
                description="D",
                price_cents=0,
                billing_period="yearly",
            )

    def test_code_too_short(self):
        with pytest.raises(ValidationError):
            PlanCreate(
                code="x",
                name="X",
                description="D",
                price_cents=0,
                billing_period="monthly",
            )


class TestPlanUpdate:
    def test_empty_update(self):
        p = PlanUpdate()
        assert p.name is None

    def test_partial_update(self):
        p = PlanUpdate(name="New Name")
        assert p.name == "New Name"
        assert p.price_cents is None


# ── Organizers ────────────────────────────────────────────────────────────────


class TestOrganizerOut:
    def test_valid(self):
        o = OrganizerOut(
            id="o1",
            user_id="u1",
            company_name="Test",
            legal_id="J123",
            org_type="company",
            email="o@t.com",
            phone="+123",
            country="EC",
            slug="test-org",
            status="approved",
            subscription_status="active",
            created_at=_dt(),
        )
        assert o.company_name == "Test"
        assert o.admin_comments == []

    def test_invalid_org_type(self):
        with pytest.raises(ValidationError):
            OrganizerOut(
                id="o1",
                user_id="u1",
                company_name="T",
                legal_id="J1",
                org_type="invalid",
                email="o@t.com",
                phone="+1",
                country="EC",
                slug="t",
                status="approved",
                subscription_status="active",
                created_at=_dt(),
            )

    def test_invalid_status(self):
        with pytest.raises(ValidationError):
            OrganizerOut(
                id="o1",
                user_id="u1",
                company_name="T",
                legal_id="J1",
                org_type="company",
                email="o@t.com",
                phone="+1",
                country="EC",
                slug="t",
                status="unknown",
                subscription_status="active",
                created_at=_dt(),
            )

    def test_invalid_subscription_status(self):
        with pytest.raises(ValidationError):
            OrganizerOut(
                id="o1",
                user_id="u1",
                company_name="T",
                legal_id="J1",
                org_type="company",
                email="o@t.com",
                phone="+1",
                country="EC",
                slug="t",
                status="approved",
                subscription_status="bogus",
                created_at=_dt(),
            )

    def test_with_admin_comments(self):
        c = AdminCommentOut(
            id="c1", admin_id="u2", comment="Looks good", created_at=_dt()
        )
        o = OrganizerOut(
            id="o1",
            user_id="u1",
            company_name="T",
            legal_id="J1",
            org_type="company",
            email="o@t.com",
            phone="+1",
            country="EC",
            slug="t",
            status="pending",
            subscription_status="none",
            admin_comments=[c],
            created_at=_dt(),
        )
        assert len(o.admin_comments) == 1
        assert o.admin_comments[0].comment == "Looks good"


class TestOrganizerProfileUpdate:
    def test_empty_update(self):
        u = OrganizerProfileUpdate()
        assert u.company_name is None

    def test_partial_update(self):
        u = OrganizerProfileUpdate(phone="+999")
        assert u.phone == "+999"
        assert u.country is None

    def test_company_name_too_short(self):
        with pytest.raises(ValidationError):
            OrganizerProfileUpdate(company_name="A")


# ── Admin actions ─────────────────────────────────────────────────────────────


class TestApproveBody:
    def test_valid_with_comment(self):
        b = ApproveBody(comment="Welcome!")
        assert b.comment == "Welcome!"

    def test_valid_without_comment(self):
        b = ApproveBody()
        assert b.comment is None

    def test_comment_too_long(self):
        with pytest.raises(ValidationError):
            ApproveBody(comment="x" * 1001)


class TestRejectBody:
    def test_valid(self):
        b = RejectBody(comment="Missing docs")
        assert b.comment == "Missing docs"

    def test_comment_too_short(self):
        with pytest.raises(ValidationError):
            RejectBody(comment="A")

    def test_comment_too_long(self):
        with pytest.raises(ValidationError):
            RejectBody(comment="x" * 1001)


# ── AdminStats / OrganizersList ───────────────────────────────────────────────


class TestAdminStats:
    def test_valid(self):
        s = AdminStats(
            organizers_total=10,
            organizers_pending=2,
            organizers_approved=5,
            organizers_rejected=2,
            organizers_suspended=1,
            active_subscriptions=3,
            monthly_revenue_estimate_cents=100_00,
        )
        assert s.organizers_total == 10


class TestOrganizersList:
    def test_valid(self):
        o = OrganizerOut(
            id="o1",
            user_id="u1",
            company_name="T",
            legal_id="J1",
            org_type="company",
            email="o@t.com",
            phone="+1",
            country="EC",
            slug="t",
            status="approved",
            subscription_status="active",
            created_at=_dt(),
        )
        lst = OrganizersList(items=[o], total=1, page=1, limit=20)
        assert len(lst.items) == 1
        assert lst.total == 1


# ── Billing / Stripe ──────────────────────────────────────────────────────────


class TestCheckoutRequest:
    def test_valid(self):
        r = CheckoutRequest(plan_code="basico", origin_url="https://example.com")
        assert r.plan_code == "basico"

    def test_plan_code_too_short(self):
        with pytest.raises(ValidationError):
            CheckoutRequest(plan_code="x", origin_url="https://example.com")


class TestCheckoutResponse:
    def test_valid(self):
        r = CheckoutResponse(
            checkout_url="https://checkout.stripe.com/...",
            session_id="cs_test_abc",
            mode="subscription",
        )
        assert r.mode == "subscription"

    def test_invalid_mode(self):
        with pytest.raises(ValidationError):
            CheckoutResponse(
                checkout_url="https://...",
                session_id="cs_1",
                mode="invalid",
            )


class TestPortalResponse:
    def test_valid(self):
        r = PortalResponse(portal_url="https://stripe.com/portal")
        assert r.portal_url.startswith("https://")


class TestSimulateWebhookBody:
    def test_valid_minimal(self):
        b = SimulateWebhookBody(event_type="checkout.session.completed")
        assert b.event_type == "checkout.session.completed"

    def test_invalid_event_type(self):
        with pytest.raises(ValidationError):
            SimulateWebhookBody(event_type="unknown.event")

    def test_invalid_purpose(self):
        with pytest.raises(ValidationError):
            SimulateWebhookBody(
                event_type="checkout.session.completed",
                purpose="invalid",
            )


# ── Serialization ─────────────────────────────────────────────────────────────


class TestSerialization:
    def test_user_out_serializes_to_dict(self):
        u = UserOut(id="abc", email="a@b.com", role="organizer", created_at=_dt())
        d = u.model_dump()
        assert d["id"] == "abc"
        assert d["email"] == "a@b.com"
        assert d["role"] == "organizer"
        assert "password_hash" not in d

    def test_tenant_out_roundtrip(self):
        t = TenantOut(slug="x", name="X", status="active")
        d = t.model_dump()
        t2 = TenantOut(**d)
        assert t2.slug == t.slug
        assert t2.name == t.name
        assert t2.status == t.status

    def test_extra_fields_ignored(self):
        class Sub(TenantOut):
            pass

        t = TenantOut.model_validate(
            {"slug": "x", "name": "X", "status": "active", "extra": "ignored"}
        )
        assert t.slug == "x"

    def test_register_request_serializes(self):
        r = RegisterRequest(
            email="a@b.com",
            password="12345678",
            company_name="ACME",
            legal_id="J123",
            org_type="company",
            phone="+593991234567",
            country="EC",
        )
        d = r.model_dump()
        assert d["email"] == "a@b.com"
        # Password should be included in serialization (it's not secret here)
        assert d["password"] == "12345678"
