from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import uuid
from database import db, get_next_sequence
from auth import get_current_user

router = APIRouter(prefix="/api/orders", tags=["orders"])


class OrderItemInput(BaseModel):
    product_id: str
    product_name: str
    quantity: float
    unit_price: float
    supplier_id: Optional[str] = None
    supplier_name: Optional[str] = ""
    supplier_invoice_number: Optional[str] = ""
    # Stock source — "supplier" (default, auto-creates payable) or "returned_stock"
    source: Optional[str] = "supplier"
    returned_stock_id: Optional[str] = ""


class OrderCreate(BaseModel):
    customer_id: str
    customer_name: str
    items: List[OrderItemInput]
    notes: Optional[str] = ""


class OrderUpdate(BaseModel):
    customer_id: Optional[str] = None
    customer_name: Optional[str] = None
    items: Optional[List[OrderItemInput]] = None
    notes: Optional[str] = None


class AssignSupplierInput(BaseModel):
    item_id: str
    supplier_id: str
    supplier_name: str
    supplier_invoice_number: Optional[str] = ""


class UpdateStatusInput(BaseModel):
    status: str
    item_ids: Optional[List[str]] = None


async def _release_returned_stock_for_order(order_id: str):
    """Release any returned_stock reserved by the given order (on delete/edit)."""
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        return
    for item in order.get("items", []):
        if item.get("source") == "returned_stock" and item.get("returned_stock_id"):
            await db.returned_stock.update_one(
                {"id": item["returned_stock_id"]},
                {"$inc": {"quantity_used": -float(item["quantity"])}}
            )


async def _reserve_returned_stock(returned_stock_id: str, quantity: float) -> dict:
    """Reserve stock from returned_stock. Returns the stock doc or raises."""
    stock = await db.returned_stock.find_one({"id": returned_stock_id}, {"_id": 0})
    if not stock:
        raise HTTPException(status_code=404, detail=f"Returned stock {returned_stock_id} not found")
    available = float(stock.get("quantity_available", 0)) - float(stock.get("quantity_used", 0))
    if quantity > available + 0.0001:
        raise HTTPException(
            status_code=400,
            detail=f"Only {available} of '{stock.get('product_name')}' available in returned stock"
        )
    await db.returned_stock.update_one(
        {"id": returned_stock_id},
        {"$inc": {"quantity_used": float(quantity)}}
    )
    return stock


async def sync_order_purchases(order_id: str):
    """Auto-create purchase records for SUPPLIER-sourced items only. Returned-stock items are NOT payables."""
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        return

    # Remove old auto-generated purchases for this order
    await db.purchases.delete_many({"order_id": order_id, "auto_generated": True})

    # Group SUPPLIER items by supplier
    supplier_items = {}
    for item in order["items"]:
        if item.get("source", "supplier") != "supplier":
            continue  # returned_stock → no payable
        sid = item.get("supplier_id")
        if sid:
            key = (sid, item.get("supplier_invoice_number", ""))
            if key not in supplier_items:
                supplier_items[key] = {"supplier_name": item.get("supplier_name", ""), "items": []}
            supplier_items[key]["items"].append(item)

    for (supplier_id, supplier_inv_no), data in supplier_items.items():
        items = []
        total = 0
        for oi in data["items"]:
            cost_price = oi.get("cost_price")
            if cost_price is None:
                product = await db.products.find_one({"id": oi["product_id"]}, {"_id": 0})
                cost_price = product.get("cost_price", 0) if product else 0
            amount = oi["quantity"] * cost_price
            items.append({
                "id": str(uuid.uuid4()),
                "product_id": oi["product_id"],
                "product_name": oi["product_name"],
                "quantity": oi["quantity"],
                "cost_price": cost_price,
                "amount": amount
            })
            total += amount

        seq = await get_next_sequence("purchases")
        doc = {
            "id": str(uuid.uuid4()),
            "purchase_number": f"PUR-{seq:04d}",
            "supplier_id": supplier_id,
            "supplier_name": data["supplier_name"],
            "supplier_invoice_number": supplier_inv_no or "",
            "order_id": order_id,
            "order_number": order["order_number"],
            "items": items,
            "total_amount": total,
            "auto_generated": True,
            "notes": f"Auto from {order['order_number']}",
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        await db.purchases.insert_one(doc)


async def _build_items(item_inputs: List[OrderItemInput]) -> tuple:
    """Build item docs; reserve returned_stock as needed. Returns (items, total).
    Pre-validates ALL items (and sums by stock id) before reserving, so a later
    failure cannot leave stock half-reserved."""
    # Phase 1 — validate without mutation. Aggregate requested qty per stock id so a
    # single order using the same stock twice doesn't over-consume.
    stock_requests: dict = {}
    for item in item_inputs:
        source = item.source or "supplier"
        if source == "returned_stock":
            if not item.returned_stock_id:
                raise HTTPException(status_code=400, detail="returned_stock_id required for returned_stock source")
            stock_requests[item.returned_stock_id] = stock_requests.get(item.returned_stock_id, 0) + float(item.quantity)
    stock_docs: dict = {}
    for sid, qty in stock_requests.items():
        stock = await db.returned_stock.find_one({"id": sid}, {"_id": 0})
        if not stock:
            raise HTTPException(status_code=404, detail=f"Returned stock {sid} not found")
        available = float(stock.get("quantity_available", 0)) - float(stock.get("quantity_used", 0))
        if qty > available + 0.0001:
            raise HTTPException(
                status_code=400,
                detail=f"Only {available} of '{stock.get('product_name')}' available in returned stock"
            )
        stock_docs[sid] = stock

    # Phase 2 — reserve and build (only after all validations passed)
    for sid, qty in stock_requests.items():
        await db.returned_stock.update_one({"id": sid}, {"$inc": {"quantity_used": qty}})

    items = []
    total = 0
    for item in item_inputs:
        source = item.source or "supplier"
        cost_price = 0
        if source == "returned_stock":
            cost_price = float(stock_docs[item.returned_stock_id].get("cost_price", 0))
        else:
            product = await db.products.find_one({"id": item.product_id}, {"_id": 0, "cost_price": 1})
            cost_price = product.get("cost_price", 0) if product else 0

        item_doc = {
            "id": str(uuid.uuid4()),
            "product_id": item.product_id,
            "product_name": item.product_name,
            "quantity": item.quantity,
            "unit_price": item.unit_price,
            "cost_price": cost_price,
            "amount": round(item.quantity * item.unit_price, 2),
            "supplier_id": item.supplier_id or "",
            "supplier_name": item.supplier_name or "",
            "supplier_invoice_number": item.supplier_invoice_number or "",
            "source": source,
            "returned_stock_id": item.returned_stock_id or "",
            "status": "pending"
        }
        total += item_doc["amount"]
        items.append(item_doc)
    return items, total


@router.get("")
async def list_orders(search: Optional[str] = None, status: Optional[str] = None, user=Depends(get_current_user)):
    query = {}
    conditions = []
    if search:
        conditions.append({"$or": [
            {"order_number": {"$regex": search, "$options": "i"}},
            {"customer_name": {"$regex": search, "$options": "i"}}
        ]})
    if status:
        conditions.append({"status": status})
    if conditions:
        query = {"$and": conditions} if len(conditions) > 1 else conditions[0]
    orders = await db.orders.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)

    # Annotate with invoice existence (order is read-only if invoice exists)
    invoiced = await db.invoices.aggregate([
        {"$match": {"order_id": {"$ne": ""}}},
        {"$group": {"_id": "$order_id"}}
    ]).to_list(10000)
    invoiced_set = {i["_id"] for i in invoiced}
    for o in orders:
        o["has_invoice"] = o["id"] in invoiced_set
    return orders


@router.get("/{order_id}")
async def get_order(order_id: str, user=Depends(get_current_user)):
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    total_profit = 0
    total_cost = 0
    for item in order["items"]:
        # Prefer snapshotted cost_price (already accounts for returned_stock cost)
        cost_price = item.get("cost_price")
        if cost_price is None:
            product = await db.products.find_one({"id": item["product_id"]}, {"_id": 0})
            cost_price = product.get("cost_price", 0) if product else 0
            item["cost_price"] = cost_price
        item["profit"] = round((item["unit_price"] - cost_price) * item["quantity"], 2)
        total_profit += item["profit"]
        total_cost += cost_price * item["quantity"]

    order["total_profit"] = round(total_profit, 2)
    order["total_cost"] = round(total_cost, 2)
    order["purchases"] = await db.purchases.find({"order_id": order_id}, {"_id": 0}).to_list(100)
    order["invoices"] = await db.invoices.find({"order_id": order_id}, {"_id": 0}).to_list(100)
    order["has_invoice"] = len(order["invoices"]) > 0
    return order


@router.post("")
async def create_order(data: OrderCreate, user=Depends(get_current_user)):
    seq = await get_next_sequence("orders")
    order_number = f"ORD-{seq:04d}"

    items, total = await _build_items(data.items)

    doc = {
        "id": str(uuid.uuid4()),
        "order_number": order_number,
        "customer_id": data.customer_id,
        "customer_name": data.customer_name,
        "items": items,
        "total_amount": round(total, 2),
        "status": "pending",
        "notes": data.notes or "",
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.orders.insert_one(doc)
    doc.pop("_id", None)

    await sync_order_purchases(doc["id"])
    return doc


@router.put("/{order_id}")
async def update_order(order_id: str, data: OrderUpdate, user=Depends(get_current_user)):
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    # Lock order if invoice exists
    existing_invoice = await db.invoices.find_one({"order_id": order_id}, {"_id": 0})
    if existing_invoice:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot edit order {order['order_number']} — invoice {existing_invoice['invoice_number']} already generated. Delete the invoice first."
        )

    update_doc = {}
    if data.customer_id is not None:
        update_doc["customer_id"] = data.customer_id
    if data.customer_name is not None:
        update_doc["customer_name"] = data.customer_name
    if data.notes is not None:
        update_doc["notes"] = data.notes

    if data.items is not None:
        # Release previously reserved returned_stock (we will re-reserve based on new items)
        await _release_returned_stock_for_order(order_id)
        items, total = await _build_items(data.items)
        update_doc["items"] = items
        update_doc["total_amount"] = round(total, 2)
        # Reset status based on items
        update_doc["status"] = "pending"

    update_doc["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.orders.update_one({"id": order_id}, {"$set": update_doc})

    # Re-sync purchases for this order
    if data.items is not None:
        await sync_order_purchases(order_id)

    updated = await db.orders.find_one({"id": order_id}, {"_id": 0})
    return updated


@router.put("/{order_id}/assign-supplier")
async def assign_supplier(order_id: str, data: AssignSupplierInput, user=Depends(get_current_user)):
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    # Block if already invoiced
    existing_invoice = await db.invoices.find_one({"order_id": order_id}, {"_id": 0})
    if existing_invoice:
        raise HTTPException(status_code=400, detail="Order is locked (invoice generated)")

    updated = False
    for item in order["items"]:
        if item["id"] == data.item_id:
            item["supplier_id"] = data.supplier_id
            item["supplier_name"] = data.supplier_name
            if data.supplier_invoice_number is not None:
                item["supplier_invoice_number"] = data.supplier_invoice_number
            updated = True
            break

    if not updated:
        raise HTTPException(status_code=404, detail="Item not found")

    await db.orders.update_one({"id": order_id}, {"$set": {"items": order["items"]}})
    await sync_order_purchases(order_id)

    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    return order


@router.put("/{order_id}/status")
async def update_order_status(order_id: str, data: UpdateStatusInput, user=Depends(get_current_user)):
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    if data.item_ids:
        for item in order["items"]:
            if item["id"] in data.item_ids:
                item["status"] = data.status
    else:
        for item in order["items"]:
            item["status"] = data.status

    statuses = [i["status"] for i in order["items"]]
    if all(s == "delivered" for s in statuses):
        overall = "delivered"
    elif all(s == "pending" for s in statuses):
        overall = "pending"
    else:
        overall = "ordered"

    await db.orders.update_one(
        {"id": order_id},
        {"$set": {"items": order["items"], "status": overall}}
    )
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    return order


@router.delete("/{order_id}")
async def delete_order(order_id: str, user=Depends(get_current_user)):
    # Block if invoice exists
    existing_invoice = await db.invoices.find_one({"order_id": order_id}, {"_id": 0})
    if existing_invoice:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete order — invoice {existing_invoice['invoice_number']} exists. Delete the invoice first."
        )
    # Release any reserved returned_stock
    await _release_returned_stock_for_order(order_id)
    # Remove auto-generated purchases
    await db.purchases.delete_many({"order_id": order_id, "auto_generated": True})
    result = await db.orders.delete_one({"id": order_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Order not found")
    return {"message": "Order deleted"}
