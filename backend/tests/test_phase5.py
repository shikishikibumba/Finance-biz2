"""Phase 5 — Critical fixes regression.

Covers:
 - Forgot/Reset password (Resend fallback)
 - Hybrid invoice numbering (manual + auto + duplicate)
 - Invoice enriched fields (paid_amount, returned_amount, balance, net_payable,
   credit_notes, manual_settled_amount)
 - Payment create/edit/delete → invoice status & balance recalc
 - Returns with credit_note_number + quantity validation
 - Manual settlement (full + partial)
 - Financial summary returns/profit math
 - Dashboard total_profit excludes returned items
 - Manual opening returned stock
 - Settings counters update (valid + invalid)
"""
import os
import uuid
import requests
import pytest

def _load_base_url():
    url = os.environ.get("REACT_APP_BACKEND_URL", "").strip()
    if url:
        return url.rstrip("/")
    env_path = "/app/frontend/.env"
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL not set")


BASE_URL = _load_base_url()
TAG = uuid.uuid4().hex[:6].upper()


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": "admin@example.com", "password": "admin123"})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def seed(session):
    """Create customer + 2 products + order+invoice for Phase 5 scenarios."""
    cust = session.post(f"{BASE_URL}/api/customers", json={
        "name": f"TEST_P5_Cust_{TAG}", "shop_name": f"Shop_{TAG}",
        "phone": "0771234567", "address": "Colombo", "opening_balance": 0
    }).json()
    p1 = session.post(f"{BASE_URL}/api/products", json={
        "name": f"TEST_P5_Prod1_{TAG}", "cost_price": 100, "selling_price": 150,
        "unit": "pcs", "stock_quantity": 100
    }).json()
    p2 = session.post(f"{BASE_URL}/api/products", json={
        "name": f"TEST_P5_Prod2_{TAG}", "cost_price": 200, "selling_price": 300,
        "unit": "pcs", "stock_quantity": 100
    }).json()
    return {"cust": cust, "p1": p1, "p2": p2}


def _create_order(session, seed, qty1=5, qty2=3):
    payload = {
        "customer_id": seed["cust"]["id"],
        "customer_name": seed["cust"]["name"],
        "items": [
            {"product_id": seed["p1"]["id"], "product_name": seed["p1"]["name"],
             "quantity": qty1, "unit_price": seed["p1"]["selling_price"],
             "source": "product"},
            {"product_id": seed["p2"]["id"], "product_name": seed["p2"]["name"],
             "quantity": qty2, "unit_price": seed["p2"]["selling_price"],
             "source": "product"},
        ],
        "status": "pending"
    }
    r = session.post(f"{BASE_URL}/api/orders", json=payload)
    assert r.status_code in (200, 201), r.text
    return r.json()


# ── Auth — forgot/reset password ─────────────────────────────────────────────

def test_forgot_password_fallback_returns_otp(session):
    r = session.post(f"{BASE_URL}/api/auth/forgot-password",
                     json={"email": "admin@example.com"})
    assert r.status_code == 200, r.text
    data = r.json()
    # With empty RESEND_API_KEY → fallback
    assert data.get("email_sent") is False
    assert "otp" in data and len(data["otp"]) == 6


def test_reset_password_with_otp_roundtrip():
    """Reset to a new password, login, then reset back to admin123."""
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/forgot-password",
               json={"email": "admin@example.com"})
    otp = r.json()["otp"]
    new_pw = f"tmp_{TAG}"
    r2 = s.post(f"{BASE_URL}/api/auth/reset-password",
                json={"email": "admin@example.com", "otp": otp, "new_password": new_pw})
    assert r2.status_code == 200, r2.text
    # Login with new pw
    lr = s.post(f"{BASE_URL}/api/auth/login",
                json={"email": "admin@example.com", "password": new_pw})
    assert lr.status_code == 200
    # Reset back to admin123
    r3 = s.post(f"{BASE_URL}/api/auth/forgot-password",
                json={"email": "admin@example.com"})
    otp2 = r3.json()["otp"]
    r4 = s.post(f"{BASE_URL}/api/auth/reset-password",
                json={"email": "admin@example.com", "otp": otp2, "new_password": "admin123"})
    assert r4.status_code == 200


# ── Hybrid invoice numbering ─────────────────────────────────────────────────

def test_invoice_from_order_auto_number(session, seed):
    order = _create_order(session, seed)
    r = session.post(f"{BASE_URL}/api/invoices/from-order/{order['id']}", json={})
    assert r.status_code == 200, r.text
    inv = r.json()
    assert inv["invoice_number"].startswith("INV-")
    assert inv["manual_number"] is False


def test_invoice_from_order_manual_number_and_dup(session, seed):
    order = _create_order(session, seed)
    manual_num = f"INV-2023-LEGACY-{TAG}"
    backdated = "2023-06-15T10:00:00+00:00"
    r = session.post(f"{BASE_URL}/api/invoices/from-order/{order['id']}",
                     json={"invoice_number": manual_num, "created_at": backdated})
    assert r.status_code == 200, r.text
    inv = r.json()
    assert inv["invoice_number"] == manual_num
    assert inv["created_at"].startswith("2023-06-15")
    assert inv["manual_number"] is True
    # Duplicate attempt on a new order should fail
    order2 = _create_order(session, seed)
    r2 = session.post(f"{BASE_URL}/api/invoices/from-order/{order2['id']}",
                      json={"invoice_number": manual_num})
    assert r2.status_code == 400
    assert "already exists" in r2.json()["detail"]


# ── Invoice enriched GET ─────────────────────────────────────────────────────

def test_get_invoice_enriched_fields(session, seed):
    order = _create_order(session, seed, qty1=2, qty2=1)  # 2*150 + 1*300 = 600
    inv = session.post(f"{BASE_URL}/api/invoices/from-order/{order['id']}", json={}).json()
    r = session.get(f"{BASE_URL}/api/invoices/{inv['id']}")
    assert r.status_code == 200
    data = r.json()
    for fld in ("paid_amount", "returned_amount", "balance", "net_payable",
                "credit_notes", "manual_settled_amount"):
        assert fld in data, f"missing enriched field: {fld}"
    assert data["total_amount"] == 600
    assert data["paid_amount"] == 0
    assert data["balance"] == 600
    assert data["credit_notes"] == []


# ── Payment create / edit / delete → status/balance recalc ───────────────────

def test_payment_crud_recalculates_invoice(session, seed):
    order = _create_order(session, seed, qty1=2, qty2=1)   # total 600
    inv = session.post(f"{BASE_URL}/api/invoices/from-order/{order['id']}", json={}).json()
    inv_id = inv["id"]

    # Create partial payment: 200
    pay = session.post(f"{BASE_URL}/api/payments", json={
        "payment_type": "customer",
        "entity_id": seed["cust"]["id"], "entity_name": seed["cust"]["name"],
        "amount": 200, "payment_method": "cash",
        "allocations": [{"reference_id": inv_id, "reference_type": "invoice", "amount": 200}]
    }).json()
    check = session.get(f"{BASE_URL}/api/invoices/{inv_id}").json()
    assert check["paid_amount"] == 200
    assert check["balance"] == 400
    assert check["status"] == "partial"

    # Edit: reduce to 100
    session.put(f"{BASE_URL}/api/payments/{pay['id']}", json={
        "amount": 100,
        "allocations": [{"reference_id": inv_id, "reference_type": "invoice", "amount": 100}]
    })
    check = session.get(f"{BASE_URL}/api/invoices/{inv_id}").json()
    assert check["paid_amount"] == 100
    assert check["balance"] == 500
    assert check["status"] == "partial"

    # Delete payment → unpaid
    session.delete(f"{BASE_URL}/api/payments/{pay['id']}")
    check = session.get(f"{BASE_URL}/api/invoices/{inv_id}").json()
    assert check["paid_amount"] == 0
    assert check["balance"] == 600
    assert check["status"] == "unpaid"


# ── Returns / Credit Notes ──────────────────────────────────────────────────

def test_return_credit_note_number_and_over_qty(session, seed):
    order = _create_order(session, seed, qty1=5, qty2=2)    # 5*150 + 2*300 = 1350
    inv = session.post(f"{BASE_URL}/api/invoices/from-order/{order['id']}", json={}).json()

    # Return 2 of product1 (2*150 = 300)
    r = session.post(f"{BASE_URL}/api/returns", json={
        "invoice_id": inv["id"],
        "items": [{"product_id": seed["p1"]["id"], "product_name": seed["p1"]["name"],
                   "quantity": 2, "unit_price": 150, "cost_price": 100}]
    })
    assert r.status_code == 200, r.text
    ret = r.json()
    assert ret["credit_note_number"].startswith("CN-")

    check = session.get(f"{BASE_URL}/api/invoices/{inv['id']}").json()
    assert check["returned_amount"] == 300
    assert check["balance"] == 1050
    assert check["net_payable"] == 1050
    assert len(check["credit_notes"]) == 1
    assert check["credit_notes"][0]["credit_note_number"] == ret["credit_note_number"]

    # Over-return blocked
    r2 = session.post(f"{BASE_URL}/api/returns", json={
        "invoice_id": inv["id"],
        "items": [{"product_id": seed["p1"]["id"], "product_name": seed["p1"]["name"],
                   "quantity": 10, "unit_price": 150, "cost_price": 100}]
    })
    assert r2.status_code == 400


# ── Manual Settle ────────────────────────────────────────────────────────────

def test_manual_settle_partial_then_full(session, seed):
    order = _create_order(session, seed, qty1=4, qty2=2)   # 4*150 + 2*300 = 1200
    inv = session.post(f"{BASE_URL}/api/invoices/from-order/{order['id']}", json={}).json()
    inv_id = inv["id"]

    # Partial settle: 400
    r = session.post(f"{BASE_URL}/api/invoices/{inv_id}/settle", json={"amount": 400})
    assert r.status_code == 200, r.text
    check = session.get(f"{BASE_URL}/api/invoices/{inv_id}").json()
    assert check["manual_settled_amount"] == 400
    assert check["balance"] == 800
    assert check["status"] == "partial"

    # Full settle (no amount)
    r2 = session.post(f"{BASE_URL}/api/invoices/{inv_id}/settle", json={})
    assert r2.status_code == 200, r2.text
    check2 = session.get(f"{BASE_URL}/api/invoices/{inv_id}").json()
    assert check2["balance"] == 0
    assert check2["status"] == "paid"
    assert check2["manual_settled_amount"] == 1200


# ── Financial summary math ───────────────────────────────────────────────────

def test_financial_summary_fields_and_math(session):
    r = session.get(f"{BASE_URL}/api/reports/financial-summary")
    assert r.status_code == 200
    d = r.json()
    for fld in ("total_sales", "returns_revenue", "net_sales", "total_cost",
                "returns_cost", "net_cost", "total_profit"):
        assert fld in d, f"missing {fld}"
    assert round(d["net_sales"], 2) == round(d["total_sales"] - d["returns_revenue"], 2)
    assert round(d["net_cost"], 2) == round(d["total_cost"] - d["returns_cost"], 2)
    assert round(d["total_profit"], 2) == round(d["net_sales"] - d["net_cost"], 2)


# ── Dashboard profit decreases after a return ────────────────────────────────

def test_dashboard_profit_drops_after_return(session, seed):
    before = session.get(f"{BASE_URL}/api/dashboard/summary").json()
    profit_before = before["total_profit"]
    order = _create_order(session, seed, qty1=3, qty2=1)   # 3*150 + 1*300 = 750 ; cost 3*100+200 = 500 ; profit +250
    inv = session.post(f"{BASE_URL}/api/invoices/from-order/{order['id']}", json={}).json()
    mid = session.get(f"{BASE_URL}/api/dashboard/summary").json()
    # Now return 1 of p1 (revenue 150, cost 100, profit drop 50)
    session.post(f"{BASE_URL}/api/returns", json={
        "invoice_id": inv["id"],
        "items": [{"product_id": seed["p1"]["id"], "product_name": seed["p1"]["name"],
                   "quantity": 1, "unit_price": 150, "cost_price": 100}]
    })
    after = session.get(f"{BASE_URL}/api/dashboard/summary").json()
    assert after["total_profit"] < mid["total_profit"], \
        f"profit did not drop after return: mid={mid['total_profit']} after={after['total_profit']}"
    # Delta should be mid_profit - 50
    assert round(mid["total_profit"] - after["total_profit"], 2) == 50.0


# ── Manual returned-stock opening ────────────────────────────────────────────

def test_manual_opening_returned_stock(session, seed):
    r = session.post(f"{BASE_URL}/api/returned-stock", json={
        "product_id": seed["p1"]["id"], "product_name": seed["p1"]["name"],
        "quantity": 10, "cost_price": 80, "unit_price": 140,
        "notes": f"opening_{TAG}"
    })
    assert r.status_code == 200, r.text
    st = r.json()
    assert st["source"] == "manual_opening"
    listed = session.get(f"{BASE_URL}/api/returned-stock").json()
    assert any(s["id"] == st["id"] for s in listed)
    grp = session.get(f"{BASE_URL}/api/returned-stock/by-product").json()
    assert any(g["product_id"] == seed["p1"]["id"] for g in grp)


# ── Settings counters ────────────────────────────────────────────────────────

def test_counters_get_and_update(session):
    r = session.get(f"{BASE_URL}/api/settings/counters")
    assert r.status_code == 200
    counters = r.json()
    assert "invoices" in counters and "purchases" in counters and "orders" in counters

    # Set to value below max existing → 400
    r2 = session.put(f"{BASE_URL}/api/settings/counters/invoices", json={"value": 0})
    assert r2.status_code == 400

    # Set to a large safe value (current + 100) → OK
    high = counters["invoices"] + 100
    r3 = session.put(f"{BASE_URL}/api/settings/counters/invoices", json={"value": high})
    assert r3.status_code == 200, r3.text
    assert r3.json()["next"] == high + 1
    # Restore
    session.put(f"{BASE_URL}/api/settings/counters/invoices", json={"value": counters["invoices"]})
