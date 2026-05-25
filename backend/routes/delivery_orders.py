"""Delivery Orders — track shipping slips with attached image scans.

Strategy:
- Small (< 700 KB) base64 images stay inline in Firestore as `image_data_url`
  (saves a Storage round-trip and is fine for low-volume usage).
- Larger payloads are uploaded to Firebase Storage and the document keeps
  only `image_url` (publicly-readable Storage URL). The frontend can use
  either field in <img src>.
- Firestore has a 1 MB per-field hard limit, so > ~700 KB MUST go to Storage.
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
import uuid
import logging
from database import db, get_next_sequence
from auth import get_current_user
from storage_service import upload_data_url, delete_url

router = APIRouter(prefix="/api/delivery-orders", tags=["delivery_orders"])
logger = logging.getLogger(__name__)

# Firestore hard limit per field = 1_048_487 bytes. Keep margin for JSON
# overhead and reserve room for the rest of the document.
_INLINE_MAX_BYTES = 700_000


class DeliveryOrderCreate(BaseModel):
    customer_name: Optional[str] = ""
    customer_id: Optional[str] = ""
    supplier_name: Optional[str] = ""
    supplier_id: Optional[str] = ""
    invoice_number: Optional[str] = ""
    invoice_id: Optional[str] = ""
    order_date: Optional[str] = ""
    shipped_date: Optional[str] = ""
    notes: Optional[str] = ""
    image_data_url: Optional[str] = ""


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


async def _resolve_image_field(image_data_url: Optional[str]) -> tuple[str, str]:
    """Return (image_url, image_data_url) — one of them will be filled.

    Small images stay inline; large ones go to Firebase Storage.
    """
    if not image_data_url:
        return "", ""
    if image_data_url.startswith("http://") or image_data_url.startswith("https://"):
        # Already a URL (e.g. a previous upload) — keep as is.
        return image_data_url, ""
    if len(image_data_url) <= _INLINE_MAX_BYTES:
        return "", image_data_url
    url = await upload_data_url(image_data_url, folder="delivery-orders")
    return url, ""


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
    image_url, image_data_url = await _resolve_image_field(data.image_data_url)
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
        "image_url": image_url,
        "image_data_url": image_data_url,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": user.get("email", ""),
    }
    await db.delivery_orders.insert_one(doc)
    return doc


@router.put("/{do_id}")
async def update_delivery_order(do_id: str, data: DeliveryOrderUpdate, user=Depends(get_current_user)):
    existing = await db.delivery_orders.find_one({"id": do_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Delivery order not found")

    update = {k: v for k, v in data.model_dump().items() if v is not None}
    if not update:
        raise HTTPException(status_code=400, detail="No fields to update")

    if "image_data_url" in update:
        new_url, new_inline = await _resolve_image_field(update.pop("image_data_url"))
        # Clean up old Storage object if we're replacing it.
        if existing.get("image_url") and existing["image_url"] != new_url:
            await delete_url(existing["image_url"])
        update["image_url"] = new_url
        update["image_data_url"] = new_inline

    await db.delivery_orders.update_one({"id": do_id}, {"$set": update})
    return await db.delivery_orders.find_one({"id": do_id}, {"_id": 0})


@router.delete("/{do_id}")
async def delete_delivery_order(do_id: str, user=Depends(get_current_user)):
    existing = await db.delivery_orders.find_one({"id": do_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Delivery order not found")
    if existing.get("image_url"):
        await delete_url(existing["image_url"])
    await db.delivery_orders.delete_one({"id": do_id})
    return {"message": "Delivery order deleted"}
