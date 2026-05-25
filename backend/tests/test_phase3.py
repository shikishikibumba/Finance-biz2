"""Phase 3 backend tests: multi-cheque payments, edit payment, payment reports,
financial summary, and bill numbering counters."""
import os
import uuid
import pytest
import requests
from datetime import datetime, timezone

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN_EMAIL = "admin@example.com"
ADMIN_PASSWORD = "admin123"


# ── Fixtures ────────────────────────────────────────────────────────────────
@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
               timeout=15)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="session")
def seed(api):
    """Create 1 customer, 1 supplier, 1 product, 1 order, 1 invoice, return ids."""
    tag = uuid.uuid4().hex[:6]
    cust = api.post(f"{BASE_URL}/api/customers", json={
        "name": f"TEST_Phase3 Customer {tag}", "shop_name": "TEST_Shop",
        "phone": "9999900000", "address": "addr"
    }).json()
    sup = api.post(f"{BASE_URL}/api/suppliers", json={
        "name": f"TEST_Phase3 Supplier {tag}", "phone": "8888800000"
    }).json()
    prod = api.post(f"{BASE_URL}/api/products", json={
        "name": f"TEST_Widget {tag}", "selling_price": 5000, "cost_price": 3000,
        "stock_quantity": 100, "unit": "pcs"
    }).json()

    order = api.post(f"{BASE_URL}/api/orders", json={
        "customer_id": cust["id"], "customer_name": cust["name"],
        "supplier_id": sup["id"], "supplier_name": sup["name"],
        "items": [{
            "product_id": prod["id"], "product_name": prod["name"],
            "quantity": 2, "unit_price": 5000, "cost_price": 3000
        }],
        "notes": "TEST_phase3"
    }).json()
    # move to delivered so we can invoice
    api.put(f"{BASE_URL}/api/orders/{order['id']}/status",
            json={"status": "delivered", "item_ids": [order["items"][0]["id"]]})
    inv = api.post(f"{BASE_URL}/api/invoices/from-order/{order['id']}").json()

    data = {"customer": cust, "supplier": sup, "product": prod,
            "order": order, "invoice": inv}
    yield data

    # teardown
    try:
        api.delete(f"{BASE_URL}/api/invoices/{inv['id']}")
        api.delete(f"{BASE_URL}/api/orders/{order['id']}")
        api.delete(f"{BASE_URL}/api/products/{prod['id']}")
        api.delete(f"{BASE_URL}/api/suppliers/{sup['id']}")
        api.delete(f"{BASE_URL}/api/customers/{cust['id']}")
    except Exception:
        pass


# ── Multi-Cheque Payment ────────────────────────────────────────────────────
class TestMultiCheque:
    def test_multi_cheque_sum_match_succeeds(self, api, seed):
        inv = seed["invoice"]
        payload = {
            "payment_type": "customer",
            "entity_id": seed["customer"]["id"],
            "entity_name": seed["customer"]["name"],
            "amount": 10000,
            "payment_method": "cheque",
            "cheques": [
                {"amount": 6000, "bank_name": "HDFC", "cheque_number": "CH001", "cheque_date": "2026-01-15"},
                {"amount": 4000, "bank_name": "ICICI", "cheque_number": "CH002", "cheque_date": "2026-01-16"},
            ],
            "allocations": [{"reference_id": inv["id"], "reference_type": "invoice", "amount": 10000}],
        }
        r = api.post(f"{BASE_URL}/api/payments", json=payload)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["amount"] == 10000
        assert len(body["cheques"]) == 2
        assert body["cheques"][0]["cheque_number"] == "CH001"
        # verify invoice now paid
        inv_after = api.get(f"{BASE_URL}/api/invoices/{inv['id']}").json()
        assert inv_after["status"] == "paid"
        # cleanup
        api.delete(f"{BASE_URL}/api/payments/{body['id']}")

    def test_multi_cheque_mismatch_rejected(self, api, seed):
        payload = {
            "payment_type": "customer",
            "entity_id": seed["customer"]["id"],
            "entity_name": seed["customer"]["name"],
            "amount": 10000,
            "payment_method": "cheque",
            "cheques": [
                {"amount": 6000, "cheque_number": "CH100"},
                {"amount": 3000, "cheque_number": "CH101"},  # 9000 total ≠ 10000
            ],
        }
        r = api.post(f"{BASE_URL}/api/payments", json=payload)
        assert r.status_code == 400
        assert "does not match" in r.json().get("detail", "").lower() or "match" in r.json().get("detail", "").lower()

    def test_cheque_missing_number_rejected(self, api, seed):
        payload = {
            "payment_type": "customer",
            "entity_id": seed["customer"]["id"],
            "entity_name": seed["customer"]["name"],
            "amount": 5000,
            "payment_method": "cheque",
            "cheques": [{"amount": 5000, "cheque_number": ""}],
        }
        r = api.post(f"{BASE_URL}/api/payments", json=payload)
        assert r.status_code == 400


# ── Edit Payment ────────────────────────────────────────────────────────────
class TestEditPayment:
    def test_update_amount_recalcs_invoice(self, api, seed):
        inv = seed["invoice"]
        # create a full payment (paid)
        payload = {
            "payment_type": "customer",
            "entity_id": seed["customer"]["id"],
            "entity_name": seed["customer"]["name"],
            "amount": 10000,
            "payment_method": "cash",
            "allocations": [{"reference_id": inv["id"], "reference_type": "invoice", "amount": 10000}],
        }
        r = api.post(f"{BASE_URL}/api/payments", json=payload)
        assert r.status_code == 200
        pay = r.json()
        inv_after = api.get(f"{BASE_URL}/api/invoices/{inv['id']}").json()
        assert inv_after["status"] == "paid"

        # reduce to partial
        upd = api.put(f"{BASE_URL}/api/payments/{pay['id']}", json={
            "amount": 5000,
            "allocations": [{"reference_id": inv["id"], "reference_type": "invoice", "amount": 5000}],
        })
        assert upd.status_code == 200, upd.text
        assert upd.json()["amount"] == 5000
        inv_after2 = api.get(f"{BASE_URL}/api/invoices/{inv['id']}").json()
        assert inv_after2["status"] == "partial"

        # cleanup
        api.delete(f"{BASE_URL}/api/payments/{pay['id']}")
        inv_final = api.get(f"{BASE_URL}/api/invoices/{inv['id']}").json()
        assert inv_final["status"] == "unpaid"

    def test_update_nonexistent_returns_404(self, api):
        r = api.put(f"{BASE_URL}/api/payments/non-existent-id", json={"amount": 1})
        assert r.status_code == 404


# ── Payment Reports ─────────────────────────────────────────────────────────
class TestPaymentReports:
    def test_customer_payments_report(self, api, seed):
        # create a payment for our test customer
        pay = api.post(f"{BASE_URL}/api/payments", json={
            "payment_type": "customer",
            "entity_id": seed["customer"]["id"],
            "entity_name": seed["customer"]["name"],
            "amount": 2500,
            "payment_method": "cash",
        }).json()

        today = datetime.now(timezone.utc).date().isoformat()
        r = api.get(f"{BASE_URL}/api/reports/customer-payments",
                    params={"date_from": today, "date_to": today})
        assert r.status_code == 200
        body = r.json()
        assert "items" in body and "total" in body and "count" in body
        assert body["count"] >= 1
        assert body["total"] >= 2500
        keys = {"id", "date", "customer_name", "amount", "payment_method"}
        assert keys.issubset(body["items"][0].keys())
        api.delete(f"{BASE_URL}/api/payments/{pay['id']}")

    def test_supplier_payments_report(self, api, seed):
        pay = api.post(f"{BASE_URL}/api/payments", json={
            "payment_type": "supplier",
            "entity_id": seed["supplier"]["id"],
            "entity_name": seed["supplier"]["name"],
            "amount": 1500,
            "payment_method": "bank",
        }).json()
        r = api.get(f"{BASE_URL}/api/reports/supplier-payments")
        assert r.status_code == 200
        body = r.json()
        assert "items" in body and "total" in body
        assert any(it["id"] == pay["id"] for it in body["items"])
        api.delete(f"{BASE_URL}/api/payments/{pay['id']}")


# ── Financial Summary ───────────────────────────────────────────────────────
class TestFinancialSummary:
    def test_financial_summary_fields(self, api):
        r = api.get(f"{BASE_URL}/api/reports/financial-summary")
        assert r.status_code == 200
        body = r.json()
        for k in ("total_sales", "total_profit", "total_payables", "customer_count"):
            assert k in body, f"missing key {k}"
        assert isinstance(body["customer_count"], int)

    def test_financial_summary_empty_range_zeros(self, api):
        r = api.get(f"{BASE_URL}/api/reports/financial-summary",
                    params={"date_from": "1990-01-01", "date_to": "1990-01-02"})
        assert r.status_code == 200
        body = r.json()
        assert body["total_sales"] == 0
        assert body["customer_count"] == 0


# ── Counter / Bill Numbering ────────────────────────────────────────────────
class TestCounters:
    def test_get_counters_shape(self, api):
        r = api.get(f"{BASE_URL}/api/settings/counters")
        assert r.status_code == 200
        body = r.json()
        assert set(body.keys()) == {"invoices", "purchases", "orders"}

    def test_set_counter_below_max_rejected(self, api):
        r = api.put(f"{BASE_URL}/api/settings/counters/invoices", json={"value": 0})
        # existing invoices already seeded INV-1051 etc., so value=0 should fail
        assert r.status_code == 400
        assert "below highest existing" in r.json().get("detail", "").lower() \
            or "cannot set" in r.json().get("detail", "").lower()

    def test_set_counter_updates_and_next_invoice_uses_it(self, api, seed):
        # read current invoices counter max
        counters = api.get(f"{BASE_URL}/api/settings/counters").json()
        current = counters["invoices"]
        new_val = max(current, 2000) + 50  # safely above
        r = api.put(f"{BASE_URL}/api/settings/counters/invoices", json={"value": new_val})
        assert r.status_code == 200, r.text
        assert r.json()["value"] == new_val
        assert r.json()["next"] == new_val + 1

        # now create order+deliver+invoice and verify invoice_number = INV-{new_val+1}
        tag = uuid.uuid4().hex[:6]
        order = api.post(f"{BASE_URL}/api/orders", json={
            "customer_id": seed["customer"]["id"], "customer_name": seed["customer"]["name"],
            "supplier_id": seed["supplier"]["id"], "supplier_name": seed["supplier"]["name"],
            "items": [{
                "product_id": seed["product"]["id"], "product_name": seed["product"]["name"],
                "quantity": 1, "unit_price": 5000, "cost_price": 3000
            }],
            "notes": f"TEST_counter {tag}"
        }).json()
        api.put(f"{BASE_URL}/api/orders/{order['id']}/status",
                json={"status": "delivered", "item_ids": [order["items"][0]["id"]]})
        inv = api.post(f"{BASE_URL}/api/invoices/from-order/{order['id']}").json()
        assert inv["invoice_number"] == f"INV-{new_val + 1}", \
            f"Expected INV-{new_val + 1}, got {inv['invoice_number']}"

        # cleanup
        api.delete(f"{BASE_URL}/api/invoices/{inv['id']}")
        api.delete(f"{BASE_URL}/api/orders/{order['id']}")

    def test_invalid_counter_name_400(self, api):
        r = api.put(f"{BASE_URL}/api/settings/counters/bogus", json={"value": 10})
        assert r.status_code == 400
