from fastapi import APIRouter, Depends
from typing import Optional
from datetime import datetime, timezone, timedelta
from database import db
from auth import get_current_user

router = APIRouter(prefix="/api/reports", tags=["reports"])


def _date_filter(date_from: Optional[str], date_to: Optional[str]):
    """Build a Mongo date filter on created_at (ISO strings)."""
    cond = {}
    if date_from:
        cond["$gte"] = date_from
    if date_to:
        cond["$lte"] = date_to + "T23:59:59"
    return {"created_at": cond} if cond else {}


def _credit_total(purchase: dict) -> float:
    return round(sum(float(a.get("amount", 0)) for a in purchase.get("supplier_return_adjustments", []) or []), 2)


# ────────────────────────────────────────────────────────────────────────────
# Customer Outstanding (with credit-note annexure data)
# ────────────────────────────────────────────────────────────────────────────
@router.get("/customer-outstanding/{customer_id}")
async def customer_outstanding(customer_id: str, user=Depends(get_current_user)):
    customer = await db.customers.find_one({"id": customer_id}, {"_id": 0})
    if not customer:
        return {"error": "Customer not found"}

    invoices = await db.invoices.find({"customer_id": customer_id}, {"_id": 0}).sort("created_at", -1).to_list(1000)

    # All customer-side credit notes (returns) for this customer (used for both
    # per-invoice subtraction and the printable annexure).
    all_returns = await db.returns.find(
        {"customer_id": customer_id},
        {"_id": 0}
    ).sort("created_at", -1).to_list(1000)
    returns_map = {}
    for r in all_returns:
        amt = float(r.get("total_amount", 0) or 0)
        returns_map[r["invoice_id"]] = returns_map.get(r["invoice_id"], 0) + amt

    report_items = []
    total_outstanding = 0
    for inv in invoices:
        alloc_result = await db.payments.aggregate([
            {"$match": {"payment_type": "customer"}},
            {"$unwind": "$allocations"},
            {"$match": {"allocations.reference_id": inv["id"]}},
            {"$group": {"_id": None, "total": {"$sum": "$allocations.amount"}}}
        ]).to_list(1)
        paid = alloc_result[0]["total"] if alloc_result else 0
        returned = returns_map.get(inv["id"], 0)
        balance = inv["total_amount"] - paid - returned

        if balance > 0.01:
            report_items.append({
                "invoice_number": inv["invoice_number"],
                "invoice_id": inv["id"],
                "date": inv["created_at"][:10],
                "total_amount": inv["total_amount"],
                "paid": paid,
                "returned": round(returned, 2),
                "balance": round(balance, 2),
                "status": inv.get("status", "unpaid")
            })
            total_outstanding += balance

    opening = float(customer.get("opening_balance", 0))
    total_outstanding += opening

    # Build credit-note annexure (full list, regardless of balance)
    annexure = [{
        "credit_note_number": r.get("credit_note_number") or r.get("return_number"),
        "return_number": r.get("return_number"),
        "invoice_number": r.get("invoice_number", ""),
        "date": r.get("created_at", "")[:10],
        "total_amount": round(float(r.get("total_amount", 0) or 0), 2),
        "items": [
            {
                "product_name": it.get("product_name", ""),
                "quantity": it.get("quantity", 0),
                "unit_price": it.get("unit_price", 0),
                "amount": it.get("amount", 0),
                "reason": it.get("reason", "")
            } for it in r.get("items", [])
        ],
        "notes": r.get("notes", "")
    } for r in all_returns]

    return {
        "customer_name": customer.get("name", ""),
        "customer_shop": customer.get("shop_name", ""),
        "customer_phone": customer.get("phone", ""),
        "opening_balance": round(opening, 2),
        "items": report_items,
        "total_outstanding": round(total_outstanding, 2),
        "credit_notes": annexure,
        "credit_notes_total": round(sum(c["total_amount"] for c in annexure), 2),
        "generated_at": datetime.now(timezone.utc).isoformat()
    }


@router.get("/global-outstanding")
async def global_outstanding(user=Depends(get_current_user)):
    customers = await db.customers.find({}, {"_id": 0}).sort("name", 1).to_list(1000)

    inv_totals = await db.invoices.aggregate([
        {"$group": {"_id": "$customer_id", "total": {"$sum": "$total_amount"}}}
    ]).to_list(1000)
    inv_map = {t["_id"]: t["total"] for t in inv_totals}

    pay_totals = await db.payments.aggregate([
        {"$match": {"payment_type": "customer"}},
        {"$group": {"_id": "$entity_id", "total": {"$sum": "$amount"}}}
    ]).to_list(1000)
    pay_map = {t["_id"]: t["total"] for t in pay_totals}

    ret_totals = await db.returns.aggregate([
        {"$unwind": "$items"},
        {"$group": {"_id": "$customer_id", "total": {"$sum": "$items.amount"}}}
    ]).to_list(1000)
    ret_map = {t["_id"]: t["total"] for t in ret_totals}

    report = []
    grand_total = 0
    for c in customers:
        opening = float(c.get("opening_balance", 0))
        outstanding = opening + inv_map.get(c["id"], 0) - pay_map.get(c["id"], 0) - ret_map.get(c["id"], 0)
        if outstanding > 0.01:
            invoices = await db.invoices.find(
                {"customer_id": c["id"], "status": {"$ne": "paid"}},
                {"_id": 0, "invoice_number": 1, "total_amount": 1, "created_at": 1, "status": 1}
            ).to_list(100)
            report.append({
                "customer_id": c["id"],
                "customer_name": c.get("name", ""),
                "customer_shop": c.get("shop_name", ""),
                "opening_balance": round(opening, 2),
                "outstanding": round(outstanding, 2),
                "invoices": [{"invoice_number": i["invoice_number"], "amount": i["total_amount"], "date": i["created_at"][:10], "status": i.get("status", "unpaid")} for i in invoices]
            })
            grand_total += outstanding

    return {
        "items": report,
        "grand_total": round(grand_total, 2),
        "generated_at": datetime.now(timezone.utc).isoformat()
    }


# ────────────────────────────────────────────────────────────────────────────
# Supplier Payable Report (subtracts supplier credit notes properly)
# ────────────────────────────────────────────────────────────────────────────
@router.get("/supplier-payable")
async def supplier_payable(user=Depends(get_current_user)):
    suppliers = await db.suppliers.find({}, {"_id": 0}).sort("name", 1).to_list(1000)
    purchases = await db.purchases.find({}, {"_id": 0}).to_list(5000)

    pur_map, cn_map = {}, {}
    pur_list_map = {}
    for p in purchases:
        sid = p.get("supplier_id")
        if not sid:
            continue
        pur_map[sid] = pur_map.get(sid, 0) + float(p.get("total_amount", 0) or 0)
        cn_map[sid] = cn_map.get(sid, 0) + _credit_total(p)
        pur_list_map.setdefault(sid, []).append(p)

    pay_totals = await db.payments.aggregate([
        {"$match": {"payment_type": "supplier"}},
        {"$group": {"_id": "$entity_id", "total": {"$sum": "$amount"}}}
    ]).to_list(1000)
    pay_map = {t["_id"]: t["total"] for t in pay_totals}

    report = []
    grand_total = 0
    for s in suppliers:
        opening = float(s.get("opening_balance", 0))
        purchased = pur_map.get(s["id"], 0)
        credits = cn_map.get(s["id"], 0)
        paid = pay_map.get(s["id"], 0)
        payable = opening + purchased - credits - paid
        if payable > 0.01:
            sup_purs = pur_list_map.get(s["id"], [])
            sup_purs.sort(key=lambda x: x.get("created_at", ""), reverse=True)
            report.append({
                "supplier_id": s["id"],
                "supplier_name": s.get("name", ""),
                "opening_balance": round(opening, 2),
                "total_purchases": round(purchased, 2),
                "total_credit_notes": round(credits, 2),
                "payable": round(payable, 2),
                "purchases": [{
                    "purchase_number": p["purchase_number"],
                    "supplier_invoice_number": p.get("supplier_invoice_number", ""),
                    "amount": float(p.get("total_amount", 0) or 0),
                    "credit_notes": _credit_total(p),
                    "net_amount": round(float(p.get("total_amount", 0) or 0) - _credit_total(p), 2),
                    "date": p["created_at"][:10],
                    "order": p.get("order_number", "")
                } for p in sup_purs[:100]]
            })
            grand_total += payable

    return {
        "items": report,
        "grand_total": round(grand_total, 2),
        "generated_at": datetime.now(timezone.utc).isoformat()
    }


# ── Payment Reports ──────────────────────────────────────────────────────────

@router.get("/customer-payments")
async def customer_payments_report(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    user=Depends(get_current_user)
):
    query = {"payment_type": "customer"}
    df = _date_filter(date_from, date_to)
    if df:
        query.update(df)

    payments = await db.payments.find(query, {"_id": 0}).sort("created_at", -1).to_list(5000)
    total = sum(p.get("amount", 0) for p in payments)
    items = [
        {
            "id": p["id"],
            "date": p["created_at"][:10],
            "customer_name": p.get("entity_name", ""),
            "amount": p.get("amount", 0),
            "payment_method": p.get("payment_method", ""),
            "cheque_number": p.get("cheque_number", ""),
            "bank_name": p.get("bank_name", ""),
            "cheque_date": p.get("cheque_date", ""),
            "cheques": p.get("cheques", []),
            "notes": p.get("notes", "")
        } for p in payments
    ]
    return {
        "items": items,
        "total": round(total, 2),
        "count": len(items),
        "date_from": date_from,
        "date_to": date_to,
        "generated_at": datetime.now(timezone.utc).isoformat()
    }


@router.get("/supplier-payments")
async def supplier_payments_report(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    user=Depends(get_current_user)
):
    query = {"payment_type": "supplier"}
    df = _date_filter(date_from, date_to)
    if df:
        query.update(df)

    payments = await db.payments.find(query, {"_id": 0}).sort("created_at", -1).to_list(5000)
    total = sum(p.get("amount", 0) for p in payments)
    items = [
        {
            "id": p["id"],
            "date": p["created_at"][:10],
            "supplier_name": p.get("entity_name", ""),
            "amount": p.get("amount", 0),
            "payment_method": p.get("payment_method", ""),
            "cheque_number": p.get("cheque_number", ""),
            "bank_name": p.get("bank_name", ""),
            "cheque_date": p.get("cheque_date", ""),
            "cheques": p.get("cheques", []),
            "notes": p.get("notes", "")
        } for p in payments
    ]
    return {
        "items": items,
        "total": round(total, 2),
        "count": len(items),
        "date_from": date_from,
        "date_to": date_to,
        "generated_at": datetime.now(timezone.utc).isoformat()
    }


# ── Financial Summary ───────────────────────────────────────────────────────

@router.get("/financial-summary")
async def financial_summary(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    user=Depends(get_current_user)
):
    df = _date_filter(date_from, date_to)

    inv_query = dict(df) if df else {}
    invoices = await db.invoices.find(inv_query, {"_id": 0}).to_list(10000)
    total_sales = sum(i.get("total_amount", 0) for i in invoices)

    total_cost = 0
    customer_ids = set()
    customer_map = {}
    for inv in invoices:
        customer_ids.add(inv.get("customer_id"))
        customer_map[inv.get("customer_id")] = inv.get("customer_name", "")
        for item in inv.get("items", []):
            product = await db.products.find_one({"id": item.get("product_id")}, {"_id": 0, "cost_price": 1})
            if product:
                total_cost += (product.get("cost_price", 0) * item.get("quantity", 0))

    ret_match = dict(df) if df else {}
    ret_agg = await db.returns.aggregate([
        {"$match": ret_match} if ret_match else {"$match": {}},
        {"$unwind": "$items"},
        {"$group": {"_id": None,
                    "revenue": {"$sum": "$items.amount"},
                    "cost": {"$sum": {"$multiply": ["$items.cost_price", "$items.quantity"]}}}}
    ]).to_list(1)
    ret_revenue = ret_agg[0]["revenue"] if ret_agg else 0
    ret_cost = ret_agg[0]["cost"] if ret_agg else 0

    net_sales = total_sales - ret_revenue
    net_cost = total_cost - ret_cost
    total_profit = net_sales - net_cost

    pur_query = dict(df) if df else {}
    purchases_in_period = await db.purchases.find(pur_query, {"_id": 0}).to_list(10000)
    total_purchases = sum(float(p.get("total_amount", 0) or 0) for p in purchases_in_period)
    total_credit_notes = sum(_credit_total(p) for p in purchases_in_period)

    sup_pay_query = {"payment_type": "supplier"}
    if df:
        sup_pay_query.update(df)
    sup_pay_agg = await db.payments.aggregate([
        {"$match": sup_pay_query},
        {"$group": {"_id": None, "total": {"$sum": "$amount"}}}
    ]).to_list(1)
    total_sup_paid = sup_pay_agg[0]["total"] if sup_pay_agg else 0
    total_payables = total_purchases - total_credit_notes - total_sup_paid

    customers = []
    for cid in customer_ids:
        if cid:
            customers.append({"customer_id": cid, "customer_name": customer_map.get(cid, "")})

    return {
        "date_from": date_from,
        "date_to": date_to,
        "total_sales": round(total_sales, 2),
        "returns_revenue": round(ret_revenue, 2),
        "net_sales": round(net_sales, 2),
        "total_cost": round(total_cost, 2),
        "returns_cost": round(ret_cost, 2),
        "net_cost": round(net_cost, 2),
        "total_profit": round(total_profit, 2),
        "total_purchases": round(total_purchases, 2),
        "total_credit_notes": round(total_credit_notes, 2),
        "total_supplier_paid": round(total_sup_paid, 2),
        "total_payables": round(total_payables, 2),
        "customer_count": len(customers),
        "customers": customers,
        "invoice_count": len(invoices),
        "generated_at": datetime.now(timezone.utc).isoformat()
    }


# ────────────────────────────────────────────────────────────────────────────
# Phase 7 — Supplier Outstanding (per-supplier breakdown with credit notes)
# ────────────────────────────────────────────────────────────────────────────
@router.get("/supplier-outstanding/{supplier_id}")
async def supplier_outstanding(supplier_id: str, user=Depends(get_current_user)):
    supplier = await db.suppliers.find_one({"id": supplier_id}, {"_id": 0})
    if not supplier:
        return {"error": "Supplier not found"}

    purchases = await db.purchases.find({"supplier_id": supplier_id}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    items = []
    total_payable = 0
    total_purchases = 0
    total_credits = 0
    total_paid_alloc = 0

    for p in purchases:
        alloc = await db.payments.aggregate([
            {"$match": {"payment_type": "supplier"}},
            {"$unwind": "$allocations"},
            {"$match": {"allocations.reference_id": p["id"], "allocations.reference_type": "purchase"}},
            {"$group": {"_id": None, "total": {"$sum": "$allocations.amount"}}}
        ]).to_list(1)
        paid = alloc[0]["total"] if alloc else 0
        original = float(p.get("total_amount", 0) or 0)
        credits = _credit_total(p)
        net = round(original - credits, 2)
        balance = round(net - paid, 2)
        total_purchases += original
        total_credits += credits
        total_paid_alloc += paid
        if balance > 0.01:
            total_payable += balance
        items.append({
            "purchase_id": p["id"],
            "purchase_number": p.get("purchase_number", ""),
            "supplier_invoice_number": p.get("supplier_invoice_number", ""),
            "date": p.get("created_at", "")[:10],
            "amount": round(original, 2),
            "credit_notes": round(credits, 2),
            "net_amount": net,
            "paid": round(paid, 2),
            "balance": balance,
            "linked_invoice_number": p.get("linked_invoice_number", ""),
        })

    # All supplier-side credit notes (including those not yet linked to a purchase)
    credit_notes = await db.returns.find(
        {"supplier_id": supplier_id, "destination": "supplier"}, {"_id": 0}
    ).sort("created_at", -1).to_list(500)
    cn_annexure = [{
        "credit_note_number": r.get("credit_note_number") or r.get("return_number"),
        "purchase_number": r.get("purchase_number") or r.get("adjusted_purchase_number") or "",
        "date": r.get("created_at", "")[:10],
        "total_amount": round(float(r.get("total_amount", 0) or 0), 2),
        "adjusted_amount": round(float(r.get("adjusted_amount", 0) or 0), 2),
        "items": r.get("items", []),
        "notes": r.get("notes", ""),
    } for r in credit_notes]

    opening = float(supplier.get("opening_balance", 0) or 0)
    return {
        "supplier_id": supplier_id,
        "supplier_name": supplier.get("name", ""),
        "supplier_phone": supplier.get("phone", ""),
        "supplier_address": supplier.get("address", ""),
        "opening_balance": opening,
        "purchases": items,
        "purchase_total": round(total_purchases, 2),
        "credit_notes_total": round(total_credits, 2),
        "paid_total": round(total_paid_alloc, 2),
        "total_payable": round(total_payable + opening, 2),
        "credit_notes": cn_annexure,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/supplier-payables")
async def supplier_payables(user=Depends(get_current_user)):
    """List all suppliers with their outstanding payable (credit notes deducted)."""
    suppliers = await db.suppliers.find({}, {"_id": 0}).to_list(1000)
    purchases = await db.purchases.find({}, {"_id": 0}).to_list(5000)
    pur_map, cn_map, pur_list = {}, {}, {}
    for p in purchases:
        sid = p.get("supplier_id")
        if not sid:
            continue
        pur_map[sid] = pur_map.get(sid, 0) + float(p.get("total_amount", 0) or 0)
        cn_map[sid] = cn_map.get(sid, 0) + _credit_total(p)
        pur_list.setdefault(sid, []).append(p)

    out = []
    for s in suppliers:
        # paid via allocations
        paid_agg = await db.payments.aggregate([
            {"$match": {"payment_type": "supplier", "entity_id": s["id"]}},
            {"$group": {"_id": None, "total": {"$sum": "$amount"}}}
        ]).to_list(1)
        paid = paid_agg[0]["total"] if paid_agg else 0
        opening = float(s.get("opening_balance", 0) or 0)
        purchased = pur_map.get(s["id"], 0)
        credits = cn_map.get(s["id"], 0)
        balance = round(purchased - credits + opening - paid, 2)
        out.append({
            "supplier_id": s["id"],
            "supplier_name": s.get("name", ""),
            "purchase_total": round(purchased, 2),
            "credit_notes_total": round(credits, 2),
            "opening_balance": round(opening, 2),
            "paid_total": round(paid, 2),
            "balance": balance,
        })
    out.sort(key=lambda x: -x["balance"])
    return {
        "suppliers": out,
        "total_payable": round(sum(s["balance"] for s in out if s["balance"] > 0), 2),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


# ────────────────────────────────────────────────────────────────────────────
# Phase 7 — Customer & Supplier Ledger
# ────────────────────────────────────────────────────────────────────────────
def _in_range(iso: str, date_from: Optional[str], date_to: Optional[str]) -> bool:
    if not iso:
        return True
    d = iso[:10]
    if date_from and d < date_from:
        return False
    if date_to and d > date_to:
        return False
    return True


@router.get("/customer-ledger/{customer_id}")
async def customer_ledger(customer_id: str, date_from: Optional[str] = None,
                          date_to: Optional[str] = None, user=Depends(get_current_user)):
    customer = await db.customers.find_one({"id": customer_id}, {"_id": 0})
    if not customer:
        return {"error": "Customer not found"}

    entries = []
    opening = float(customer.get("opening_balance", 0) or 0)

    invoices = await db.invoices.find({"customer_id": customer_id}, {"_id": 0}).to_list(5000)
    for inv in invoices:
        if not _in_range(inv.get("created_at", ""), date_from, date_to):
            continue
        entries.append({
            "date": inv.get("created_at", "")[:10],
            "type": "invoice",
            "ref": inv.get("invoice_number", ""),
            "description": f"Invoice {inv.get('invoice_number','')}",
            "debit": round(float(inv.get("total_amount", 0)), 2),
            "credit": 0,
        })

    payments = await db.payments.find(
        {"payment_type": "customer", "entity_id": customer_id}, {"_id": 0}
    ).to_list(5000)
    for p in payments:
        if not _in_range(p.get("created_at", ""), date_from, date_to):
            continue
        cheque_hint = ""
        if p.get("payment_method") == "cheque":
            cqs = p.get("cheques", []) or []
            nos = ", ".join([c.get("cheque_number", "") for c in cqs if c.get("cheque_number")])
            if not nos and p.get("cheque_number"):
                nos = p.get("cheque_number", "")
            if nos:
                cheque_hint = f" (Cheque: {nos})"
        entries.append({
            "date": p.get("created_at", "")[:10],
            "type": "payment",
            "ref": p.get("payment_number", "") or p.get("id", "")[:8],
            "description": f"Payment — {p.get('payment_method', 'cash').title()}{cheque_hint}",
            "debit": 0,
            "credit": round(float(p.get("amount", 0)), 2),
        })

    returns = await db.returns.find({"customer_id": customer_id}, {"_id": 0}).to_list(5000)
    for r in returns:
        if r.get("destination") == "supplier":
            # Supplier-bound credit note doesn't reduce customer outstanding
            continue
        if not _in_range(r.get("created_at", ""), date_from, date_to):
            continue
        entries.append({
            "date": r.get("created_at", "")[:10],
            "type": "credit_note",
            "ref": r.get("credit_note_number") or r.get("return_number", ""),
            "description": f"Credit Note against {r.get('invoice_number','')}",
            "debit": 0,
            "credit": round(float(r.get("total_amount", 0)), 2),
        })

    entries.sort(key=lambda e: (e["date"], e["type"]))
    running = opening
    for e in entries:
        running = round(running + float(e["debit"]) - float(e["credit"]), 2)
        e["balance"] = running

    return {
        "customer_id": customer_id,
        "customer_name": customer.get("name", ""),
        "customer_shop": customer.get("shop_name", ""),
        "opening_balance": round(opening, 2),
        "entries": entries,
        "closing_balance": round(running, 2),
        "date_from": date_from,
        "date_to": date_to,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/supplier-ledger/{supplier_id}")
async def supplier_ledger(supplier_id: str, date_from: Optional[str] = None,
                          date_to: Optional[str] = None, user=Depends(get_current_user)):
    supplier = await db.suppliers.find_one({"id": supplier_id}, {"_id": 0})
    if not supplier:
        return {"error": "Supplier not found"}

    entries = []
    opening = float(supplier.get("opening_balance", 0) or 0)

    purchases = await db.purchases.find({"supplier_id": supplier_id}, {"_id": 0}).to_list(5000)
    for p in purchases:
        if _in_range(p.get("created_at", ""), date_from, date_to):
            entries.append({
                "date": p.get("created_at", "")[:10],
                "type": "purchase",
                "ref": p.get("purchase_number", ""),
                "description": f"Purchase {p.get('purchase_number','')} (Supplier Inv: {p.get('supplier_invoice_number','-')})",
                "debit": 0,
                "credit": round(float(p.get("total_amount", 0)), 2),
            })
        # Supplier credit notes from adjustments
        for adj in p.get("supplier_return_adjustments", []) or []:
            if not _in_range(adj.get("adjusted_at", ""), date_from, date_to):
                continue
            entries.append({
                "date": adj.get("adjusted_at", "")[:10],
                "type": "credit_note",
                "ref": adj.get("credit_note_number") or adj.get("return_number", ""),
                "description": f"Supplier Credit Note ({adj.get('product_name','')})",
                "debit": round(float(adj.get("amount", 0)), 2),
                "credit": 0,
            })

    payments = await db.payments.find(
        {"payment_type": "supplier", "entity_id": supplier_id}, {"_id": 0}
    ).to_list(5000)
    for p in payments:
        if not _in_range(p.get("created_at", ""), date_from, date_to):
            continue
        cheque_hint = ""
        if p.get("payment_method") == "cheque":
            cqs = p.get("cheques", []) or []
            nos = ", ".join([c.get("cheque_number", "") for c in cqs if c.get("cheque_number")])
            if not nos and p.get("cheque_number"):
                nos = p.get("cheque_number", "")
            if nos:
                cheque_hint = f" (Cheque: {nos})"
        entries.append({
            "date": p.get("created_at", "")[:10],
            "type": "payment",
            "ref": p.get("payment_number", "") or p.get("id", "")[:8],
            "description": f"Payment made — {p.get('payment_method', 'cash').title()}{cheque_hint}",
            "debit": round(float(p.get("amount", 0)), 2),
            "credit": 0,
        })

    entries.sort(key=lambda e: (e["date"], e["type"]))
    running = opening
    for e in entries:
        # Supplier ledger: credits grow payable; debits reduce it.
        running = round(running + float(e["credit"]) - float(e["debit"]), 2)
        e["balance"] = running

    return {
        "supplier_id": supplier_id,
        "supplier_name": supplier.get("name", ""),
        "opening_balance": round(opening, 2),
        "entries": entries,
        "closing_balance": round(running, 2),
        "date_from": date_from,
        "date_to": date_to,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
