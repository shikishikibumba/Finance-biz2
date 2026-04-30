from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import uuid
from database import db, get_next_sequence
from auth import get_current_user

router = APIRouter(prefix="/api/invoices", tags=["invoices"])


class InvoiceItemInput(BaseModel):
    product_id: str
    product_name: str
    quantity: float
    unit_price: float
    cost_price: Optional[float] = None  # used by historical-invoice → auto-purchase


class InvoiceCreate(BaseModel):
    customer_id: str
    customer_name: str
    customer_shop_name: Optional[str] = ""
    order_id: Optional[str] = None
    order_number: Optional[str] = ""
    items: List[InvoiceItemInput]
    notes: Optional[str] = ""
    invoice_number: Optional[str] = None   # manual override (hybrid numbering)
    created_at: Optional[str] = None        # backdated entry (ISO string)
    # Migration helpers — when a historical invoice has supplier info, the
    # backend will automatically create a linked purchase to keep payables
    # accurate without forcing the user to enter both forms.
    supplier_id: Optional[str] = ""
    supplier_name: Optional[str] = ""
    supplier_invoice_number: Optional[str] = ""


class InvoiceUpdate(BaseModel):
    customer_id: Optional[str] = None
    customer_name: Optional[str] = None
    customer_shop_name: Optional[str] = None
    items: Optional[List[InvoiceItemInput]] = None
    notes: Optional[str] = None
    created_at: Optional[str] = None


class InvoiceFromOrderInput(BaseModel):
    invoice_number: Optional[str] = None
    created_at: Optional[str] = None


async def _resolve_invoice_number(manual_number: Optional[str]) -> str:
    """Returns the invoice_number to use. If manual is numeric, it is used as-is
    AND the counter advances so the next auto-number continues from there
    (e.g. manual 3755 → next auto is 3756). Non-numeric manual is used verbatim.
    Auto numbers are plain integers (no 'INV-' prefix), zero-padded to 4 digits."""
    if manual_number:
        manual_number = manual_number.strip()
        if not manual_number:
            manual_number = None
    if manual_number:
        existing = await db.invoices.find_one({"invoice_number": manual_number}, {"_id": 0, "id": 1})
        if existing:
            raise HTTPException(status_code=400, detail=f"Invoice number '{manual_number}' already exists")
        # If the manual number is a pure integer, push the counter forward so
        # the next auto-number continues from there (no reset, no skip).
        try:
            n = int(manual_number)
            current = await db.counters.find_one({"_id": "invoices"})
            current_seq = int(current["seq"]) if current else 0
            if n > current_seq:
                await db.counters.update_one(
                    {"_id": "invoices"},
                    {"$set": {"seq": n}},
                    upsert=True,
                )
        except ValueError:
            pass
        return manual_number
    seq = await get_next_sequence("invoices")
    return f"{seq:04d}"


async def _compute_total_returns(invoice_id: str) -> float:
    res = await db.returns.aggregate([
        {"$match": {"invoice_id": invoice_id}},
        {"$unwind": "$items"},
        {"$group": {"_id": None, "total": {"$sum": "$items.amount"}}}
    ]).to_list(1)
    return res[0]["total"] if res else 0


@router.get("")
async def list_invoices(search: Optional[str] = None, customer_id: Optional[str] = None, status: Optional[str] = None, user=Depends(get_current_user)):
    query = {}
    conditions = []
    if search:
        conditions.append({"$or": [
            {"invoice_number": {"$regex": search, "$options": "i"}},
            {"customer_name": {"$regex": search, "$options": "i"}},
            {"order_number": {"$regex": search, "$options": "i"}}
        ]})
    if customer_id:
        conditions.append({"customer_id": customer_id})
    if status:
        conditions.append({"status": status})
    if conditions:
        query = {"$and": conditions} if len(conditions) > 1 else conditions[0]

    invoices = await db.invoices.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    # Enrich each invoice with net value after credit notes (for list display)
    # Aggregate once per batch — O(1) DB call.
    if invoices:
        invoice_ids = [i["id"] for i in invoices]
        ret_agg = await db.returns.aggregate([
            {"$match": {"invoice_id": {"$in": invoice_ids}}},
            {"$unwind": "$items"},
            {"$group": {"_id": "$invoice_id", "total": {"$sum": "$items.amount"}}}
        ]).to_list(10000)
        ret_map = {r["_id"]: r["total"] for r in ret_agg}
        for inv in invoices:
            returned = ret_map.get(inv["id"], 0)
            inv["returned_amount"] = round(returned, 2)
            inv["net_amount"] = round(inv.get("total_amount", 0) - returned, 2)
    return invoices


@router.get("/{invoice_id}")
async def get_invoice(invoice_id: str, user=Depends(get_current_user)):
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    pay_result = await db.payments.aggregate([
        {"$match": {"payment_type": "customer"}},
        {"$unwind": "$allocations"},
        {"$match": {"allocations.reference_id": invoice_id, "allocations.reference_type": "invoice"}},
        {"$group": {"_id": None, "total": {"$sum": "$allocations.amount"}}}
    ]).to_list(1)
    invoice["paid_amount"] = round(pay_result[0]["total"] if pay_result else 0, 2)
    invoice["returned_amount"] = round(await _compute_total_returns(invoice_id), 2)

    # Credit notes attached to this invoice
    credit_notes = await db.returns.find(
        {"invoice_id": invoice_id},
        {"_id": 0, "id": 1, "return_number": 1, "credit_note_number": 1,
         "total_amount": 1, "created_at": 1, "items": 1, "notes": 1}
    ).sort("created_at", 1).to_list(1000)
    for cn in credit_notes:
        # Backfill credit_note_number for legacy records
        if not cn.get("credit_note_number") and cn.get("return_number"):
            cn["credit_note_number"] = cn["return_number"].replace("RET-", "CN-")
    invoice["credit_notes"] = credit_notes

    # Manual settlement (for historical invoices) — stored on the invoice itself
    manual_settled = round(float(invoice.get("manual_settled_amount", 0) or 0), 2)
    invoice["manual_settled_amount"] = manual_settled

    # Effective outstanding = total_amount - paid - returns - manual settlement
    invoice["balance"] = round(
        invoice["total_amount"] - invoice["paid_amount"]
        - invoice["returned_amount"] - manual_settled, 2
    )
    # Net payable after credit notes (informational)
    invoice["net_payable"] = round(invoice["total_amount"] - invoice["returned_amount"], 2)

    return invoice


@router.post("")
async def create_invoice(data: InvoiceCreate, user=Depends(get_current_user)):
    invoice_number = await _resolve_invoice_number(data.invoice_number)

    items = []
    total = 0
    for item in data.items:
        item_doc = {
            "id": str(uuid.uuid4()),
            "product_id": item.product_id,
            "product_name": item.product_name,
            "quantity": item.quantity,
            "unit_price": item.unit_price,
            "amount": round(item.quantity * item.unit_price, 2)
        }
        total += item_doc["amount"]
        items.append(item_doc)

    created_at = data.created_at or datetime.now(timezone.utc).isoformat()

    doc = {
        "id": str(uuid.uuid4()),
        "invoice_number": invoice_number,
        "customer_id": data.customer_id,
        "customer_name": data.customer_name,
        "customer_shop_name": data.customer_shop_name or "",
        "order_id": data.order_id or "",
        "order_number": data.order_number or "",
        "items": items,
        "total_amount": round(total, 2),
        "status": "unpaid",
        "notes": data.notes or "",
        "manual_number": bool(data.invoice_number),
        "created_at": created_at
    }
    await db.invoices.insert_one(doc)
    doc.pop("_id", None)

    # Migration helper: auto-create a linked purchase if supplier provided.
    if (data.supplier_id or data.supplier_name) and not data.order_id:
        purchase_items = []
        purchase_total = 0
        for item in data.items:
            cost = item.cost_price if item.cost_price is not None else 0
            pi = {
                "id": str(uuid.uuid4()),
                "product_id": item.product_id,
                "product_name": item.product_name,
                "quantity": item.quantity,
                "cost_price": cost,
                "amount": round(item.quantity * cost, 2),
            }
            purchase_total += pi["amount"]
            purchase_items.append(pi)
        seq = await get_next_sequence("purchases")
        purchase_doc = {
            "id": str(uuid.uuid4()),
            "purchase_number": f"PUR-{seq:04d}",
            "supplier_id": data.supplier_id or "",
            "supplier_name": data.supplier_name or "",
            "supplier_invoice_number": data.supplier_invoice_number or "",
            "order_id": "",
            "order_number": "",
            "items": purchase_items,
            "total_amount": round(purchase_total, 2),
            "auto_generated": True,
            "manual_number": False,
            "linked_invoice_id": doc["id"],
            "linked_invoice_number": invoice_number,
            "notes": f"Auto-created from historical invoice {invoice_number}",
            "created_at": created_at,
        }
        await db.purchases.insert_one(purchase_doc)
        purchase_doc.pop("_id", None)
        doc["linked_purchase_id"] = purchase_doc["id"]
        doc["linked_purchase_number"] = purchase_doc["purchase_number"]
        await db.invoices.update_one(
            {"id": doc["id"]},
            {"$set": {
                "linked_purchase_id": purchase_doc["id"],
                "linked_purchase_number": purchase_doc["purchase_number"],
            }}
        )
    return doc


@router.put("/{invoice_id}")
async def update_invoice(invoice_id: str, data: InvoiceUpdate, user=Depends(get_current_user)):
    """Edit historical invoice. Recomputes total when items change."""
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    update = {}
    if data.customer_id is not None:
        update["customer_id"] = data.customer_id
    if data.customer_name is not None:
        update["customer_name"] = data.customer_name
    if data.customer_shop_name is not None:
        update["customer_shop_name"] = data.customer_shop_name
    if data.notes is not None:
        update["notes"] = data.notes
    if data.created_at is not None:
        update["created_at"] = data.created_at
    if data.items is not None:
        items = []
        total = 0
        for it in data.items:
            doc_item = {
                "id": str(uuid.uuid4()),
                "product_id": it.product_id,
                "product_name": it.product_name,
                "quantity": it.quantity,
                "unit_price": it.unit_price,
                "amount": round(it.quantity * it.unit_price, 2),
            }
            total += doc_item["amount"]
            items.append(doc_item)
        update["items"] = items
        update["total_amount"] = round(total, 2)

    if not update:
        raise HTTPException(status_code=400, detail="No fields to update")

    await db.invoices.update_one({"id": invoice_id}, {"$set": update})
    from routes.payments import recalc_invoice_status  # local import avoids cycle
    await recalc_invoice_status(invoice_id)
    return await get_invoice(invoice_id, user=user)


@router.post("/from-order/{order_id}")
async def create_invoice_from_order(order_id: str, data: Optional[InvoiceFromOrderInput] = None, user=Depends(get_current_user)):
    data = data or InvoiceFromOrderInput()
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    existing = await db.invoices.find_one({"order_id": order_id}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=400, detail="Invoice already exists for this order")

    invoice_number = await _resolve_invoice_number(data.invoice_number)

    items = []
    total = 0
    for oi in order["items"]:
        item_doc = {
            "id": str(uuid.uuid4()),
            "product_id": oi["product_id"],
            "product_name": oi["product_name"],
            "quantity": oi["quantity"],
            "unit_price": oi["unit_price"],
            "amount": round(oi["quantity"] * oi["unit_price"], 2)
        }
        total += item_doc["amount"]
        items.append(item_doc)

    customer = await db.customers.find_one({"id": order["customer_id"]}, {"_id": 0})
    shop_name = customer.get("shop_name", "") if customer else ""

    doc = {
        "id": str(uuid.uuid4()),
        "invoice_number": invoice_number,
        "customer_id": order["customer_id"],
        "customer_name": order["customer_name"],
        "customer_shop_name": shop_name,
        "order_id": order_id,
        "order_number": order["order_number"],
        "items": items,
        "total_amount": round(total, 2),
        "status": "unpaid",
        "notes": "",
        "manual_number": bool(data.invoice_number),
        "created_at": data.created_at or datetime.now(timezone.utc).isoformat()
    }
    await db.invoices.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.delete("/{invoice_id}")
async def delete_invoice(invoice_id: str, user=Depends(get_current_user)):
    result = await db.invoices.delete_one({"id": invoice_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return {"message": "Invoice deleted"}


class ManualSettleInput(BaseModel):
    amount: Optional[float] = None   # None/absent => settle full outstanding
    mark_as: Optional[str] = "paid"  # "paid" or "partial"
    note: Optional[str] = ""


@router.post("/{invoice_id}/settle")
async def manual_settle_invoice(invoice_id: str, data: ManualSettleInput, user=Depends(get_current_user)):
    """Mark an invoice as settled without recording a payment.

    Use for historical invoices where the money was collected outside the system.
    The amount is stored on the invoice itself (manual_settled_amount) and
    feeds into balance computation. Status is recomputed.
    """
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    # Current paid + returns already reduce outstanding. Determine the remaining.
    pay_result = await db.payments.aggregate([
        {"$match": {"payment_type": "customer"}},
        {"$unwind": "$allocations"},
        {"$match": {"allocations.reference_id": invoice_id, "allocations.reference_type": "invoice"}},
        {"$group": {"_id": None, "total": {"$sum": "$allocations.amount"}}}
    ]).to_list(1)
    paid = pay_result[0]["total"] if pay_result else 0
    returned = await _compute_total_returns(invoice_id)
    current_settled = float(invoice.get("manual_settled_amount", 0) or 0)
    total = float(invoice.get("total_amount", 0))
    outstanding = round(total - paid - returned - current_settled, 2)

    if outstanding <= 0.01:
        raise HTTPException(status_code=400, detail="Invoice already fully settled")

    if data.amount is None or data.amount <= 0:
        settle_amount = outstanding
    else:
        settle_amount = round(min(float(data.amount), outstanding), 2)

    new_settled = round(current_settled + settle_amount, 2)

    # Recompute new status
    new_balance = round(total - paid - returned - new_settled, 2)
    if new_balance <= 0.01:
        new_status = "paid"
    elif (paid + new_settled + returned) > 0:
        new_status = "partial"
    else:
        new_status = "unpaid"

    # Append to history log on the invoice
    log_entry = {
        "id": str(uuid.uuid4()),
        "amount": settle_amount,
        "note": data.note or "",
        "settled_at": datetime.now(timezone.utc).isoformat(),
        "settled_by": user.get("email", ""),
    }
    history = list(invoice.get("manual_settle_history", []))
    history.append(log_entry)

    await db.invoices.update_one(
        {"id": invoice_id},
        {"$set": {
            "manual_settled_amount": new_settled,
            "manual_settle_history": history,
            "status": new_status,
        }}
    )
    updated = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    updated["paid_amount"] = round(paid, 2)
    updated["returned_amount"] = round(returned, 2)
    updated["balance"] = new_balance
    return updated
