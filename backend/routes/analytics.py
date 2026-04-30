from fastapi import APIRouter, Depends
from typing import Optional
from datetime import datetime, timezone, timedelta
from database import db
from auth import get_current_user

router = APIRouter(prefix="/api/analytics", tags=["analytics"])

PERIOD_DAYS = {"30d": 30, "60d": 60, "90d": 90, "1y": 365, "all": 3650}


def _build_match(period: str, date_from: Optional[str], date_to: Optional[str]):
    """Build a $match clause based on either preset period or a custom range.
    `date_from` / `date_to` are YYYY-MM-DD strings (inclusive).
    Custom range takes precedence when provided."""
    if date_from or date_to:
        clause = {}
        if date_from:
            clause["$gte"] = f"{date_from}T00:00:00"
        if date_to:
            clause["$lte"] = f"{date_to}T23:59:59"
        return {"created_at": clause}
    if period == "all":
        return {}
    d = PERIOD_DAYS.get(period, 30)
    start = (datetime.now(timezone.utc) - timedelta(days=d)).isoformat()
    return {"created_at": {"$gte": start}}


@router.get("/sales")
async def sales_analytics(
    period: str = "30d",
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    user=Depends(get_current_user),
):
    match = _build_match(period, date_from, date_to)
    result = await db.invoices.aggregate([
        {"$match": match},
        {"$addFields": {"date": {"$substr": ["$created_at", 0, 10]}}},
        {"$group": {"_id": "$date", "total": {"$sum": "$total_amount"}, "count": {"$sum": 1}}},
        {"$sort": {"_id": 1}}
    ]).to_list(3650)
    total = sum(r["total"] for r in result)
    return {
        "data": [{"date": r["_id"], "amount": r["total"], "count": r["count"]} for r in result],
        "total": round(total, 2),
        "period": period,
        "date_from": date_from,
        "date_to": date_to,
    }


@router.get("/purchases")
async def purchase_analytics(
    period: str = "30d",
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    user=Depends(get_current_user),
):
    match = _build_match(period, date_from, date_to)
    result = await db.purchases.aggregate([
        {"$match": match},
        {"$addFields": {"date": {"$substr": ["$created_at", 0, 10]}}},
        {"$group": {"_id": "$date", "total": {"$sum": "$total_amount"}, "count": {"$sum": 1}}},
        {"$sort": {"_id": 1}}
    ]).to_list(3650)
    total = sum(r["total"] for r in result)
    return {
        "data": [{"date": r["_id"], "amount": r["total"], "count": r["count"]} for r in result],
        "total": round(total, 2),
        "period": period,
        "date_from": date_from,
        "date_to": date_to,
    }


@router.get("/profit")
async def profit_analytics(
    period: str = "30d",
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    user=Depends(get_current_user),
):
    match = _build_match(period, date_from, date_to)
    sales = await db.invoices.aggregate([
        {"$match": match},
        {"$addFields": {"date": {"$substr": ["$created_at", 0, 10]}}},
        {"$group": {"_id": "$date", "sales": {"$sum": "$total_amount"}}},
        {"$sort": {"_id": 1}}
    ]).to_list(3650)
    purchases = await db.purchases.aggregate([
        {"$match": match},
        {"$addFields": {"date": {"$substr": ["$created_at", 0, 10]}}},
        {"$group": {"_id": "$date", "cost": {"$sum": "$total_amount"}}},
        {"$sort": {"_id": 1}}
    ]).to_list(3650)
    pur_map = {p["_id"]: p["cost"] for p in purchases}
    data = []
    total_profit = 0
    for s in sales:
        cost = pur_map.get(s["_id"], 0)
        profit = s["sales"] - cost
        total_profit += profit
        data.append({"date": s["_id"], "sales": s["sales"], "cost": cost, "profit": round(profit, 2)})
    return {
        "data": data,
        "total_profit": round(total_profit, 2),
        "period": period,
        "date_from": date_from,
        "date_to": date_to,
    }
