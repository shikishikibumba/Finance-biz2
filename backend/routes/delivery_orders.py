"""Delivery Orders — track shipping slips with attached image scans.

Images are stored as base64 data URLs in MongoDB (no filesystem needed for
preview deployment). For local deployment at scale, consider moving to S3 /
Cloudinary — the storage field is a string either way.
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import uuid
from database import db, get_next_sequence
from auth import get_current_user

router = APIRouter(prefix="/api/delivery-orders", tags=["delivery_orders"])


class DeliveryOrderCreate(BaseModel):
    customer_name: Optional[str] = ""
    customer_id: Optional[str] = ""
    supplier_name: Optional[str] = ""
    supplier_id: Optional[str] = ""
    invoice_number: Optional[str] = ""
    invoice_id: Optional[str] = ""
    order_date: Optional[str] = ""     # YYYY-MM-DD
    shipped_date: Optional[str] = ""   # YYYY-MM-DD
    notes: Optional[str] = ""
    image_data_url: Optional[str] = ""  # base64 "data:image/...;base64,..."


class DeliveryOrderUpdate(BaseModel):
    customer_name: Optional[str] = None
    customer_id: Optional[str] = None
    supplier_name: Optional[str] = None
    supplier_id: Optional[str] = None
    invoice_number: Optional[str] = None
    invoice_id: Optional[str] = None
    order_date: Optional[str] = None
    shipped_date: Optional[str] = None
    notes: Optional[str] = None
    image_data_url: Optional[str] = None


@router.get("")
async def list_delivery_orders(
    search: Optional[str] = None,
    customer_id: Optional[str] = None,
    supplier_id: Optional[str] = None,
    user=Depends(get_current_user),
):
    query = {}
    conditions = []
    if search:
        conditions.append({"$or": [
            {"delivery_number": {"$regex": search, "$options": "i"}},
            {"customer_name": {"$regex": search, "$options": "i"}},
            {"supplier_name": {"$regex": search, "$options": "i"}},
            {"invoice_number": {"$regex": search, "$options": "i"}},
        ]})
    if customer_id:
        conditions.append({"customer_id": customer_id})
    if supplier_id:
        conditions.append({"supplier_id": supplier_id})
    if conditions:
        query = {"$and": conditions} if len(conditions) > 1 else conditions[0]

    docs = await db.delivery_orders.find(query, {"_id": 0}).sort("created_at", -1).to_list(5000)
    return docs


@router.get("/{do_id}")
async def get_delivery_order(do_id: str, user=Depends(get_current_user)):
    doc = await db.delivery_orders.find_one({"id": do_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Delivery order not found")
    return doc


@router.post("")
async def create_delivery_order(data: DeliveryOrderCreate, user=Depends(get_current_user)):
    seq = await get_next_sequence("delivery_orders")
    now_iso = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        "delivery_number": f"DO-{seq:04d}",
        "customer_id": data.customer_id or "",
        "customer_name": data.customer_name or "",
        "supplier_id": data.supplier_id or "",
        "supplier_name": data.supplier_name or "",
        "invoice_id": data.invoice_id or "",
        "invoice_number": data.invoice_number or "",
        "order_date": data.order_date or "",
        "shipped_date": data.shipped_date or "",
        "notes": data.notes or "",
        "image_data_url": data.image_data_url or "",
        "created_at": now_iso,
        "created_by": user.get("email", ""),
    }
    await db.delivery_orders.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put("/{do_id}")
async def update_delivery_order(do_id: str, data: DeliveryOrderUpdate, user=Depends(get_current_user)):
    update = {k: v for k, v in data.model_dump().items() if v is not None}
    if not update:
        raise HTTPException(status_code=400, detail="No fields to update")
    result = await db.delivery_orders.update_one({"id": do_id}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Delivery order not found")
    return await db.delivery_orders.find_one({"id": do_id}, {"_id": 0})


@router.delete("/{do_id}")
async def delete_delivery_order(do_id: str, user=Depends(get_current_user)):
    result = await db.delivery_orders.delete_one({"id": do_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Delivery order not found")
    return {"message": "Delivery order deleted"}
