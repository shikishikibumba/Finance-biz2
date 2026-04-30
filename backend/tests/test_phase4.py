"""Phase 4 Mini-Accounting backend tests.

Coverage:
- Order edit lock when invoice exists, delete lock
- Supplier invoice number on order items -> auto-purchase
- Hybrid invoice numbering (manual + auto), duplicate reject
- Invoice backdated created_at
- Invoice from-order with manual invoice_number
- Purchase manual purchase_number + supplier_invoice_number + created_at, duplicate reject
- Returns create with quantity validation + returned_stock auto-create
- Invoice GET returns returned_amount + balance = total - paid - returned
- Delete return reverses stock unless used
- Returned stock by-product grouping, manual opening, delete guards
- Order with source=returned_stock: reserves, cost_price preserved, NO auto-purchase
- Returned stock over-consume blocked
- Customer outstanding includes opening_balance and subtracts returns
- Supplier payable includes opening_balance
- Payment backdated created_at
"""

import os
import uuid
import pytest
import requests
from datetime import datetime, timezone

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fallback to frontend .env
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
    except Exception:
        pass

API = f"{BASE_URL}/api"


# ── fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{API}/auth/login", json={"email": "admin@example.com", "password": "admin123"})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    # access_token stored in HttpOnly cookie — session carries it
    return s


@pytest.fixture(scope="module")
def seed(client):
    """Create isolated TEST_ entities."""
    tag = uuid.uuid4().hex[:6]
    cust = client.post(f"{API}/customers", json={"name": f"TEST_Cust_{tag}", "opening_balance": 500}).json()
    sup = client.post(f"{API}/suppliers", json={"name": f"TEST_Sup_{tag}", "opening_balance": 300}).json()
    prod = client.post(f"{API}/products", json={
        "name": f"TEST_Prod_{tag}", "cost_price": 100, "selling_price": 150, "unit": "pcs"
    }).json()
    data = {"customer": cust, "supplier": sup, "product": prod, "tag": tag, "created": {"orders": [], "invoices": [], "purchases": [], "returns": [], "returned_stock": [], "payments": []}}
    yield data
    # teardown best-effort
    for rid in data["created"]["returns"]:
        client.delete(f"{API}/returns/{rid}")
    for rs in data["created"]["returned_stock"]:
        client.delete(f"{API}/returned-stock/{rs}")
    for pid in data["created"]["payments"]:
        client.delete(f"{API}/payments/{pid}")
    for iid in data["created"]["invoices"]:
        client.delete(f"{API}/invoices/{iid}")
    for pid in data["created"]["purchases"]:
        client.delete(f"{API}/purchases/{pid}")
    for oid in data["created"]["orders"]:
        client.delete(f"{API}/orders/{oid}")
    client.delete(f"{API}/products/{prod['id']}")
    client.delete(f"{API}/customers/{cust['id']}")
    client.delete(f"{API}/suppliers/{sup['id']}")


# ── Orders: edit/delete lock, supplier_invoice_number ───────────────────────

class TestOrderEditLock:
    def test_order_edit_allowed_when_no_invoice(self, client, seed):
        o = client.post(f"{API}/orders", json={
            "customer_id": seed["customer"]["id"],
            "customer_name": seed["customer"]["name"],
            "items": [{
                "product_id": seed["product"]["id"],
                "product_name": seed["product"]["name"],
                "quantity": 2, "unit_price": 150,
                "supplier_id": seed["supplier"]["id"],
                "supplier_name": seed["supplier"]["name"],
                "supplier_invoice_number": "SUP-INV-111"
            }]
        }).json()
        seed["created"]["orders"].append(o["id"])
        # PUT update
        r = client.put(f"{API}/orders/{o['id']}", json={"notes": "edited"})
        assert r.status_code == 200, r.text
        assert r.json()["notes"] == "edited"

        # Verify supplier_invoice_number propagated to auto-purchase
        purchases = client.get(f"{API}/purchases", params={"supplier_id": seed["supplier"]["id"]}).json()
        auto = [p for p in purchases if p.get("order_id") == o["id"]]
        assert len(auto) >= 1
        assert auto[0]["supplier_invoice_number"] == "SUP-INV-111"

    def test_order_edit_blocked_when_invoice_exists(self, client, seed):
        o = client.post(f"{API}/orders", json={
            "customer_id": seed["customer"]["id"],
            "customer_name": seed["customer"]["name"],
            "items": [{"product_id": seed["product"]["id"], "product_name": seed["product"]["name"],
                       "quantity": 1, "unit_price": 150,
                       "supplier_id": seed["supplier"]["id"], "supplier_name": seed["supplier"]["name"]}]
        }).json()
        seed["created"]["orders"].append(o["id"])
        inv = client.post(f"{API}/invoices/from-order/{o['id']}", json={}).json()
        seed["created"]["invoices"].append(inv["id"])

        r = client.put(f"{API}/orders/{o['id']}", json={"notes": "should fail"})
        assert r.status_code == 400
        assert "invoice" in r.text.lower()

        d = client.delete(f"{API}/orders/{o['id']}")
        assert d.status_code == 400
        assert "invoice" in d.text.lower()


# ── Invoices: hybrid numbering + backdate ───────────────────────────────────

class TestInvoiceHybrid:
    def test_manual_invoice_number(self, client, seed):
        num = f"INV-{seed['tag']}-999"
        payload = {
            "customer_id": seed["customer"]["id"],
            "customer_name": seed["customer"]["name"],
            "items": [{"product_id": seed["product"]["id"], "product_name": seed["product"]["name"], "quantity": 1, "unit_price": 200}],
            "invoice_number": num
        }
        r = client.post(f"{API}/invoices", json=payload)
        assert r.status_code == 200, r.text
        inv = r.json()
        seed["created"]["invoices"].append(inv["id"])
        assert inv["invoice_number"] == num
        assert inv["manual_number"] is True

        # duplicate
        r2 = client.post(f"{API}/invoices", json=payload)
        assert r2.status_code == 400
        assert "already exists" in r2.text.lower()

    def test_auto_numbering_still_works(self, client, seed):
        r = client.post(f"{API}/invoices", json={
            "customer_id": seed["customer"]["id"],
            "customer_name": seed["customer"]["name"],
            "items": [{"product_id": seed["product"]["id"], "product_name": seed["product"]["name"], "quantity": 1, "unit_price": 100}]
        })
        assert r.status_code == 200
        inv = r.json()
        seed["created"]["invoices"].append(inv["id"])
        assert inv["invoice_number"].startswith("INV-")
        assert inv.get("manual_number") is False

    def test_backdated_created_at(self, client, seed):
        back = "2023-01-15T10:00:00+00:00"
        r = client.post(f"{API}/invoices", json={
            "customer_id": seed["customer"]["id"],
            "customer_name": seed["customer"]["name"],
            "items": [{"product_id": seed["product"]["id"], "product_name": seed["product"]["name"], "quantity": 1, "unit_price": 100}],
            "created_at": back
        })
        assert r.status_code == 200
        inv = r.json()
        seed["created"]["invoices"].append(inv["id"])
        assert inv["created_at"].startswith("2023-01-15")

    def test_from_order_manual_number(self, client, seed):
        o = client.post(f"{API}/orders", json={
            "customer_id": seed["customer"]["id"], "customer_name": seed["customer"]["name"],
            "items": [{"product_id": seed["product"]["id"], "product_name": seed["product"]["name"],
                       "quantity": 1, "unit_price": 150,
                       "supplier_id": seed["supplier"]["id"], "supplier_name": seed["supplier"]["name"]}]
        }).json()
        seed["created"]["orders"].append(o["id"])
        manual = f"INV-{seed['tag']}-FO-1"
        r = client.post(f"{API}/invoices/from-order/{o['id']}", json={"invoice_number": manual})
        assert r.status_code == 200, r.text
        inv = r.json()
        seed["created"]["invoices"].append(inv["id"])
        assert inv["invoice_number"] == manual


# ── Purchases: manual + supplier_invoice_number + backdate ──────────────────

class TestPurchaseHybrid:
    def test_manual_purchase_number(self, client, seed):
        num = f"PUR-{seed['tag']}-M1"
        payload = {
            "supplier_id": seed["supplier"]["id"],
            "supplier_name": seed["supplier"]["name"],
            "supplier_invoice_number": "SUP-BILL-42",
            "items": [{"product_id": seed["product"]["id"], "product_name": seed["product"]["name"], "quantity": 5, "cost_price": 90}],
            "purchase_number": num,
            "created_at": "2022-06-01T00:00:00+00:00"
        }
        r = client.post(f"{API}/purchases", json=payload)
        assert r.status_code == 200, r.text
        p = r.json()
        seed["created"]["purchases"].append(p["id"])
        assert p["purchase_number"] == num
        assert p["supplier_invoice_number"] == "SUP-BILL-42"
        assert p["created_at"].startswith("2022-06-01")

        dup = client.post(f"{API}/purchases", json=payload)
        assert dup.status_code == 400
        assert "already exists" in dup.text.lower()


# ── Returns + Returned-stock ─────────────────────────────────────────────────

class TestReturns:
    def test_create_return_and_returned_stock(self, client, seed):
        # Create order + invoice with qty 5
        o = client.post(f"{API}/orders", json={
            "customer_id": seed["customer"]["id"], "customer_name": seed["customer"]["name"],
            "items": [{"product_id": seed["product"]["id"], "product_name": seed["product"]["name"],
                       "quantity": 5, "unit_price": 150,
                       "supplier_id": seed["supplier"]["id"], "supplier_name": seed["supplier"]["name"]}]
        }).json()
        seed["created"]["orders"].append(o["id"])
        inv = client.post(f"{API}/invoices/from-order/{o['id']}", json={}).json()
        seed["created"]["invoices"].append(inv["id"])

        # Return 2
        r = client.post(f"{API}/returns", json={
            "invoice_id": inv["id"],
            "items": [{"product_id": seed["product"]["id"], "product_name": seed["product"]["name"],
                       "quantity": 2, "unit_price": 150, "cost_price": 100, "reason": "defect"}]
        })
        assert r.status_code == 200, r.text
        ret = r.json()
        seed["created"]["returns"].append(ret["id"])
        assert ret["total_amount"] == 300
        assert ret["return_number"].startswith("RET-")

        # Over-return of 4 (only 3 left) should fail
        r2 = client.post(f"{API}/returns", json={
            "invoice_id": inv["id"],
            "items": [{"product_id": seed["product"]["id"], "product_name": seed["product"]["name"],
                       "quantity": 4, "unit_price": 150, "cost_price": 100}]
        })
        assert r2.status_code == 400
        assert "available" in r2.text.lower()

        # GET invoice shows returned_amount + balance
        ginv = client.get(f"{API}/invoices/{inv['id']}").json()
        assert ginv["returned_amount"] == 300
        assert ginv["balance"] == round(inv["total_amount"] - 0 - 300, 2)

        # Returned-stock entry exists with cost_price=100
        rs_list = client.get(f"{API}/returned-stock", params={"product_id": seed["product"]["id"]}).json()
        matches = [s for s in rs_list if s.get("return_id") == ret["id"]]
        assert len(matches) == 1
        assert matches[0]["cost_price"] == 100
        assert matches[0]["quantity_available"] == 2
        assert matches[0]["source"] == "customer_return"

        # by-product grouping
        bp = client.get(f"{API}/returned-stock/by-product").json()
        entry = next((g for g in bp if g["product_id"] == seed["product"]["id"]), None)
        assert entry is not None
        assert entry["total_remaining"] >= 2

        seed["_ret_id"] = ret["id"]
        seed["_inv_with_return"] = inv["id"]
        seed["_rs_id"] = matches[0]["id"]

    def test_order_using_returned_stock(self, client, seed):
        """Order from returned stock: cost_price preserved, NO auto-purchase."""
        rs_id = seed["_rs_id"]
        o = client.post(f"{API}/orders", json={
            "customer_id": seed["customer"]["id"], "customer_name": seed["customer"]["name"],
            "items": [{"product_id": seed["product"]["id"], "product_name": seed["product"]["name"],
                       "quantity": 1, "unit_price": 180,
                       "source": "returned_stock", "returned_stock_id": rs_id}]
        })
        assert o.status_code == 200, o.text
        order = o.json()
        seed["created"]["orders"].append(order["id"])

        # cost_price snapshot = 100 (from returned_stock), profit = 80
        item = order["items"][0]
        assert item["cost_price"] == 100
        assert item["source"] == "returned_stock"

        # Order detail shows correct profit
        full = client.get(f"{API}/orders/{order['id']}").json()
        assert full["total_profit"] == 80.0

        # No purchase auto-created for returned-stock item
        purs = client.get(f"{API}/purchases").json()
        auto_purs = [p for p in purs if p.get("order_id") == order["id"]]
        assert len(auto_purs) == 0, f"should not create purchase for returned_stock: {auto_purs}"

        # quantity_used incremented
        rs = [s for s in client.get(f"{API}/returned-stock").json() if s["id"] == rs_id][0]
        assert rs["quantity_used"] == 1

    def test_returned_stock_over_consume(self, client, seed):
        rs_id = seed["_rs_id"]
        # Remaining = 2 - 1 used = 1. Request 5 should fail.
        r = client.post(f"{API}/orders", json={
            "customer_id": seed["customer"]["id"], "customer_name": seed["customer"]["name"],
            "items": [{"product_id": seed["product"]["id"], "product_name": seed["product"]["name"],
                       "quantity": 5, "unit_price": 180,
                       "source": "returned_stock", "returned_stock_id": rs_id}]
        })
        assert r.status_code == 400
        assert "available" in r.text.lower()

    def test_delete_return_blocks_if_used(self, client, seed):
        # Since we consumed from returned stock in previous test, delete return must fail
        r = client.delete(f"{API}/returns/{seed['_ret_id']}")
        assert r.status_code == 400
        assert "already used" in r.text.lower() or "used" in r.text.lower()

    def test_manual_opening_returned_stock(self, client, seed):
        r = client.post(f"{API}/returned-stock", json={
            "product_id": seed["product"]["id"],
            "product_name": seed["product"]["name"],
            "quantity": 10, "cost_price": 85, "unit_price": 140,
            "notes": "TEST_opening"
        })
        assert r.status_code == 200, r.text
        rs = r.json()
        seed["created"]["returned_stock"].append(rs["id"])
        assert rs["source"] == "manual_opening"
        assert rs["cost_price"] == 85

        # Delete allowed (manual opening, not used)
        d = client.delete(f"{API}/returned-stock/{rs['id']}")
        assert d.status_code == 200
        seed["created"]["returned_stock"].remove(rs["id"])

    def test_delete_returned_stock_customer_return_blocked(self, client, seed):
        # Cannot delete a customer_return source directly
        d = client.delete(f"{API}/returned-stock/{seed['_rs_id']}")
        assert d.status_code == 400


# ── Customer outstanding: opening + invoices - payments - returns ───────────

class TestCustomerOutstanding:
    def test_outstanding_includes_opening_and_returns(self, client, seed):
        r = client.get(f"{API}/reports/customer-outstanding/{seed['customer']['id']}")
        assert r.status_code == 200
        data = r.json()
        assert data["opening_balance"] == 500.0
        # total_outstanding includes opening
        assert data["total_outstanding"] >= 500

        # list_customers also
        custs = client.get(f"{API}/customers").json()
        me = next(c for c in custs if c["id"] == seed["customer"]["id"])
        assert "outstanding" in me

        # get_customer shows total_returned
        gc = client.get(f"{API}/customers/{seed['customer']['id']}").json()
        assert gc["opening_balance"] == 500.0
        assert gc["total_returned"] >= 300


# ── Supplier payable ────────────────────────────────────────────────────────

class TestSupplierPayable:
    def test_payable_includes_opening(self, client, seed):
        r = client.get(f"{API}/reports/supplier-payable")
        assert r.status_code == 200
        items = r.json()["items"]
        mine = next((s for s in items if s["supplier_id"] == seed["supplier"]["id"]), None)
        assert mine is not None
        assert mine["opening_balance"] == 300.0
        assert mine["payable"] >= 300


# ── Payments: backdated ──────────────────────────────────────────────────────

class TestPaymentBackdated:
    def test_payment_created_at(self, client, seed):
        inv_id = seed.get("_inv_with_return")
        assert inv_id
        back = "2022-12-01T00:00:00+00:00"
        r = client.post(f"{API}/payments", json={
            "payment_type": "customer",
            "entity_id": seed["customer"]["id"],
            "entity_name": seed["customer"]["name"],
            "amount": 100,
            "payment_method": "cash",
            "allocations": [{"reference_id": inv_id, "reference_type": "invoice", "amount": 100}],
            "created_at": back
        })
        assert r.status_code == 200, r.text
        p = r.json()
        seed["created"]["payments"].append(p["id"])
        assert p["created_at"].startswith("2022-12-01")
