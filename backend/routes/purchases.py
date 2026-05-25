from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import uuid
from database import db, get_next_sequence
from auth import get_current_user
from routes._helpers import credit_total as _credit_total, enrich_purchase as _enrich_purchase

router = APIRouter(prefix="/api/purchases", tags=["purchases"])


class PurchaseItemInput(BaseModel):
    product_id: str
    product_name: str
    quantity: float
    cost_price: float


class PurchaseCreate(BaseModel):
    supplier_id: str
    supplier_name: str
    supplier_invoice_number: Optional[str] = ""
    order_id: Optional[str] = None
    order_number: Optional[str] = ""
    items: List[PurchaseItemInput]
    notes: Optional[str] = ""
    purchase_number: Optional[str] = None   # manual override for historical data
    created_at: Optional[str] = None         # backdated


class PurchaseItemUpdate(BaseModel):
    product_id: str
    product_name: str
    quantity: float
    cost_price: float


class PurchaseUpdate(BaseModel):
    supplier_id: Optional[str] = None
    supplier_name: Optional[str] = None
    supplier_invoice_number: Optional[str] = None
    notes: Optional[str] = None
    created_at: Optional[str] = None
    items: Optional[List[PurchaseItemUpdate]] = None


async def _resolve_purchase_number(manual: Optional[str]) -> str:
    if manual:
        manual = manual.strip() or None
    if manual:
        existing = await db.purchases.find_one({"purchase_number": manual}, {"_id": 0, "id": 1})
        if existing:
            raise HTTPException(status_code=400, detail=f"Purchase number '{manual}' already exists")
        return manual
    seq = await get_next_sequence("purchases")
    return f"PUR-{seq:04d}"


@router.get("")
async def list_purchases(search: Optional[str] = None, supplier_id: Optional[str] = None, user=Depends(get_current_user)):
    query = {}
    conditions = []
    if search:
        conditions.append({"$or": [
            {"purchase_number": {"$regex": search, "$options": "i"}},
            {"supplier_name": {"$regex": search, "$options": "i"}},
            {"supplier_invoice_number": {"$regex": search, "$options": "i"}},
            {"order_number": {"$regex": search, "$options": "i"}}
        ]})
    if supplier_id:
        conditions.append({"supplier_id": supplier_id})
    if conditions:
        query = {"$and": conditions} if len(conditions) > 1 else conditions[0]

    purchases = await db.purchases.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return [_enrich_purchase(p) for p in purchases]


@router.get("/{purchase_id}")
async def get_purchase(purchase_id: str, user=Depends(get_current_user)):
    purchase = await db.purchases.find_one({"id": purchase_id}, {"_id": 0})
    if not purchase:
        raise HTTPException(status_code=404, detail="Purchase not found")
    # Pull associated supplier credit notes (returns with destination=supplier
    # linked to this purchase) for the detail panel.
    returns = await db.returns.find(
        {"$or": [
            {"adjusted_purchase_id": purchase_id, "destination": "supplier"},
            {"purchase_id": purchase_id, "destination": "supplier"}
        ]},
        {"_id": 0}
    ).sort("created_at", -1).to_list(200)
    purchase["supplier_credit_notes"] = returns
    return _enrich_purchase(purchase)


@router.post("")
async def create_purchase(data: PurchaseCreate, user=Depends(get_current_user)):
    purchase_number = await _resolve_purchase_number(data.purchase_number)

    items = []
    total = 0
    for item in data.items:
        item_doc = {
            "id": str(uuid.uuid4()),
            "product_id": item.product_id,
            "product_name": item.product_name,
            "quantity": item.quantity,
            "cost_price": item.cost_price,
            "amount": round(item.quantity * item.cost_price, 2)
        }
        total += item_doc["amount"]
        items.append(item_doc)

    doc = {
        "id": str(uuid.uuid4()),
        "purchase_number": purchase_number,
        "supplier_id": data.supplier_id,
        "supplier_name": data.supplier_name,
        "supplier_invoice_number": data.supplier_invoice_number or "",
        "order_id": data.order_id or "",
        "order_number": data.order_number or "",
        "items": items,
        "total_amount": round(total, 2),
        "auto_generated": False,
        "manual_number": bool(data.purchase_number),
        "notes": data.notes or "",
        "created_at": data.created_at or datetime.now(timezone.utc).isoformat()
    }
    await db.purchases.insert_one(doc)
    doc.pop("_id", None)

    # If linked to order, advance item statuses to "ordered" where matching
    if data.order_id:
        order = await db.orders.find_one({"id": data.order_id}, {"_id": 0})
        if order:
            product_ids = [i.product_id for i in data.items]
            updated = False
            for oi in order["items"]:
                if oi["product_id"] in product_ids and oi.get("supplier_id") == data.supplier_id:
                    if oi["status"] == "pending":
                        oi["status"] = "ordered"
                        updated = True
            if updated:
                statuses = [i["status"] for i in order["items"]]
                overall = "delivered" if all(s == "delivered" for s in statuses) else "pending" if all(s == "pending" for s in statuses) else "ordered"
                await db.orders.update_one({"id": data.order_id}, {"$set": {"items": order["items"], "status": overall}})

    return doc


@router.put("/{purchase_id}")
async def update_purchase(purchase_id: str, data: PurchaseUpdate, user=Depends(get_current_user)):
    purchase = await db.purchases.find_one({"id": purchase_id}, {"_id": 0})
    if not purchase:
        raise HTTPException(status_code=404, detail="Purchase not found")

    update = {}
    if data.supplier_id is not None:
        update["supplier_id"] = data.supplier_id
    if data.supplier_name is not None:
        update["supplier_name"] = data.supplier_name
    if data.supplier_invoice_number is not None:
        update["supplier_invoice_number"] = data.supplier_invoice_number
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
                "cost_price": it.cost_price,
                "amount": round(it.quantity * it.cost_price, 2),
            }
            total += doc_item["amount"]
            items.append(doc_item)
        update["items"] = items
        update["total_amount"] = round(total, 2)

    if not update:
        raise HTTPException(status_code=400, detail="No fields to update")
    await db.purchases.update_one({"id": purchase_id}, {"$set": update})
    return await db.purchases.find_one({"id": purchase_id}, {"_id": 0})


@router.delete("/{purchase_id}")
async def delete_purchase(purchase_id: str, user=Depends(get_current_user)):
    result = await db.purchases.delete_one({"id": purchase_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Purchase not found")
    return {"message": "Purchase deleted"}
