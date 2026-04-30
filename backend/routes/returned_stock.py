from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
import uuid
from database import db
from auth import get_current_user

router = APIRouter(prefix="/api/returned-stock", tags=["returned_stock"])


class ReturnedStockManual(BaseModel):
    product_id: str
    product_name: str
    quantity: float
    cost_price: float
    unit_price: Optional[float] = 0
    notes: Optional[str] = ""
    created_at: Optional[str] = None   # backdated


@router.get("")
async def list_returned_stock(
    product_id: Optional[str] = None,
    available_only: bool = False,
    user=Depends(get_current_user)
):
    query = {}
    if product_id:
        query["product_id"] = product_id
    stocks = await db.returned_stock.find(query, {"_id": 0}).sort("created_at", 1).to_list(5000)

    for s in stocks:
        avail = float(s.get("quantity_available", 0)) - float(s.get("quantity_used", 0))
        s["remaining"] = round(avail, 4)

    if available_only:
        stocks = [s for s in stocks if s["remaining"] > 0]
    return stocks


@router.get("/by-product")
async def grouped_by_product(available_only: bool = True, user=Depends(get_current_user)):
    """Returns one row per product with total available stock and entries list."""
    stocks = await db.returned_stock.find({}, {"_id": 0}).sort("created_at", 1).to_list(5000)
    grouped = {}
    for s in stocks:
        pid = s["product_id"]
        remaining = float(s.get("quantity_available", 0)) - float(s.get("quantity_used", 0))
        s["remaining"] = round(remaining, 4)
        if available_only and remaining <= 0:
            continue
        g = grouped.setdefault(pid, {
            "product_id": pid,
            "product_name": s["product_name"],
            "total_remaining": 0,
            "entries": []
        })
        g["total_remaining"] = round(g["total_remaining"] + remaining, 4)
        g["entries"].append(s)
    return list(grouped.values())


@router.post("")
async def create_manual_returned_stock(data: ReturnedStockManual, user=Depends(get_current_user)):
    """Manual entry for historical/opening returned stock."""
    doc = {
        "id": str(uuid.uuid4()),
        "product_id": data.product_id,
        "product_name": data.product_name,
        "quantity_available": float(data.quantity),
        "quantity_used": 0.0,
        "cost_price": float(data.cost_price),
        "unit_price": float(data.unit_price or 0),
        "source": "manual_opening",
        "return_id": "",
        "invoice_id": "",
        "customer_id": "",
        "customer_name": "",
        "notes": data.notes or "",
        "created_at": data.created_at or datetime.now(timezone.utc).isoformat(),
    }
    await db.returned_stock.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.delete("/{stock_id}")
async def delete_returned_stock(stock_id: str, user=Depends(get_current_user)):
    s = await db.returned_stock.find_one({"id": stock_id}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Returned stock not found")
    if float(s.get("quantity_used", 0)) > 0:
        raise HTTPException(status_code=400, detail="Stock already used in an order — cannot delete")
    if s.get("source") == "customer_return":
        raise HTTPException(status_code=400, detail="This stock came from a customer return — delete the return instead")
    await db.returned_stock.delete_one({"id": stock_id})
    return {"message": "Returned stock deleted"}
