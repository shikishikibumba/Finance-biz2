"""Phase 8 + Phase 9 invariants.

Covers:
  * Phase 8.1 — customer-outstanding must include invoices with returned>0
                 even if balance==0, and credit_notes annexure must contain it.
  * Phase 8.1 — customer-ledger must contain a credit_note entry with
                 ref == credit_note_number and credit == return total.
  * Phase 8.2 — supplier-ledger returns full entries (print is client-side).
  * Phase 8.4 — no 'Commerical' typo anywhere in backend JSON responses;
                 email_service defaults use 'Commercial Trading'.
  * Phase 9.1 FINAL MANDATORY SCENARIO — canonical payable formula:
                 payable = opening + purchases - credit_notes - total_supplier_payments
                 across /api/suppliers, /api/suppliers/{id},
                 /api/reports/supplier-payable, /api/reports/supplier-outstanding/{id}.
                 Unallocated payments still reduce total payable. Purchase
                 total_amount is never overwritten.
  * Phase 9.3 — _helpers module exists and app starts (GET /api/health).
"""

import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for ln in f:
            if ln.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = ln.split("=", 1)[1].strip().rstrip("/")
                break

ADMIN_EMAIL = "admin@example.com"
ADMIN_PASSWORD = "admin123"


# ── Fixtures ────────────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    r = s.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    # sanity: cookie-based auth works
    me = s.get(f"{BASE_URL}/api/auth/me", timeout=15)
    assert me.status_code == 200
    return s


# ── Phase 9.3 — helpers module / app start ─────────────────────────────────
class TestHealth:
    def test_health_endpoint_ok(self):
        r = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert r.status_code == 200
        assert r.json().get("status") == "ok"

    def test_helpers_module_present(self):
        assert os.path.exists("/app/backend/routes/_helpers.py"), \
            "routes/_helpers.py missing"
        src = open("/app/backend/routes/_helpers.py").read()
        assert "def credit_total" in src
        assert "def enrich_purchase" in src


# ── Phase 8.4 — typo scan ──────────────────────────────────────────────────
class TestBrandingNoTypo:
    def test_no_commerical_typo_in_backend_source(self):
        """Zero occurrences of the 'Commerical' misspelling in backend."""
        import subprocess
        result = subprocess.run(
            ["grep", "-rn", "Commerical", "/app/backend",
             "--include=*.py", "--include=*.json",
             "--exclude-dir=tests", "--exclude-dir=__pycache__"],
            capture_output=True, text=True,
        )
        # rc=1 means no matches (desired)
        assert result.returncode == 1, \
            f"Found 'Commerical' typo in backend:\n{result.stdout}"

    def test_email_service_uses_commercial_trading(self):
        src = open("/app/backend/email_service.py").read()
        assert "Commercial Trading" in src
        assert "Commerical" not in src  # no typo

    def test_settings_endpoint_has_no_typo(self, session):
        r = session.get(f"{BASE_URL}/api/settings", timeout=15)
        # settings may be 200 or 404 depending on whether route exists;
        # only assert no typo in any text field if present.
        if r.status_code == 200:
            body = r.text
            assert "Commerical" not in body, \
                f"'Commerical' typo found in /api/settings response: {body[:400]}"


# ── Phase 8.1 — Customer outstanding + ledger w/ returns=2500 ──────────────
class TestCustomerOutstandingWithReturns:
    @pytest.fixture(scope="class")
    def scenario(self, session):
        uniq = uuid.uuid4().hex[:6]

        # product (selling 2500, cost 1500)
        r = session.post(f"{BASE_URL}/api/products", json={
            "name": f"TEST_P81_{uniq}", "unit": "pcs",
            "selling_price": 2500, "cost_price": 1500
        })
        assert r.status_code == 200, r.text
        product = r.json()

        # customer
        r = session.post(f"{BASE_URL}/api/customers", json={
            "name": f"TEST_C81_{uniq}", "phone": "811", "opening_balance": 0
        })
        assert r.status_code == 200, r.text
        customer = r.json()

        # invoice Rs 10000 (qty 4 @ 2500)
        r = session.post(f"{BASE_URL}/api/invoices", json={
            "customer_id": customer["id"], "customer_name": customer["name"],
            "items": [{
                "product_id": product["id"], "product_name": product["name"],
                "quantity": 4, "unit_price": 2500, "cost_price": 1500
            }]
        })
        assert r.status_code == 200, r.text
        invoice = r.json()
        assert invoice["total_amount"] == 10000

        # customer return linked to that invoice, Rs 2500 (qty 1 @ 2500)
        r = session.post(f"{BASE_URL}/api/returns", json={
            "invoice_id": invoice["id"],
            "destination": "warehouse",
            "items": [{
                "product_id": product["id"], "product_name": product["name"],
                "quantity": 1, "unit_price": 2500, "cost_price": 1500,
                "reason": "phase81"
            }],
            "notes": "TEST phase81 return"
        })
        assert r.status_code == 200, r.text
        ret = r.json()
        assert round(float(ret["total_amount"]), 2) == 2500.0
        assert ret.get("credit_note_number", "").startswith("CN-")

        return {"customer": customer, "invoice": invoice,
                "product": product, "return": ret}

    def test_outstanding_returned_column_is_2500(self, session, scenario):
        cid = scenario["customer"]["id"]
        inv_no = scenario["invoice"]["invoice_number"]
        r = session.get(f"{BASE_URL}/api/reports/customer-outstanding/{cid}")
        assert r.status_code == 200, r.text
        d = r.json()
        items = d.get("items", [])
        mine = next((i for i in items if i["invoice_number"] == inv_no), None)
        assert mine, f"invoice {inv_no} missing from outstanding items"
        assert mine["returned"] == 2500, \
            f"expected returned==2500, got {mine['returned']}"
        # balance should be 10000 - 0 - 2500 = 7500 (no payments yet)
        assert mine["balance"] == 7500

    def test_outstanding_returns_annexure_contains_cn(self, session, scenario):
        cid = scenario["customer"]["id"]
        cn_no = scenario["return"]["credit_note_number"]
        r = session.get(f"{BASE_URL}/api/reports/customer-outstanding/{cid}")
        d = r.json()
        assert any(c.get("credit_note_number") == cn_no
                   for c in d.get("credit_notes", [])), \
            f"credit note {cn_no} missing from annexure"
        assert d["credit_notes_total"] >= 2500

    def test_ledger_has_credit_note_entry(self, session, scenario):
        cid = scenario["customer"]["id"]
        cn_no = scenario["return"]["credit_note_number"]
        r = session.get(f"{BASE_URL}/api/reports/customer-ledger/{cid}")
        assert r.status_code == 200, r.text
        d = r.json()
        cn_entries = [e for e in d["entries"]
                      if e["type"] == "credit_note" and e["ref"] == cn_no]
        assert cn_entries, (
            f"no credit_note entry with ref={cn_no} in ledger. "
            f"Entries: {d['entries']}"
        )
        e = cn_entries[0]
        assert e["credit"] == 2500
        assert e["debit"] == 0

    def test_returned_still_shown_when_balance_zero(self, session, scenario):
        """Return on same invoice is shown on outstanding even if fully paid."""
        # pay the remaining 7500 so balance becomes 0
        r = session.post(f"{BASE_URL}/api/payments", json={
            "payment_type": "customer",
            "entity_id": scenario["customer"]["id"],
            "entity_name": scenario["customer"]["name"],
            "amount": 7500,
            "payment_method": "cash",
            "allocations": [{
                "reference_id": scenario["invoice"]["id"],
                "reference_type": "invoice",
                "amount": 7500
            }],
            "notes": "TEST phase81 full pay"
        })
        assert r.status_code == 200, r.text
        pay_id = r.json()["id"]

        try:
            r = session.get(
                f"{BASE_URL}/api/reports/customer-outstanding/"
                f"{scenario['customer']['id']}"
            )
            d = r.json()
            mine = next((i for i in d["items"]
                         if i["invoice_number"]
                         == scenario["invoice"]["invoice_number"]), None)
            assert mine, \
                "invoice with returned>0 should still appear even if balance=0"
            assert mine["returned"] == 2500
            assert abs(mine["balance"]) < 0.01
        finally:
            session.delete(f"{BASE_URL}/api/payments/{pay_id}")


# ── Phase 8.2 — supplier-ledger still returns full entries ─────────────────
class TestSupplierLedgerEntries:
    def test_supplier_ledger_returns_entries_list(self, session):
        # pick any existing supplier or create one with activity
        r = session.get(f"{BASE_URL}/api/suppliers", timeout=15)
        assert r.status_code == 200
        sups = r.json()
        if not sups:
            pytest.skip("no suppliers in DB")
        sid = sups[0]["id"]
        r = session.get(f"{BASE_URL}/api/reports/supplier-ledger/{sid}")
        assert r.status_code == 200, r.text
        d = r.json()
        assert "entries" in d and isinstance(d["entries"], list)
        assert "closing_balance" in d
        assert "opening_balance" in d


# ── Phase 9.1 — FINAL MANDATORY SCENARIO ───────────────────────────────────
class TestPhase91MandatoryScenario:
    @pytest.fixture(scope="class")
    def scenario(self, session):
        uniq = uuid.uuid4().hex[:6]

        # Supplier S1 (opening_balance = 0)
        r = session.post(f"{BASE_URL}/api/suppliers", json={
            "name": f"TEST_S1_{uniq}", "phone": "910", "opening_balance": 0
        })
        assert r.status_code == 200, r.text
        supplier = r.json()
        assert supplier["opening_balance"] == 0

        # Customer (for later invoice + return)
        r = session.post(f"{BASE_URL}/api/customers", json={
            "name": f"TEST_C91_{uniq}", "phone": "911", "opening_balance": 0
        })
        assert r.status_code == 200, r.text
        customer = r.json()

        # Product — cost 1000, selling 2000 -> 50 units * 1000 cost = 50000 credit
        r = session.post(f"{BASE_URL}/api/products", json={
            "name": f"TEST_P91_{uniq}", "unit": "pcs",
            "selling_price": 2000, "cost_price": 1000
        })
        assert r.status_code == 200, r.text
        product = r.json()

        # Purchase Rs 500000 (500 units * 1000 cost)
        r = session.post(f"{BASE_URL}/api/purchases", json={
            "supplier_id": supplier["id"], "supplier_name": supplier["name"],
            "items": [{
                "product_id": product["id"], "product_name": product["name"],
                "quantity": 500, "cost_price": 1000
            }]
        })
        assert r.status_code == 200, r.text
        purchase = r.json()
        assert purchase["total_amount"] == 500000

        # Payment 1: Rs 100000 WITH allocation to the purchase
        r = session.post(f"{BASE_URL}/api/payments", json={
            "payment_type": "supplier",
            "entity_id": supplier["id"],
            "entity_name": supplier["name"],
            "amount": 100000,
            "payment_method": "cash",
            "allocations": [{
                "reference_id": purchase["id"],
                "reference_type": "purchase",
                "amount": 100000
            }],
            "notes": "TEST phase91 allocated"
        })
        assert r.status_code == 200, r.text
        pay_allocated = r.json()

        # Payment 2: Rs 100000 WITHOUT allocation
        r = session.post(f"{BASE_URL}/api/payments", json={
            "payment_type": "supplier",
            "entity_id": supplier["id"],
            "entity_name": supplier["name"],
            "amount": 100000,
            "payment_method": "cash",
            "notes": "TEST phase91 unallocated"
        })
        assert r.status_code == 200, r.text
        pay_unalloc = r.json()

        # Customer invoice (required so a return can be raised)
        r = session.post(f"{BASE_URL}/api/invoices", json={
            "customer_id": customer["id"],
            "customer_name": customer["name"],
            "items": [{
                "product_id": product["id"], "product_name": product["name"],
                "quantity": 100, "unit_price": 2000, "cost_price": 1000
            }]
        })
        assert r.status_code == 200, r.text
        invoice = r.json()

        # Customer return destination=supplier, qty*cost = 50*1000 = 50000,
        # linked to the purchase (purchase_id + supplier_id set).
        r = session.post(f"{BASE_URL}/api/returns", json={
            "invoice_id": invoice["id"],
            "destination": "supplier",
            "supplier_id": supplier["id"],
            "supplier_name": supplier["name"],
            "purchase_id": purchase["id"],
            "items": [{
                "product_id": product["id"], "product_name": product["name"],
                "quantity": 50, "unit_price": 2000, "cost_price": 1000,
                "reason": "phase91"
            }],
            "notes": "TEST phase91 supplier credit"
        })
        assert r.status_code == 200, r.text
        ret = r.json()
        assert ret.get("adjusted_purchase_id") == purchase["id"]
        assert ret.get("adjusted_amount") == 50000

        return {
            "supplier": supplier, "customer": customer, "product": product,
            "purchase": purchase, "invoice": invoice, "return": ret,
            "pay_allocated": pay_allocated, "pay_unalloc": pay_unalloc,
        }

    def test_suppliers_list_payable_is_250000(self, session, scenario):
        sid = scenario["supplier"]["id"]
        r = session.get(f"{BASE_URL}/api/suppliers")
        assert r.status_code == 200
        mine = next((s for s in r.json() if s["id"] == sid), None)
        assert mine, "supplier not in list"
        assert mine["payable"] == 250000, (
            f"expected payable=250000 on /api/suppliers, "
            f"got {mine['payable']} (total_purchases={mine.get('total_purchases')} "
            f"total_credit_notes={mine.get('total_credit_notes')})"
        )

    def test_supplier_detail_payable_is_250000(self, session, scenario):
        sid = scenario["supplier"]["id"]
        r = session.get(f"{BASE_URL}/api/suppliers/{sid}")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["payable"] == 250000, (
            f"expected payable=250000 on /api/suppliers/{{id}}, got {d['payable']}"
        )

    def test_reports_supplier_payable_is_250000(self, session, scenario):
        sid = scenario["supplier"]["id"]
        r = session.get(f"{BASE_URL}/api/reports/supplier-payable")
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        mine = next((i for i in items if i["supplier_id"] == sid), None)
        assert mine, "supplier missing from supplier-payable report"
        assert mine["payable"] == 250000, (
            f"/api/reports/supplier-payable payable={mine['payable']} expected 250000"
        )
        assert mine["total_purchases"] == 500000
        assert mine["total_credit_notes"] == 50000

    def test_reports_supplier_outstanding_matches_canonical_formula(
            self, session, scenario):
        sid = scenario["supplier"]["id"]
        r = session.get(f"{BASE_URL}/api/reports/supplier-outstanding/{sid}")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["purchase_total"] == 500000
        assert d["credit_notes_total"] == 50000
        assert d["paid_total"] == 200000, (
            f"paid_total (entity-level) must include unallocated payment. "
            f"got {d['paid_total']}"
        )
        assert d["unallocated_paid"] == 100000
        assert d["total_payable"] == 250000, (
            f"total_payable={d['total_payable']} expected 250000 "
            f"(500000 - 50000 - 200000)"
        )

    def test_purchase_total_amount_never_overwritten(self, session, scenario):
        pid = scenario["purchase"]["id"]
        r = session.get(f"{BASE_URL}/api/purchases/{pid}")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["total_amount"] == 500000, (
            f"purchase total_amount was mutated: {d['total_amount']} (expected 500000)"
        )
        assert d["original_amount"] == 500000
        # credit_notes_total should equal 50000 (the supplier return adjustment)
        assert d["credit_notes_total"] == 50000
        assert d["net_payable"] == 450000
