from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from database import db
from auth import get_current_user

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/summary")
async def get_dashboard_summary(user=Depends(get_current_user)):
    # Total receivables
    inv_total = await db.invoices.aggregate([
        {"$group": {"_id": None, "total": {"$sum": "$total_amount"}}}
    ]).to_list(1)
    total_invoiced = inv_total[0]["total"] if inv_total else 0

    cust_payments = await db.payments.aggregate([
        {"$match": {"payment_type": "customer"}},
        {"$group": {"_id": None, "total": {"$sum": "$amount"}}}
    ]).to_list(1)
    total_cust_paid = cust_payments[0]["total"] if cust_payments else 0
    receivables = total_invoiced - total_cust_paid

    # Total payables
    pur_total = await db.purchases.aggregate([
        {"$group": {"_id": None, "total": {"$sum": "$total_amount"}}}
    ]).to_list(1)
    total_purchased = pur_total[0]["total"] if pur_total else 0

    sup_payments = await db.payments.aggregate([
        {"$match": {"payment_type": "supplier"}},
        {"$group": {"_id": None, "total": {"$sum": "$amount"}}}
    ]).to_list(1)
    total_sup_paid = sup_payments[0]["total"] if sup_payments else 0
    payables = total_purchased - total_sup_paid

    # Daily sales
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    daily = await db.invoices.aggregate([
        {"$match": {"created_at": {"$regex": f"^{today}"}}},
        {"$group": {"_id": None, "total": {"$sum": "$total_amount"}}}
    ]).to_list(1)
    daily_sales = daily[0]["total"] if daily else 0

    # Monthly sales
    month = datetime.now(timezone.utc).strftime("%Y-%m")
    monthly = await db.invoices.aggregate([
        {"$match": {"created_at": {"$regex": f"^{month}"}}},
        {"$group": {"_id": None, "total": {"$sum": "$total_amount"}}}
    ]).to_list(1)
    monthly_sales = monthly[0]["total"] if monthly else 0

    # Total profit = (sales - returns revenue) - (cost of sold items - cost of returned items)
    # This ensures returned items are excluded from both revenue and cost.
    total_cost = 0
    all_invoices = await db.invoices.find({}, {"_id": 0, "items": 1}).to_list(10000)
    for inv in all_invoices:
        for item in inv.get("items", []):
            product = await db.products.find_one({"id": item.get("product_id")}, {"_id": 0, "cost_price": 1})
            if product:
                total_cost += (product.get("cost_price", 0) * item.get("quantity", 0))

    # Returns: subtract their revenue AND their (snapshotted) cost
    ret_agg = await db.returns.aggregate([
        {"$unwind": "$items"},
        {"$group": {"_id": None,
                    "revenue": {"$sum": "$items.amount"},
                    "cost": {"$sum": {"$multiply": ["$items.cost_price", "$items.quantity"]}}}}
    ]).to_list(1)
    ret_revenue = ret_agg[0]["revenue"] if ret_agg else 0
    ret_cost = ret_agg[0]["cost"] if ret_agg else 0

    total_profit = (total_invoiced - ret_revenue) - (total_cost - ret_cost)

    # Sales trend (last 30 days)
    thirty_days_ago = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    trend = await db.invoices.aggregate([
        {"$match": {"created_at": {"$gte": thirty_days_ago}}},
        {"$addFields": {"date": {"$substr": ["$created_at", 0, 10]}}},
        {"$group": {"_id": "$date", "total": {"$sum": "$total_amount"}}},
        {"$sort": {"_id": 1}}
    ]).to_list(100)
    sales_trend = [{"date": t["_id"], "amount": t["total"]} for t in trend]

    # Recent orders
    recent_orders = await db.orders.find({}, {"_id": 0}).sort("created_at", -1).to_list(10)

    # Counts
    customer_count = await db.customers.count_documents({})
    supplier_count = await db.suppliers.count_documents({})
    order_count = await db.orders.count_documents({})
    pending_orders = await db.orders.count_documents({"status": "pending"})

    return {
        "receivables": receivables,
        "payables": payables,
        "daily_sales": daily_sales,
        "monthly_sales": monthly_sales,
        "total_profit": round(total_profit, 2),
        "sales_trend": sales_trend,
        "recent_orders": recent_orders,
        "customer_count": customer_count,
        "supplier_count": supplier_count,
        "order_count": order_count,
        "pending_orders": pending_orders
    }
