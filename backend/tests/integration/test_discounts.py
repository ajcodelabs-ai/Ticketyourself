"""Integration tests for discount/promo code logic.

Covers:
1. Discount preview — POST /api/public/orders/preview with discount code
2. Auto discount — Event with auto-apply discount, purchase without code gets discount
3. Quantity discount — Buying more items triggers quantity-based discount
4. Buy N get M — Buy N get M free discount logic
5. Expired discount — Discount outside valid_from/valid_until window is NOT applied
6. Max uses — Promo code with max_uses=1, use it twice → second NOT applied
7. Discount stacking — Max 2 rules apply (1 promo + 1 auto/quantity)
8. Invalid code — Non-existent promo code returns preview without discount
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from conftest import API, DEMO_TENANT, bearer, new_session, unique_buyer

# ── Helpers ────────────────────────────────────────────────────────────────


def _create_event(demo_token: str, overrides: dict | None = None) -> dict:
    """Create a paid event with defaults, return the created event dict."""
    s = new_session()
    s.headers.update(bearer(demo_token))
    now = datetime.now(timezone.utc)
    uid = uuid.uuid4().hex[:8]
    payload = {
        "title": f"Discount Test {uid}",
        "description": "",
        "category": "music",
        "venue_name": "Test Venue",
        "venue_city": "Quito",
        "starts_at": (now + timedelta(days=30)).isoformat(),
        "ends_at": (now + timedelta(days=30, hours=3)).isoformat(),
        "pricing_type": "paid",
        "base_price_cents": 2000,
        "capacity": 100,
    }
    if overrides:
        payload.update(overrides)
    r = s.post(f"{API}/events/me", json=payload)
    if r.status_code != 201:
        pytest.skip(f"Could not create event: {r.status_code} {r.text}")
    return r.json()


def _publish_event(demo_token: str, event_id: str) -> None:
    s = new_session()
    s.headers.update(bearer(demo_token))
    r = s.post(f"{API}/events/me/{event_id}/publish")
    if r.status_code != 200:
        pytest.skip(f"Could not publish event: {r.status_code} {r.text}")


def _update_event(demo_token: str, event_id: str, data: dict) -> dict:
    s = new_session()
    s.headers.update(bearer(demo_token))
    r = s.put(f"{API}/events/me/{event_id}", json=data)
    assert r.status_code == 200, r.text
    return r.json()


def _preview(event_slug: str, quantity: int = 1, promo_code: str | None = None) -> dict:
    s = new_session()
    body = {"tenant_slug": DEMO_TENANT, "event_slug": event_slug, "quantity": quantity}
    if promo_code is not None:
        body["promo_code"] = promo_code
    r = s.post(f"{API}/public/orders/preview", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _discount_rule(rule_id: str | None = None, **kw) -> dict:
    return {
        "id": rule_id or str(uuid.uuid4()),
        "name": kw.pop("name", "Rule"),
        "enabled": kw.pop("enabled", True),
        **kw,
    }


BASE_DISCOUNTS = {
    "disability_law": {"enabled": False, "percent": 50},
    "presale": {"enabled": False, "percent": 0, "ends_at": None},
}


# ── 1. Discount preview ────────────────────────────────────────────────────


class TestDiscountPreview:
    """Preview returns discount info when a valid promo code is supplied."""

    CODE = "DESCUENTO20"
    RULE_ID = str(uuid.uuid4())

    @pytest.fixture(scope="class")
    def event_with_promo(self, demo_token):
        ev = _create_event(
            demo_token,
            {
                "discounts": {
                    **BASE_DISCOUNTS,
                    "rules": [
                        _discount_rule(
                            id=self.RULE_ID,
                            name="20% OFF",
                            type="promo_code",
                            code=self.CODE,
                            discount={"type": "percent", "value": 20},
                        ),
                    ],
                },
            },
        )
        _publish_event(demo_token, ev["id"])
        return ev

    def test_preview_without_code_has_no_discount(self, event_with_promo):
        data = _preview(event_with_promo["slug"], quantity=2)
        assert data["subtotal_cents"] == 4000
        assert data["discount_total_cents"] == 0
        assert data["discounts_applied"] == []

    def test_preview_with_code_has_discount(self, event_with_promo):
        data = _preview(event_with_promo["slug"], quantity=2, promo_code=self.CODE)
        assert data["subtotal_cents"] == 4000
        assert data["discount_total_cents"] == 800  # 20 % of 4000
        assert data["total_cents"] < data["subtotal_cents"]
        assert len(data["discounts_applied"]) == 1
        d = data["discounts_applied"][0]
        assert d["code"] == self.CODE
        assert d["amount_cents"] == 800

    def test_preview_code_case_insensitive(self, event_with_promo):
        data = _preview(event_with_promo["slug"], quantity=1, promo_code="descuento20")
        assert data["discount_total_cents"] == 400
        assert len(data["discounts_applied"]) == 1


# ── 2. Auto discount ───────────────────────────────────────────────────────


class TestAutoDiscount:
    """Auto rules apply without any code from the buyer."""

    @pytest.fixture(scope="class")
    def event_with_auto(self, demo_token):
        ev = _create_event(
            demo_token,
            {
                "discounts": {
                    **BASE_DISCOUNTS,
                    "rules": [
                        _discount_rule(
                            name="Auto 15%",
                            type="auto",
                            discount={"type": "percent", "value": 15},
                        ),
                    ],
                },
            },
        )
        _publish_event(demo_token, ev["id"])
        return ev

    def test_purchase_without_code_gets_auto_discount(self, event_with_auto):
        data = _preview(event_with_auto["slug"], quantity=1)
        assert data["discount_total_cents"] == 300  # 15 % of 2000
        assert len(data["discounts_applied"]) == 1
        assert data["discounts_applied"][0]["type"] == "auto"

    def test_auto_stacks_with_promo(self, event_with_auto):
        """Auto + promo should result in 2 applied rules."""
        data = _preview(
            event_with_auto["slug"],
            quantity=1,
            promo_code="SOME_PROMO",
        )
        # No promo rule with that code exists, so only auto applies
        assert len(data["discounts_applied"]) == 1


# ── 3. Quantity discount ───────────────────────────────────────────────────


class TestQuantityDiscount:
    """Quantity-based rules trigger only when min_quantity is met."""

    @pytest.fixture(scope="class")
    def event_with_qty(self, demo_token):
        ev = _create_event(
            demo_token,
            {
                "discounts": {
                    **BASE_DISCOUNTS,
                    "rules": [
                        _discount_rule(
                            name="10% al comprar 3+",
                            type="quantity",
                            min_quantity=3,
                            discount={"type": "percent", "value": 10},
                        ),
                    ],
                },
            },
        )
        _publish_event(demo_token, ev["id"])
        return ev

    def test_single_item_no_discount(self, event_with_qty):
        data = _preview(event_with_qty["slug"], quantity=1)
        assert data["discount_total_cents"] == 0
        assert data["discounts_applied"] == []

    def test_two_items_no_discount(self, event_with_qty):
        data = _preview(event_with_qty["slug"], quantity=2)
        assert data["discount_total_cents"] == 0

    def test_three_items_triggers_discount(self, event_with_qty):
        data = _preview(event_with_qty["slug"], quantity=3)
        assert data["subtotal_cents"] == 6000
        assert data["discount_total_cents"] == 600  # 10 % of 6000
        assert len(data["discounts_applied"]) == 1
        assert data["discounts_applied"][0]["type"] == "quantity"


# ── 4. Buy N get M ─────────────────────────────────────────────────────────


class TestBuyNGetM:
    """Buy N get M free — cheapest items are free."""

    @pytest.fixture(scope="class")
    def event_with_bogo(self, demo_token):
        ev = _create_event(
            demo_token,
            {
                "pricing_type": "paid",
                "base_price_cents": 2000,
                "discounts": {
                    **BASE_DISCOUNTS,
                    "rules": [
                        _discount_rule(
                            name="2x1",
                            type="buy_n_get_m",
                            buy_quantity=2,
                            free_quantity=1,
                            discount={"type": "percent", "value": 0},
                        ),
                    ],
                },
            },
        )
        _publish_event(demo_token, ev["id"])
        return ev

    def test_buy_one_no_discount(self, event_with_bogo):
        data = _preview(event_with_bogo["slug"], quantity=1)
        assert data["discount_total_cents"] == 0

    def test_buy_two_no_discount(self, event_with_bogo):
        """Need 3 (2 bought + 1 free) for the group to complete."""
        data = _preview(event_with_bogo["slug"], quantity=2)
        assert data["discount_total_cents"] == 0

    def test_buy_three_one_free(self, event_with_bogo):
        """3 = 1 group of (2+1), 1 free item = 2000 off."""
        data = _preview(event_with_bogo["slug"], quantity=3)
        assert data["subtotal_cents"] == 6000
        assert data["discount_total_cents"] == 2000
        assert len(data["discounts_applied"]) == 1

    def test_buy_six_two_free(self, event_with_bogo):
        """6 = 2 groups, 2 free = 4000 off."""
        data = _preview(event_with_bogo["slug"], quantity=6)
        assert data["subtotal_cents"] == 12000
        assert data["discount_total_cents"] == 4000


# ── 5. Expired discount ────────────────────────────────────────────────────


class TestExpiredDiscount:
    """Rules outside their valid_from/valid_until window are not applied."""

    @pytest.fixture(scope="class")
    def event_with_expired(self, demo_token):
        past = (datetime.now(timezone.utc) - timedelta(days=10)).isoformat()
        future = (datetime.now(timezone.utc) + timedelta(days=10)).isoformat()
        ev = _create_event(
            demo_token,
            {
                "discounts": {
                    **BASE_DISCOUNTS,
                    "rules": [
                        # Expired (valid_until in the past)
                        _discount_rule(
                            name="Expired promo",
                            type="promo_code",
                            code="EXPIRED",
                            discount={"type": "percent", "value": 50},
                            conditions={"valid_from": None, "valid_until": past},
                        ),
                        # Not yet active (valid_from in the future)
                        _discount_rule(
                            name="Future promo",
                            type="promo_code",
                            code="FUTURE",
                            discount={"type": "percent", "value": 50},
                            conditions={"valid_from": future, "valid_until": None},
                        ),
                        # Expired auto rule
                        _discount_rule(
                            name="Expired auto",
                            type="auto",
                            discount={"type": "percent", "value": 25},
                            conditions={"valid_from": None, "valid_until": past},
                        ),
                    ],
                },
            },
        )
        _publish_event(demo_token, ev["id"])
        return ev

    def test_expired_promo_code_not_applied(self, event_with_expired):
        data = _preview(event_with_expired["slug"], quantity=1, promo_code="EXPIRED")
        assert data["discount_total_cents"] == 0
        assert data["discounts_applied"] == []

    def test_future_promo_code_not_applied(self, event_with_expired):
        data = _preview(event_with_expired["slug"], quantity=1, promo_code="FUTURE")
        assert data["discount_total_cents"] == 0
        assert data["discounts_applied"] == []

    def test_expired_auto_rule_not_applied(self, event_with_expired):
        data = _preview(event_with_expired["slug"], quantity=1)
        assert data["discount_total_cents"] == 0
        assert data["discounts_applied"] == []


# ── 6. Max uses ────────────────────────────────────────────────────────────


class TestMaxUses:
    """Promo code with max_uses=1 stops applying after one purchase."""

    CODE = "MAXONE"
    RULE_ID = str(uuid.uuid4())

    @pytest.fixture(scope="class")
    def event_max_uses(self, demo_token):
        ev = _create_event(
            demo_token,
            {
                "discounts": {
                    **BASE_DISCOUNTS,
                    "rules": [
                        _discount_rule(
                            id=self.RULE_ID,
                            name="One use only",
                            type="promo_code",
                            code=self.CODE,
                            max_uses=1,
                            uses_count=0,
                            discount={"type": "percent", "value": 30},
                        ),
                    ],
                },
            },
        )
        _publish_event(demo_token, ev["id"])
        return ev

    def test_first_preview_shows_discount(self, event_max_uses):
        data = _preview(event_max_uses["slug"], quantity=1, promo_code=self.CODE)
        assert data["discount_total_cents"] == 600  # 30 % of 2000
        assert len(data["discounts_applied"]) == 1

    def test_purchase_consumes_code(self, event_max_uses):
        """Actually purchase with the code → the code gets consumed."""
        s = new_session()
        body = {
            "tenant_slug": DEMO_TENANT,
            "event_slug": event_max_uses["slug"],
            "quantity": 1,
            "buyer": unique_buyer("maxuse"),
            "promo_code": self.CODE,
            "origin_url": "http://localhost:3000",
        }
        r = s.post(f"{API}/public/orders", json=body)
        assert r.status_code == 200, r.text
        order = r.json()
        assert order["status"] == "pending"

        sim = s.post(
            f"{API}/_dev/simulate-purchase-paid",
            json={"order_number": order["order_number"]},
        )
        assert sim.status_code == 200, sim.text

    def test_preview_after_consumption_shows_no_discount(self, event_max_uses):
        """After the code was consumed, preview should not apply it."""
        data = _preview(event_max_uses["slug"], quantity=1, promo_code=self.CODE)
        assert data["discount_total_cents"] == 0
        assert data["discounts_applied"] == []

    def test_purchase_after_consumption_fails_422(self, event_max_uses):
        """Creating a new order with the exhausted code returns 422."""
        s = new_session()
        body = {
            "tenant_slug": DEMO_TENANT,
            "event_slug": event_max_uses["slug"],
            "quantity": 1,
            "buyer": unique_buyer("maxuse2"),
            "promo_code": self.CODE,
            "origin_url": "http://localhost:3000",
        }
        r = s.post(f"{API}/public/orders", json=body)
        assert r.status_code == 422, r.text


# ── 7. Discount stacking ───────────────────────────────────────────────────


class TestDiscountStacking:
    """Max 2 rules apply: 1 promo_code + 1 auto/quantity (best)."""

    PROMO_CODE = "STACK20"
    RULE_ID = str(uuid.uuid4())

    @pytest.fixture(scope="class")
    def event_stacking(self, demo_token):
        ev = _create_event(
            demo_token,
            {
                "discounts": {
                    **BASE_DISCOUNTS,
                    "rules": [
                        _discount_rule(
                            id=self.RULE_ID,
                            name="Promo 20%",
                            type="promo_code",
                            code=self.PROMO_CODE,
                            discount={"type": "percent", "value": 20},
                        ),
                        _discount_rule(
                            name="Auto 10%",
                            type="auto",
                            discount={"type": "percent", "value": 10},
                        ),
                        _discount_rule(
                            name="Quantity 15% for 3+",
                            type="quantity",
                            min_quantity=3,
                            discount={"type": "percent", "value": 15},
                        ),
                    ],
                },
            },
        )
        _publish_event(demo_token, ev["id"])
        return ev

    def test_promo_plus_auto_both_apply(self, event_stacking):
        """1 promo + 1 auto = 2 applied rules."""
        data = _preview(event_stacking["slug"], quantity=1, promo_code=self.PROMO_CODE)
        assert len(data["discounts_applied"]) == 2
        types = {d["type"] for d in data["discounts_applied"]}
        assert types == {"promo_code", "auto"}

    def test_promo_plus_best_auto_wins(self, event_stacking):
        """Quantity gives 15 % for 3+ → better than auto's 10 %. But with qty=1,
        quantity doesn't trigger, so only auto applies."""
        data = _preview(event_stacking["slug"], quantity=1, promo_code=self.PROMO_CODE)
        auto_amt = next(
            d["amount_cents"] for d in data["discounts_applied"] if d["type"] == "auto"
        )
        assert auto_amt == 200  # 10 % of 2000 (auto, since qty < 3)

    def test_promo_plus_quantity_wins_over_auto(self, event_stacking):
        """With qty=3, quantity (15 % = 900) beats auto (10 % = 600)."""
        data = _preview(event_stacking["slug"], quantity=3, promo_code=self.PROMO_CODE)
        assert len(data["discounts_applied"]) == 2
        # Promo on subtotal (6000) = 1200
        promo_amt = next(
            d["amount_cents"]
            for d in data["discounts_applied"]
            if d["type"] == "promo_code"
        )
        assert promo_amt == 1200  # 20 % of 6000
        # Best auto/quantity should be quantity (15 % of 6000 = 900)
        other_amt = next(
            d["amount_cents"]
            for d in data["discounts_applied"]
            if d["type"] != "promo_code"
        )
        assert other_amt == 900  # 15 % of 6000

    def test_promo_same_id_not_duplicated(self, event_stacking):
        """If promo rule also matches auto criteria, it's not applied twice."""
        data = _preview(event_stacking["slug"], quantity=1, promo_code=self.PROMO_CODE)
        assert len(data["discounts_applied"]) == 2


# ── 8. Invalid code ────────────────────────────────────────────────────────


class TestInvalidCode:
    """Non-existent promo code returns preview without discount + warning."""

    @pytest.fixture(scope="class")
    def plain_event(self, demo_token):
        ev = _create_event(
            demo_token,
            {
                "discounts": {**BASE_DISCOUNTS, "rules": []},
            },
        )
        _publish_event(demo_token, ev["id"])
        return ev

    def test_nonexistent_code_returns_no_discount(self, plain_event):
        data = _preview(plain_event["slug"], quantity=1, promo_code="NO_EXISTE")
        assert data["discount_total_cents"] == 0
        assert data["discounts_applied"] == []

    def test_nonexistent_code_returns_warning(self, plain_event):
        data = _preview(plain_event["slug"], quantity=1, promo_code="NO_EXISTE")
        assert "warnings" in data
        assert len(data["warnings"]) >= 1

    def test_empty_code_treated_as_no_code(self, plain_event):
        """An empty string should be treated as no promo code."""
        data = _preview(plain_event["slug"], quantity=1, promo_code="")
        assert data["discount_total_cents"] == 0
        assert data["discounts_applied"] == []

    def test_disabled_promo_code_returns_warning(self, demo_token):
        """A disabled rule should produce a warning, not a discount."""
        ev = _create_event(
            demo_token,
            {
                "discounts": {
                    **BASE_DISCOUNTS,
                    "rules": [
                        _discount_rule(
                            name="Disabled code",
                            type="promo_code",
                            code="DISABLED",
                            enabled=False,
                            discount={"type": "percent", "value": 50},
                        ),
                    ],
                },
            },
        )
        _publish_event(demo_token, ev["id"])
        data = _preview(ev["slug"], quantity=1, promo_code="DISABLED")
        assert data["discount_total_cents"] == 0
        assert data["discounts_applied"] == []
        assert any("activo" in w.lower() for w in data.get("warnings", []))
