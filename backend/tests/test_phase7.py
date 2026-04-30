"""Phase 7 backend tests.

Covers:
  - Auth login + forgot/reset password (with inline-OTP fallback)
  - Suppliers payable fields (total_purchases, total_credit_notes, payable)
  - Purchases enrichment (original_amount, credit_notes_total, net_payable)
  - CRITICAL: Supplier return creates credit note linked to the purchase
              WITHOUT mutating the purchase total_amount. Delete reverses.
  - Reports: customer-outstanding (credit_notes annexure),
             supplier-outstanding, supplier-payable,
             customer-ledger, supplier-ledger
  - Payments: multi-cheque + multi-allocation validation and persistence
"""

import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fall back to local frontend .env
    with open("/app/frontend/.env") as f:
        for ln in f:
            if ln.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = ln.split("=", 1)[1].strip().rstrip("/")
                break

ADMIN_EMAIL = "admin@example.com"
ADMIN_PASSWORD = "admin123"


# ── Fixtures ────────────────────────────────────────────────────────────────
@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    data = r.json()
    token = data.get("access_token") or data.get("token")
    if token:
        s.headers.update({"Authorization": f"Bearer {token}"})
    return s


@pytest.fixture(scope="session")
def seed(session):
    """Create minimal entities and return their ids."""
    uniq = uuid.uuid4().hex[:6]

    # supplier
    r = session.post(f"{BASE_URL}/api/suppliers", json={
        "name": f"TEST_Sup_{uniq}", "phone": "000", "opening_balance": 0
    })
    assert r.status_code == 200, r.text
    supplier = r.json()

    # customer
    r = session.post(f"{BASE_URL}/api/customers", json={
        "name": f"TEST_Cust_{uniq}", "phone": "111", "opening_balance": 0
    })
    assert r.status_code == 200, r.text
    customer = r.json()

    # product
    r = session.post(f"{BASE_URL}/api/products", json={
        "name": f"TEST_Prod_{uniq}", "unit": "pcs",
        "selling_price": 100, "cost_price": 60
    })
    assert r.status_code == 200, r.text
    product = r.json()

    # purchase (qty 10 @ 60 = 600)
    r = session.post(f"{BASE_URL}/api/purchases", json={
        "supplier_id": supplier["id"], "supplier_name": supplier["name"],
        "items": [{
            "product_id": product["id"], "product_name": product["name"],
            "quantity": 10, "cost_price": 60
        }]
    })
    assert r.status_code == 200, r.text
    purchase = r.json()

    # invoice (qty 5 @ 100 = 500) with cost_price to make return flow work
    r = session.post(f"{BASE_URL}/api/invoices", json={
        "customer_id": customer["id"], "customer_name": customer["name"],
        "items": [{
            "product_id": product["id"], "product_name": product["name"],
            "quantity": 5, "unit_price": 100, "cost_price": 60
        }]
    })
    assert r.status_code == 200, r.text
    invoice = r.json()

    return {
        "supplier": supplier, "customer": customer,
        "product": product, "purchase": purchase, "invoice": invoice
    }


# ── Health & Auth ───────────────────────────────────────────────────────────
class TestAuth:
    def test_health(self):
        r = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert r.status_code == 200
        assert r.json().get("status") == "ok"

    def test_login_success(self):
        s = requests.Session()
        r = s.post(f"{BASE_URL}/api/auth/login",
                   json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                   timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d.get("email") == ADMIN_EMAIL
        # Auth is cookie-based: session cookie must have been set
        assert any(c.name in ("access_token", "session") for c in s.cookies) or \
               "access_token" in d or "token" in d
        # Verify authenticated GET works
        r = s.get(f"{BASE_URL}/api/auth/me", timeout=15)
        assert r.status_code == 200

    def test_login_bad_creds(self):
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": ADMIN_EMAIL, "password": "wrong"},
                          timeout=15)
        assert r.status_code in (400, 401)

    def test_forgot_and_reset_password(self):
        # Use a fresh password and restore it afterwards.
        r = requests.post(f"{BASE_URL}/api/auth/forgot-password",
                          json={"email": ADMIN_EMAIL}, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        # OTP may come inline when Resend fails — that's the documented fallback.
        otp = body.get("otp")
        if not otp and body.get("email_sent"):
            pytest.skip("Email sent via Resend — OTP not inline, cannot verify reset")
        assert otp, f"No OTP returned and email not sent: {body}"

        new_pw = "admin123_tmp"
        r = requests.post(f"{BASE_URL}/api/auth/reset-password",
                          json={"email": ADMIN_EMAIL, "otp": otp, "new_password": new_pw},
                          timeout=15)
        assert r.status_code == 200, r.text

        # login with new password
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": ADMIN_EMAIL, "password": new_pw}, timeout=15)
        assert r.status_code == 200

        # restore
        r = requests.post(f"{BASE_URL}/api/auth/forgot-password",
                          json={"email": ADMIN_EMAIL}, timeout=15)
        otp2 = r.json().get("otp")
        if otp2:
            r = requests.post(f"{BASE_URL}/api/auth/reset-password",
                              json={"email": ADMIN_EMAIL, "otp": otp2,
                                    "new_password": ADMIN_PASSWORD}, timeout=15)
            assert r.status_code == 200


# ── Suppliers & Purchases enrichment ───────────────────────────────────────
class TestSuppliersPurchases:
    def test_supplier_list_has_payable_fields(self, session, seed):
        r = session.get(f"{BASE_URL}/api/suppliers")
        assert r.status_code == 200
        sups = r.json()
        mine = next((s for s in sups if s["id"] == seed["supplier"]["id"]), None)
        assert mine, "Seeded supplier not found"
        assert "total_purchases" in mine
        assert "total_credit_notes" in mine
        assert "payable" in mine
        assert mine["total_purchases"] >= 600

    def test_supplier_detail(self, session, seed):
        r = session.get(f"{BASE_URL}/api/suppliers/{seed['supplier']['id']}")
        assert r.status_code == 200
        d = r.json()
        assert d["total_purchases"] >= 600
        assert "credit_notes" in d
        assert "purchases" in d
        p = d["purchases"][0]
        assert "original_amount" in p and "credit_notes_total" in p and "net_payable" in p

    def test_purchase_list_enrichment(self, session, seed):
        r = session.get(f"{BASE_URL}/api/purchases")
        assert r.status_code == 200
        purs = r.json()
        mine = next((p for p in purs if p["id"] == seed["purchase"]["id"]), None)
        assert mine
        for k in ("original_amount", "credit_notes_total", "net_payable"):
            assert k in mine, f"{k} missing"
        assert mine["original_amount"] == 600
        assert mine["net_payable"] == 600 - mine["credit_notes_total"]

    def test_purchase_detail_has_credit_notes_key(self, session, seed):
        r = session.get(f"{BASE_URL}/api/purchases/{seed['purchase']['id']}")
        assert r.status_code == 200
        d = r.json()
        assert "supplier_credit_notes" in d
        assert "net_payable" in d


# ── CRITICAL: supplier return doesn't mutate purchase total ─────────────────
class TestSupplierReturnCriticalFlow:
    def test_supplier_return_preserves_purchase_total(self, session, seed):
        purchase_id = seed["purchase"]["id"]
        supplier = seed["supplier"]
        invoice = seed["invoice"]
        product = seed["product"]

        # Pre-state
        pre = session.get(f"{BASE_URL}/api/purchases/{purchase_id}").json()
        assert pre["total_amount"] == 600
        original_total = pre["total_amount"]
        pre_credits = pre.get("credit_notes_total", 0)

        # Create supplier-bound return (qty 2 @ cost 60 = 120 credit)
        r = session.post(f"{BASE_URL}/api/returns", json={
            "invoice_id": invoice["id"],
            "destination": "supplier",
            "supplier_id": supplier["id"],
            "supplier_name": supplier["name"],
            "purchase_id": purchase_id,
            "items": [{
                "product_id": product["id"], "product_name": product["name"],
                "quantity": 2, "unit_price": 100, "cost_price": 60,
                "reason": "test"
            }],
            "notes": "TEST phase7"
        })
        assert r.status_code == 200, r.text
        ret = r.json()
        assert ret["destination"] == "supplier"
        assert ret["credit_note_kind"] == "supplier"
        assert ret.get("adjusted_purchase_id") == purchase_id
        assert ret.get("adjusted_amount") == 120  # 2 * 60

        # Post-state: total_amount must NOT change
        post = session.get(f"{BASE_URL}/api/purchases/{purchase_id}").json()
        assert post["total_amount"] == original_total, \
            f"Purchase total was mutated: {original_total} -> {post['total_amount']}"
        assert post["original_amount"] == original_total
        assert post["credit_notes_total"] == round(pre_credits + 120, 2)
        assert post["net_payable"] == round(original_total - post["credit_notes_total"], 2)

        # supplier_return_adjustments array must include the new credit line
        adj = post.get("credit_notes", [])
        assert any(a.get("return_id") == ret["id"] for a in adj)

        # Detail endpoint should list the supplier credit note
        scns = post.get("supplier_credit_notes", [])
        assert any(s["id"] == ret["id"] for s in scns)

        # stash for delete test
        pytest.phase7_return_id = ret["id"]
        pytest.phase7_purchase_id = purchase_id
        pytest.phase7_original = original_total

    def test_delete_supplier_return_reverses_adjustment(self, session):
        ret_id = getattr(pytest, "phase7_return_id", None)
        pur_id = getattr(pytest, "phase7_purchase_id", None)
        original = getattr(pytest, "phase7_original", None)
        assert ret_id and pur_id, "previous test must have run"

        r = session.delete(f"{BASE_URL}/api/returns/{ret_id}")
        assert r.status_code == 200, r.text

        post = session.get(f"{BASE_URL}/api/purchases/{pur_id}").json()
        assert post["total_amount"] == original
        # The adjustment for this return should be gone.
        assert not any(a.get("return_id") == ret_id for a in post.get("credit_notes", []))


# ── Reports ─────────────────────────────────────────────────────────────────
class TestReports:
    def test_customer_outstanding_has_credit_notes_annexure(self, session, seed):
        # create a warehouse return so annexure is non-empty
        r = session.post(f"{BASE_URL}/api/returns", json={
            "invoice_id": seed["invoice"]["id"],
            "destination": "warehouse",
            "items": [{
                "product_id": seed["product"]["id"],
                "product_name": seed["product"]["name"],
                "quantity": 1, "unit_price": 100, "cost_price": 60, "reason": "t"
            }]
        })
        assert r.status_code == 200, r.text
        cn_ret = r.json()

        r = session.get(f"{BASE_URL}/api/reports/customer-outstanding/{seed['customer']['id']}")
        assert r.status_code == 200
        d = r.json()
        assert "credit_notes" in d
        assert "credit_notes_total" in d
        assert any(c.get("credit_note_number") == cn_ret["credit_note_number"]
                   for c in d["credit_notes"])
        # cleanup
        session.delete(f"{BASE_URL}/api/returns/{cn_ret['id']}")

    def test_supplier_outstanding_report(self, session, seed):
        r = session.get(f"{BASE_URL}/api/reports/supplier-outstanding/{seed['supplier']['id']}")
        assert r.status_code == 200
        d = r.json()
        assert "purchases" in d
        assert "credit_notes" in d
        for p in d["purchases"]:
            for k in ("amount", "credit_notes", "net_amount", "paid", "balance"):
                assert k in p

    def test_supplier_payable_subtracts_credit_notes(self, session, seed):
        # create supplier credit first
        r = session.post(f"{BASE_URL}/api/returns", json={
            "invoice_id": seed["invoice"]["id"],
            "destination": "supplier",
            "supplier_id": seed["supplier"]["id"],
            "supplier_name": seed["supplier"]["name"],
            "purchase_id": seed["purchase"]["id"],
            "items": [{
                "product_id": seed["product"]["id"],
                "product_name": seed["product"]["name"],
                "quantity": 1, "unit_price": 100, "cost_price": 60, "reason": "t"
            }]
        })
        assert r.status_code == 200, r.text
        ret_id = r.json()["id"]

        r = session.get(f"{BASE_URL}/api/reports/supplier-payable")
        assert r.status_code == 200
        items = r.json()["items"]
        mine = next((i for i in items if i["supplier_id"] == seed["supplier"]["id"]), None)
        assert mine, "Supplier missing from payable report"
        assert mine["total_credit_notes"] >= 60
        # payable = purchases - credits - paid (no payments yet)
        assert mine["payable"] == round(mine["total_purchases"] - mine["total_credit_notes"], 2)

        session.delete(f"{BASE_URL}/api/returns/{ret_id}")

    def test_customer_ledger(self, session, seed):
        r = session.get(f"{BASE_URL}/api/reports/customer-ledger/{seed['customer']['id']}")
        assert r.status_code == 200
        d = r.json()
        assert "entries" in d
        assert "closing_balance" in d
        # invoice debit present
        types = {e["type"] for e in d["entries"]}
        assert "invoice" in types
        # every entry has balance + debit + credit
        for e in d["entries"]:
            assert "balance" in e and "debit" in e and "credit" in e

    def test_supplier_ledger(self, session, seed):
        r = session.get(f"{BASE_URL}/api/reports/supplier-ledger/{seed['supplier']['id']}")
        assert r.status_code == 200
        d = r.json()
        assert "entries" in d
        types = {e["type"] for e in d["entries"]}
        assert "purchase" in types


# ── Payments ────────────────────────────────────────────────────────────────
class TestPayments:
    def test_multi_cheque_valid(self, session, seed):
        r = session.post(f"{BASE_URL}/api/payments", json={
            "payment_type": "customer",
            "entity_id": seed["customer"]["id"],
            "entity_name": seed["customer"]["name"],
            "amount": 300,
            "payment_method": "cheque",
            "cheques": [
                {"amount": 100, "cheque_number": "CHQ-A", "bank_name": "B1"},
                {"amount": 200, "cheque_number": "CHQ-B", "bank_name": "B2"},
            ],
            "allocations": [
                {"reference_id": seed["invoice"]["id"], "reference_type": "invoice", "amount": 300}
            ],
            "notes": "TEST multi-cheque"
        })
        assert r.status_code == 200, r.text
        pay = r.json()
        assert len(pay["cheques"]) == 2
        assert len(pay["allocations"]) == 1

        # Verify GET by id returns cheques + allocations
        r = session.get(f"{BASE_URL}/api/payments/{pay['id']}")
        assert r.status_code == 200
        got = r.json()
        assert len(got["cheques"]) == 2
        assert got["allocations"][0]["amount"] == 300

        # cleanup
        session.delete(f"{BASE_URL}/api/payments/{pay['id']}")

    def test_multi_cheque_mismatch_rejected(self, session, seed):
        r = session.post(f"{BASE_URL}/api/payments", json={
            "payment_type": "customer",
            "entity_id": seed["customer"]["id"],
            "entity_name": seed["customer"]["name"],
            "amount": 300,
            "payment_method": "cheque",
            "cheques": [
                {"amount": 100, "cheque_number": "CHQ-X"},
                {"amount": 150, "cheque_number": "CHQ-Y"},
            ],
        })
        assert r.status_code == 400, f"expected 400 got {r.status_code}: {r.text}"

    def test_allocation_exceeds_amount_rejected(self, session, seed):
        r = session.post(f"{BASE_URL}/api/payments", json={
            "payment_type": "customer",
            "entity_id": seed["customer"]["id"],
            "entity_name": seed["customer"]["name"],
            "amount": 100,
            "payment_method": "cash",
            "allocations": [
                {"reference_id": seed["invoice"]["id"], "reference_type": "invoice", "amount": 200}
            ]
        })
        assert r.status_code == 400
