from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
import uuid
from database import db
from auth import get_current_user

router = APIRouter(prefix="/api/products", tags=["products"])


class ProductCreate(BaseModel):
    name: str
    unit: Optional[str] = "pcs"
    selling_price: float = 0
    cost_price: Optional[float] = 0


class ProductUpdate(BaseModel):
    name: Optional[str] = None
    unit: Optional[str] = None
    selling_price: Optional[float] = None
    cost_price: Optional[float] = None


@router.get("")
async def list_products(search: Optional[str] = None, user=Depends(get_current_user)):
    query = {}
    if search:
        query = {"name": {"$regex": search, "$options": "i"}}

    products = await db.products.find(query, {"_id": 0}).sort("name", 1).to_list(1000)
    return products


@router.get("/{product_id}")
async def get_product(product_id: str, user=Depends(get_current_user)):
    product = await db.products.find_one({"id": product_id}, {"_id": 0})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return product


@router.post("")
async def create_product(data: ProductCreate, user=Depends(get_current_user)):
    doc = {
        "id": str(uuid.uuid4()),
        "name": data.name,
        "unit": data.unit or "pcs",
        "selling_price": data.selling_price,
        "cost_price": data.cost_price or 0,
        "price_history": [{
            "selling_price": data.selling_price,
            "cost_price": data.cost_price or 0,
            "date": datetime.now(timezone.utc).isoformat()
        }],
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.products.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put("/{product_id}")
async def update_product(product_id: str, data: ProductUpdate, user=Depends(get_current_user)):
    update = {k: v for k, v in data.model_dump().items() if v is not None}
    if not update:
        raise HTTPException(status_code=400, detail="No fields to update")

    # Track price changes
    if "selling_price" in update or "cost_price" in update:
        product = await db.products.find_one({"id": product_id}, {"_id": 0})
        if product:
            history_entry = {
                "selling_price": update.get("selling_price", product.get("selling_price", 0)),
                "cost_price": update.get("cost_price", product.get("cost_price", 0)),
                "date": datetime.now(timezone.utc).isoformat()
            }
            await db.products.update_one(
                {"id": product_id},
                {"$push": {"price_history": history_entry}}
            )

    await db.products.update_one({"id": product_id}, {"$set": update})
    product = await db.products.find_one({"id": product_id}, {"_id": 0})
    return product


@router.delete("/{product_id}")
async def delete_product(product_id: str, user=Depends(get_current_user)):
    result = await db.products.delete_one({"id": product_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Product not found")
    return {"message": "Product deleted"}
