from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import uuid
from database import db, get_next_sequence
from auth import get_current_user

router = APIRouter(prefix="/api/returns", tags=["returns"])


class ReturnItemInput(BaseModel):
    product_id: str
    product_name: str
    quantity: float
    unit_price: float         # price at which it was sold (for credit amount)
    cost_price: float         # original cost from order/invoice — critical for correct profit when reused
    reason: Optional[str] = ""


class ReturnCreate(BaseModel):
    invoice_id: str
    items: List[ReturnItemInput]
    notes: Optional[str] = ""
    created_at: Optional[str] = None  # backdated returns
    # Phase 7: where does the stock go?
    # - "warehouse": add to returned_stock pool (default)
    # - "supplier":  create a Supplier Credit Note linked to a purchase.
    #                We DO NOT modify the purchase's total_amount. Net payable
    #                is computed = total_amount - sum(credit_notes).
    destination: Optional[str] = "warehouse"
    supplier_id: Optional[str] = ""
    supplier_name: Optional[str] = ""
    purchase_id: Optional[str] = ""   # specific purchase to link (optional)


async def _add_to_returned_stock(return_id: str, invoice_id: str, customer_id: str, customer_name: str,
                                 item: dict, return_date: str):
    """Create a returned_stock entry (separate per return to preserve cost lineage)."""
    doc = {
        "id": str(uuid.uuid4()),
        "product_id": item["product_id"],
        "product_name": item["product_name"],
        "quantity_available": float(item["quantity"]),
        "quantity_used": 0.0,
        "cost_price": float(item["cost_price"]),
        "unit_price": float(item.get("unit_price", 0)),
        "source": "customer_return",
        "return_id": return_id,
        "invoice_id": invoice_id,
        "customer_id": customer_id,
        "customer_name": customer_name,
        "created_at": return_date,
    }
    await db.returned_stock.insert_one(doc)


@router.get("")
async def list_returns(invoice_id: Optional[str] = None, customer_id: Optional[str] = None,
                       supplier_id: Optional[str] = None, destination: Optional[str] = None,
                       user=Depends(get_current_user)):
    query = {}
    if invoice_id:
        query["invoice_id"] = invoice_id
    if customer_id:
        query["customer_id"] = customer_id
    if supplier_id:
        query["supplier_id"] = supplier_id
    if destination:
        query["destination"] = destination
    returns = await db.returns.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return returns


@router.get("/{return_id}")
async def get_return(return_id: str, user=Depends(get_current_user)):
    ret = await db.returns.find_one({"id": return_id}, {"_id": 0})
    if not ret:
        raise HTTPException(status_code=404, detail="Return not found")
    return ret


@router.post("")
async def create_return(data: ReturnCreate, user=Depends(get_current_user)):
    invoice = await db.invoices.find_one({"id": data.invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    # Validate return quantities don't exceed invoice quantities (minus prior returns)
    inv_qty = {}
    for item in invoice.get("items", []):
        inv_qty[item["product_id"]] = inv_qty.get(item["product_id"], 0) + float(item["quantity"])

    prior_returns = await db.returns.find({"invoice_id": data.invoice_id}, {"_id": 0}).to_list(1000)
    prior_qty = {}
    for r in prior_returns:
        for ri in r.get("items", []):
            prior_qty[ri["product_id"]] = prior_qty.get(ri["product_id"], 0) + float(ri["quantity"])

    for item in data.items:
        available = inv_qty.get(item.product_id, 0) - prior_qty.get(item.product_id, 0)
        if item.quantity > available + 0.0001:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot return {item.quantity} of '{item.product_name}' — only {available} available on this invoice"
            )

    seq = await get_next_sequence("returns")
    return_number = f"RET-{seq:04d}"
    return_id = str(uuid.uuid4())
    created_at = data.created_at or datetime.now(timezone.utc).isoformat()

    items = []
    total = 0
    for it in data.items:
        amount = round(it.quantity * it.unit_price, 2)
        item_doc = {
            "id": str(uuid.uuid4()),
            "product_id": it.product_id,
            "product_name": it.product_name,
            "quantity": it.quantity,
            "unit_price": it.unit_price,
            "cost_price": it.cost_price,
            "amount": amount,
            "reason": it.reason or "",
        }
        items.append(item_doc)
        total += amount

    destination = data.destination or "warehouse"
    cn_kind = "supplier" if destination == "supplier" else "customer"

    doc = {
        "id": return_id,
        "return_number": return_number,
        "credit_note_number": f"{'SCN' if cn_kind == 'supplier' else 'CN'}-{seq:04d}",
        "credit_note_kind": cn_kind,   # "customer" | "supplier"
        "invoice_id": data.invoice_id,
        "invoice_number": invoice.get("invoice_number", ""),
        "customer_id": invoice.get("customer_id", ""),
        "customer_name": invoice.get("customer_name", ""),
        "items": items,
        "total_amount": round(total, 2),
        "destination": destination,
        "supplier_id": data.supplier_id or "",
        "supplier_name": data.supplier_name or "",
        "purchase_id": data.purchase_id or "",
        "purchase_number": "",
        "notes": data.notes or "",
        "created_at": created_at,
    }

    if destination == "supplier":
        # ── SUPPLIER CREDIT NOTE ───────────────────────────────────────────
        # We DO NOT modify the original purchase value. Instead we build a
        # supplier credit note and record a *reference-only* adjustment array
        # on the purchase. Net payable is computed as total_amount - credits.
        target_purchase = None
        if data.purchase_id:
            target_purchase = await db.purchases.find_one({"id": data.purchase_id}, {"_id": 0})
        elif invoice.get("linked_purchase_id"):
            target_purchase = await db.purchases.find_one({"id": invoice["linked_purchase_id"]}, {"_id": 0})
        elif data.supplier_id:
            target_purchase = await db.purchases.find_one(
                {"supplier_id": data.supplier_id},
                {"_id": 0},
                sort=[("created_at", -1)],
            )

        if target_purchase:
            # Cost-side credit (what we get back from the supplier)
            credit_total = 0.0
            cn_lines = []
            for it in items:
                cost = float(it.get("cost_price", 0)) or 0
                amt = round(float(it["quantity"]) * cost, 2)
                credit_total += amt
                cn_lines.append({
                    "id": str(uuid.uuid4()),
                    "return_id": return_id,
                    "credit_note_number": doc["credit_note_number"],
                    "product_id": it["product_id"],
                    "product_name": it["product_name"],
                    "quantity": float(it["quantity"]),
                    "cost_price": cost,
                    "amount": amt,
                    "adjusted_at": created_at,
                })

            existing = list(target_purchase.get("supplier_return_adjustments", []))
            existing.extend(cn_lines)
            # The original `total_amount` is preserved — DO NOT touch it.
            await db.purchases.update_one(
                {"id": target_purchase["id"]},
                {"$set": {"supplier_return_adjustments": existing}}
            )

            # Cross-reference the purchase on the return doc
            doc["adjusted_purchase_id"] = target_purchase["id"]
            doc["adjusted_purchase_number"] = target_purchase.get("purchase_number")
            doc["purchase_id"] = target_purchase["id"]
            doc["purchase_number"] = target_purchase.get("purchase_number", "")
            doc["adjusted_amount"] = round(credit_total, 2)

        # Insert AFTER linking to purchase so the doc is complete.
        await db.returns.insert_one(doc)
    else:
        # ── CUSTOMER CREDIT NOTE ───────────────────────────────────────────
        # Default behaviour: add returned stock to the warehouse pool so it
        # can be sold again. The credit reduces customer outstanding (handled
        # in customer aggregations).
        await db.returns.insert_one(doc)
        for it in items:
            await _add_to_returned_stock(
                return_id, data.invoice_id,
                invoice.get("customer_id", ""), invoice.get("customer_name", ""),
                it, created_at
            )

    doc.pop("_id", None)
    return doc


@router.delete("/{return_id}")
async def delete_return(return_id: str, user=Depends(get_current_user)):
    ret = await db.returns.find_one({"id": return_id}, {"_id": 0})
    if not ret:
        raise HTTPException(status_code=404, detail="Return not found")

    if ret.get("destination") == "supplier":
        # Reverse supplier credit-note linkage (no total_amount changes,
        # since we never modified it).
        pur_id = ret.get("adjusted_purchase_id") or ret.get("purchase_id")
        if pur_id:
            purchase = await db.purchases.find_one({"id": pur_id}, {"_id": 0})
            if purchase:
                kept = [a for a in purchase.get("supplier_return_adjustments", [])
                        if a.get("return_id") != return_id]
                await db.purchases.update_one(
                    {"id": pur_id},
                    {"$set": {"supplier_return_adjustments": kept}}
                )
        await db.returns.delete_one({"id": return_id})
        return {"message": "Supplier credit note reversed"}

    # Warehouse return — preserve integrity check
    stocks = await db.returned_stock.find({"return_id": return_id}, {"_id": 0}).to_list(100)
    for s in stocks:
        if float(s.get("quantity_used", 0)) > 0:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot delete return — some returned stock already used in a new order (product: {s['product_name']})"
            )
    await db.returned_stock.delete_many({"return_id": return_id})
    await db.returns.delete_one({"id": return_id})
    return {"message": "Return deleted and stock reversed"}
