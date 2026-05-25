"""Phase 2 backend tests for Commercial Trading: orders auto-purchases, payment allocations,
invoice status filter, customer/supplier profile, reports, analytics, dashboard."""
import os
import time
import requests
import pytest

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
ADMIN_EMAIL = "admin@example.com"
ADMIN_PASSWORD = "admin123"


@pytest.fixture(scope="session")
def client():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"Login failed: {r.text}"
    assert "access_token" in s.cookies
    return s


@pytest.fixture(scope="session")
def seed(client):
    """Create a customer, supplier, two products to be used across tests."""
    ts = int(time.time())
    cust = client.post(f"{BASE_URL}/api/customers", json={
        "name": f"TEST_Cust_{ts}", "phone": "0771234567", "shop_name": "TEST_Shop"
    }).json()
    sup = client.post(f"{BASE_URL}/api/suppliers", json={
        "name": f"TEST_Sup_{ts}", "phone": "0117654321"
    }).json()
    prod1 = client.post(f"{BASE_URL}/api/products", json={
        "name": f"TEST_Prod_A_{ts}", "selling_price": 100.0, "cost_price": 60.0
    }).json()
    prod2 = client.post(f"{BASE_URL}/api/products", json={
        "name": f"TEST_Prod_B_{ts}", "selling_price": 200.0, "cost_price": 150.0
    }).json()
    data = {"customer": cust, "supplier": sup, "products": [prod1, prod2], "created_ids": {
        "customers": [cust["id"]], "suppliers": [sup["id"]],
        "products": [prod1["id"], prod2["id"]], "orders": [], "invoices": [], "payments": []
    }}
    yield data
    # Teardown
    for pid in data["created_ids"]["payments"]:
        client.delete(f"{BASE_URL}/api/payments/{pid}")
    for iid in data["created_ids"]["invoices"]:
        client.delete(f"{BASE_URL}/api/invoices/{iid}")
    for oid in data["created_ids"]["orders"]:
        client.delete(f"{BASE_URL}/api/orders/{oid}")
    for pid in data["created_ids"]["products"]:
        client.delete(f"{BASE_URL}/api/products/{pid}")
    for sid in data["created_ids"]["suppliers"]:
        client.delete(f"{BASE_URL}/api/suppliers/{sid}")
    for cid in data["created_ids"]["customers"]:
        client.delete(f"{BASE_URL}/api/customers/{cid}")


# ──────────────────────────── Auth ────────────────────────────

def test_health():
    r = requests.get(f"{BASE_URL}/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_login_invalid():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": "x@x.com", "password": "wrong"})
    assert r.status_code == 401


def test_me(client):
    r = client.get(f"{BASE_URL}/api/auth/me")
    assert r.status_code == 200
    assert r.json()["email"] == ADMIN_EMAIL


# ──────────────────────────── Orders → Auto Purchases ────────────────────────────

def test_order_auto_creates_supplier_payable(client, seed):
    """POST /api/orders auto-creates supplier purchases; supplier.payable increases."""
    sup_id = seed["supplier"]["id"]
    # baseline payable
    sup_before = client.get(f"{BASE_URL}/api/suppliers/{sup_id}").json()
    payable_before = sup_before.get("payable", 0)

    order_payload = {
        "customer_id": seed["customer"]["id"],
        "customer_name": seed["customer"]["name"],
        "items": [{
            "product_id": seed["products"][0]["id"],
            "product_name": seed["products"][0]["name"],
            "quantity": 5,
            "unit_price": 100.0,
            "supplier_id": sup_id,
            "supplier_name": seed["supplier"]["name"]
        }]
    }
    r = client.post(f"{BASE_URL}/api/orders", json=order_payload)
    assert r.status_code == 200, r.text
    order = r.json()
    assert order["order_number"].startswith("ORD-")
    seed["created_ids"]["orders"].append(order["id"])

    sup_after = client.get(f"{BASE_URL}/api/suppliers/{sup_id}").json()
    expected_increase = 5 * 60.0  # qty * cost_price
    assert round(sup_after["payable"] - payable_before, 2) == expected_increase, (
        f"Expected payable increase by {expected_increase}, got {sup_after['payable'] - payable_before}"
    )
    # purchases section should have one record linked to order
    assert any(p.get("order_id") == order["id"] for p in sup_after["purchases"])


def test_order_get_returns_profit(client, seed):
    """GET /api/orders/{id} returns total_profit, total_cost, per-item profit."""
    order_id = seed["created_ids"]["orders"][0]
    r = client.get(f"{BASE_URL}/api/orders/{order_id}")
    assert r.status_code == 200
    o = r.json()
    assert "total_profit" in o and "total_cost" in o
    # 5 * (100 - 60) = 200
    assert o["total_profit"] == 200.0
    assert o["total_cost"] == 300.0
    assert all("profit" in i and "cost_price" in i for i in o["items"])


def test_assign_supplier_resyncs_purchases(client, seed):
    """PUT /api/orders/{id}/assign-supplier re-syncs purchases to new supplier."""
    # Create order WITHOUT supplier
    order_payload = {
        "customer_id": seed["customer"]["id"],
        "customer_name": seed["customer"]["name"],
        "items": [{
            "product_id": seed["products"][1]["id"],
            "product_name": seed["products"][1]["name"],
            "quantity": 2,
            "unit_price": 200.0
        }]
    }
    order = client.post(f"{BASE_URL}/api/orders", json=order_payload).json()
    seed["created_ids"]["orders"].append(order["id"])
    item_id = order["items"][0]["id"]

    sup_id = seed["supplier"]["id"]
    payable_before = client.get(f"{BASE_URL}/api/suppliers/{sup_id}").json()["payable"]

    r = client.put(f"{BASE_URL}/api/orders/{order['id']}/assign-supplier", json={
        "item_id": item_id, "supplier_id": sup_id, "supplier_name": seed["supplier"]["name"]
    })
    assert r.status_code == 200

    payable_after = client.get(f"{BASE_URL}/api/suppliers/{sup_id}").json()["payable"]
    assert round(payable_after - payable_before, 2) == 2 * 150.0


def test_status_forward_and_backward(client, seed):
    """PUT /api/orders/{id}/status supports forward and backward (undo)."""
    order_id = seed["created_ids"]["orders"][0]
    order = client.get(f"{BASE_URL}/api/orders/{order_id}").json()
    item_id = order["items"][0]["id"]

    # forward: pending -> ordered -> delivered
    r1 = client.put(f"{BASE_URL}/api/orders/{order_id}/status", json={"status": "ordered", "item_ids": [item_id]})
    assert r1.status_code == 200 and r1.json()["items"][0]["status"] == "ordered"
    r2 = client.put(f"{BASE_URL}/api/orders/{order_id}/status", json={"status": "delivered", "item_ids": [item_id]})
    assert r2.status_code == 200 and r2.json()["items"][0]["status"] == "delivered"
    # backward (undo): delivered -> ordered -> pending
    r3 = client.put(f"{BASE_URL}/api/orders/{order_id}/status", json={"status": "ordered", "item_ids": [item_id]})
    assert r3.status_code == 200 and r3.json()["items"][0]["status"] == "ordered"
    r4 = client.put(f"{BASE_URL}/api/orders/{order_id}/status", json={"status": "pending", "item_ids": [item_id]})
    assert r4.status_code == 200 and r4.json()["items"][0]["status"] == "pending"


def test_delete_order_removes_auto_purchases(client, seed):
    """DELETE /api/orders/{id} removes auto-generated purchases."""
    sup_id = seed["supplier"]["id"]
    order_payload = {
        "customer_id": seed["customer"]["id"],
        "customer_name": seed["customer"]["name"],
        "items": [{
            "product_id": seed["products"][0]["id"],
            "product_name": seed["products"][0]["name"],
            "quantity": 3,
            "unit_price": 100.0,
            "supplier_id": sup_id,
            "supplier_name": seed["supplier"]["name"]
        }]
    }
    order = client.post(f"{BASE_URL}/api/orders", json=order_payload).json()
    payable_before = client.get(f"{BASE_URL}/api/suppliers/{sup_id}").json()["payable"]

    r = client.delete(f"{BASE_URL}/api/orders/{order['id']}")
    assert r.status_code == 200

    payable_after = client.get(f"{BASE_URL}/api/suppliers/{sup_id}").json()["payable"]
    assert round(payable_before - payable_after, 2) == 3 * 60.0


# ──────────────────────────── Invoice + Payment Allocations ────────────────────────────

def test_invoice_status_filter_and_paid_amount(client, seed):
    """Create invoice -> partial payment -> paid, verify status filter & paid_amount from allocations."""
    # Create invoice manually
    inv_payload = {
        "customer_id": seed["customer"]["id"],
        "customer_name": seed["customer"]["name"],
        "customer_shop_name": "TEST_Shop",
        "items": [{
            "product_id": seed["products"][0]["id"],
            "product_name": seed["products"][0]["name"],
            "quantity": 4,
            "unit_price": 100.0
        }]
    }
    inv = client.post(f"{BASE_URL}/api/invoices", json=inv_payload).json()
    seed["created_ids"]["invoices"].append(inv["id"])
    inv_id = inv["id"]
    assert inv["total_amount"] == 400.0
    assert inv["status"] == "unpaid"

    # Filter by unpaid - should include
    r = client.get(f"{BASE_URL}/api/invoices?status=unpaid")
    assert any(i["id"] == inv_id for i in r.json())

    # partial payment with allocations
    pay1 = client.post(f"{BASE_URL}/api/payments", json={
        "payment_type": "customer",
        "entity_id": seed["customer"]["id"],
        "entity_name": seed["customer"]["name"],
        "amount": 150.0,
        "payment_method": "cash",
        "allocations": [{"reference_id": inv_id, "reference_type": "invoice", "amount": 150.0}]
    })
    assert pay1.status_code == 200, pay1.text
    seed["created_ids"]["payments"].append(pay1.json()["id"])

    # Verify status updated to partial
    inv_check = client.get(f"{BASE_URL}/api/invoices/{inv_id}").json()
    assert inv_check["status"] == "partial"
    assert inv_check["paid_amount"] == 150.0
    assert inv_check["balance"] == 250.0

    # Filter partial
    r = client.get(f"{BASE_URL}/api/invoices?status=partial")
    assert any(i["id"] == inv_id for i in r.json())

    # full payment via cheque
    pay2 = client.post(f"{BASE_URL}/api/payments", json={
        "payment_type": "customer",
        "entity_id": seed["customer"]["id"],
        "entity_name": seed["customer"]["name"],
        "amount": 250.0,
        "payment_method": "cheque",
        "cheque_number": "CHQ-001",
        "bank_name": "Sampath Bank",
        "cheque_date": "2026-01-15",
        "allocations": [{"reference_id": inv_id, "reference_type": "invoice", "amount": 250.0}]
    })
    assert pay2.status_code == 200, pay2.text
    pay2_data = pay2.json()
    seed["created_ids"]["payments"].append(pay2_data["id"])
    assert pay2_data["cheque_number"] == "CHQ-001"
    assert pay2_data["bank_name"] == "Sampath Bank"

    inv_check = client.get(f"{BASE_URL}/api/invoices/{inv_id}").json()
    assert inv_check["status"] == "paid"
    assert inv_check["paid_amount"] == 400.0

    # Delete the cheque payment - should drop status back to partial
    client.delete(f"{BASE_URL}/api/payments/{pay2_data['id']}")
    seed["created_ids"]["payments"].remove(pay2_data["id"])
    inv_check = client.get(f"{BASE_URL}/api/invoices/{inv_id}").json()
    assert inv_check["status"] == "partial"
    assert inv_check["paid_amount"] == 150.0


# ──────────────────────────── Customer / Supplier Profile ────────────────────────────

def test_customer_profile_fields(client, seed):
    r = client.get(f"{BASE_URL}/api/customers/{seed['customer']['id']}")
    assert r.status_code == 200
    c = r.json()
    for k in ["outstanding", "monthly_avg_sales", "highest_invoice", "last_payment",
              "most_purchased_product", "invoices", "payments", "orders"]:
        assert k in c, f"Missing key: {k}"
    assert isinstance(c["invoices"], list)
    assert isinstance(c["payments"], list)
    assert isinstance(c["orders"], list)


def test_supplier_profile_fields(client, seed):
    r = client.get(f"{BASE_URL}/api/suppliers/{seed['supplier']['id']}")
    assert r.status_code == 200
    s = r.json()
    for k in ["payable", "last_payment", "fast_moving_items", "purchases", "payments"]:
        assert k in s, f"Missing key: {k}"


# ──────────────────────────── Reports ────────────────────────────

def test_reports(client, seed):
    r = client.get(f"{BASE_URL}/api/reports/customer-outstanding/{seed['customer']['id']}")
    assert r.status_code == 200
    assert "items" in r.json() and "total_outstanding" in r.json()

    r = client.get(f"{BASE_URL}/api/reports/global-outstanding")
    assert r.status_code == 200
    assert "items" in r.json() and "grand_total" in r.json()

    r = client.get(f"{BASE_URL}/api/reports/supplier-payable")
    assert r.status_code == 200
    assert "items" in r.json() and "grand_total" in r.json()


# ──────────────────────────── Analytics ────────────────────────────

@pytest.mark.parametrize("period", ["30d", "60d", "90d", "1y", "all"])
def test_analytics_periods(client, period):
    for endpoint in ["sales", "purchases", "profit"]:
        r = client.get(f"{BASE_URL}/api/analytics/{endpoint}?period={period}")
        assert r.status_code == 200, f"{endpoint}?period={period} failed: {r.text}"
        body = r.json()
        assert "data" in body
        assert body["period"] == period


# ──────────────────────────── Dashboard ────────────────────────────

def test_dashboard_summary(client):
    r = client.get(f"{BASE_URL}/api/dashboard/summary")
    assert r.status_code == 200
    d = r.json()
    for k in ["receivables", "payables", "total_profit", "daily_sales", "monthly_sales",
              "sales_trend", "pending_orders"]:
        assert k in d, f"Missing dashboard key: {k}"
    assert isinstance(d["sales_trend"], list)
