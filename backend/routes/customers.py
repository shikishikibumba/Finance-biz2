from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import uuid
from database import db
from auth import get_current_user

router = APIRouter(prefix="/api/customers", tags=["customers"])


class CustomerCreate(BaseModel):
    name: str
    phone: Optional[str] = ""
    shop_name: Optional[str] = ""
    address: Optional[str] = ""
    opening_balance: Optional[float] = 0


class CustomerUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    shop_name: Optional[str] = None
    address: Optional[str] = None
    opening_balance: Optional[float] = None


@router.get("")
async def list_customers(search: Optional[str] = None, user=Depends(get_current_user)):
    query = {}
    if search:
        query = {"$or": [
            {"name": {"$regex": search, "$options": "i"}},
            {"phone": {"$regex": search, "$options": "i"}},
            {"shop_name": {"$regex": search, "$options": "i"}}
        ]}
    customers = await db.customers.find(query, {"_id": 0}).sort("name", 1).to_list(1000)

    # Batch outstanding calculation
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

    for c in customers:
        opening = float(c.get("opening_balance", 0))
        c["outstanding"] = round(opening + inv_map.get(c["id"], 0) - pay_map.get(c["id"], 0) - ret_map.get(c["id"], 0), 2)

    return customers


@router.get("/{customer_id}")
async def get_customer(customer_id: str, user=Depends(get_current_user)):
    customer = await db.customers.find_one({"id": customer_id}, {"_id": 0})
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    inv_pipeline = [
        {"$match": {"customer_id": customer_id}},
        {"$group": {"_id": None, "total": {"$sum": "$total_amount"}}}
    ]
    inv_result = await db.invoices.aggregate(inv_pipeline).to_list(1)
    total_invoiced = inv_result[0]["total"] if inv_result else 0

    pay_pipeline = [
        {"$match": {"entity_id": customer_id, "payment_type": "customer"}},
        {"$group": {"_id": None, "total": {"$sum": "$amount"}}}
    ]
    pay_result = await db.payments.aggregate(pay_pipeline).to_list(1)
    total_paid = pay_result[0]["total"] if pay_result else 0

    ret_pipeline = [
        {"$match": {"customer_id": customer_id}},
        {"$unwind": "$items"},
        {"$group": {"_id": None, "total": {"$sum": "$items.amount"}}}
    ]
    ret_result = await db.returns.aggregate(ret_pipeline).to_list(1)
    total_returned = ret_result[0]["total"] if ret_result else 0

    opening = float(customer.get("opening_balance", 0))
    customer["outstanding"] = round(opening + total_invoiced - total_paid - total_returned, 2)
    customer["total_returned"] = round(total_returned, 2)
    customer["opening_balance"] = round(opening, 2)
    customer["invoices"] = await db.invoices.find({"customer_id": customer_id}, {"_id": 0}).sort("created_at", -1).to_list(50)
    customer["payments"] = await db.payments.find({"entity_id": customer_id, "payment_type": "customer"}, {"_id": 0}).sort("created_at", -1).to_list(50)
    customer["orders"] = await db.orders.find({"customer_id": customer_id}, {"_id": 0}).sort("created_at", -1).to_list(50)

    # Analytics
    invoices = customer["invoices"]
    monthly = {}
    product_counts = {}
    for inv in invoices:
        m = inv["created_at"][:7]
        monthly[m] = monthly.get(m, 0) + inv["total_amount"]
        for item in inv.get("items", []):
            pid = item.get("product_name", "Unknown")
            product_counts[pid] = product_counts.get(pid, 0) + item.get("quantity", 0)

    customer["monthly_avg_sales"] = round(sum(monthly.values()) / max(len(monthly), 1), 2)
    customer["highest_invoice"] = max(invoices, key=lambda x: x["total_amount"]) if invoices else None
    customer["most_purchased_product"] = max(product_counts.items(), key=lambda x: x[1])[0] if product_counts else None

    payments = customer["payments"]
    customer["last_payment"] = payments[0] if payments else None

    return customer


@router.post("")
async def create_customer(data: CustomerCreate, user=Depends(get_current_user)):
    doc = {
        "id": str(uuid.uuid4()),
        "name": data.name,
        "phone": data.phone or "",
        "shop_name": data.shop_name or "",
        "address": data.address or "",
        "opening_balance": float(data.opening_balance or 0),
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.customers.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put("/{customer_id}")
async def update_customer(customer_id: str, data: CustomerUpdate, user=Depends(get_current_user)):
    update = {k: v for k, v in data.model_dump().items() if v is not None}
    if not update:
        raise HTTPException(status_code=400, detail="No fields to update")
    await db.customers.update_one({"id": customer_id}, {"$set": update})
    customer = await db.customers.find_one({"id": customer_id}, {"_id": 0})
    return customer


@router.delete("/{customer_id}")
async def delete_customer(customer_id: str, user=Depends(get_current_user)):
    result = await db.customers.delete_one({"id": customer_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Customer not found")
    return {"message": "Customer deleted"}
