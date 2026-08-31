"""Buyer account: register, login, list tickets."""

from conftest import (
    API,
    DEMO_TENANT,
    FREE_EVENT_SLUG,
    new_session,
    place_order,
    register_buyer_client,
    unique_buyer,
)


class TestBuyerAuth:
    def test_register_and_me(self):
        buyer = unique_buyer("acct")
        s, buyer = register_buyer_client(buyer)
        r = s.get(f"{API}/auth/me")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["user"]["role"] == "buyer"
        assert body["user"]["email"] == buyer["email"]
        assert body["user"]["display_name"] == buyer["name"]
        assert body["organizer"] is None

    def test_duplicate_email_409(self):
        buyer = unique_buyer("dup")
        register_buyer_client(buyer)
        s = new_session()
        r = s.post(
            f"{API}/auth/register-buyer",
            json={
                "name": buyer["name"],
                "email": buyer["email"],
                "password": "Buyer123!",
            },
        )
        assert r.status_code == 409

    def test_buyer_cannot_access_organizer_dashboard(self):
        s, _ = register_buyer_client()
        r = s.get(f"{API}/events/me")
        assert r.status_code == 403


class TestBuyerOrders:
    def test_list_orders_after_purchase(self):
        buyer = unique_buyer("mine")
        s, buyer = register_buyer_client(buyer)
        payload = {
            "tenant_slug": DEMO_TENANT,
            "event_slug": FREE_EVENT_SLUG,
            "quantity": 2,
            "buyer": buyer,
        }
        cr = s.post(f"{API}/public/orders", json=payload)
        assert cr.status_code == 200, cr.text
        order_number = cr.json()["order_number"]

        listed = s.get(f"{API}/buyer/me/orders")
        assert listed.status_code == 200, listed.text
        items = listed.json()["items"]
        assert len(items) >= 1
        match = next(i for i in items if i["order"]["order_number"] == order_number)
        assert match["order"]["status"] == "paid"
        assert match["event"]["slug"] == FREE_EVENT_SLUG
        assert len(match["tickets"]) == 2
        assert match["tickets"][0]["qr_token"]

    def test_other_buyer_does_not_see_orders(self):
        payload = {
            "tenant_slug": DEMO_TENANT,
            "event_slug": FREE_EVENT_SLUG,
            "quantity": 1,
            "buyer": unique_buyer("secret"),
        }
        r = place_order(payload)
        assert r.status_code == 200, r.text

        s, _ = register_buyer_client()
        listed = s.get(f"{API}/buyer/me/orders")
        assert listed.status_code == 200
        assert listed.json()["items"] == []

    def test_unauthenticated_orders_401(self):
        r = new_session().get(f"{API}/buyer/me/orders")
        assert r.status_code == 401


class TestBuyerProfile:
    def test_patch_name(self):
        s, _ = register_buyer_client()
        r = s.patch(f"{API}/buyer/me", json={"name": "Nombre Nuevo"})
        assert r.status_code == 200, r.text
        assert r.json()["display_name"] == "Nombre Nuevo"
        me = s.get(f"{API}/auth/me").json()
        assert me["user"]["display_name"] == "Nombre Nuevo"
