from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from database import db
from auth import get_current_user

router = APIRouter(prefix="/api/settings", tags=["settings"])


class CounterUpdate(BaseModel):
    # The next counter value will be (value + 1). To have next invoice = INV-1051,
    # set value = 1050.
    value: int


VALID_COUNTERS = {"invoices", "purchases", "orders"}


@router.get("/counters")
async def get_counters(user=Depends(get_current_user)):
    counters = {}
    for name in VALID_COUNTERS:
        doc = await db.counters.find_one({"_id": name})
        counters[name] = doc["seq"] if doc else 0
    return counters


@router.put("/counters/{name}")
async def set_counter(name: str, data: CounterUpdate, user=Depends(get_current_user)):
    if name not in VALID_COUNTERS:
        raise HTTPException(status_code=400, detail=f"Unknown counter: {name}")
    if data.value < 0:
        raise HTTPException(status_code=400, detail="Counter value must be >= 0")

    # Ensure we don't accidentally create duplicates: no existing doc can have a
    # number greater than the new counter value.
    coll = getattr(db, name)  # e.g. db.invoices
    number_field = {
        "invoices": "invoice_number",
        "purchases": "purchase_number",
        "orders": "order_number",
    }[name]
    prefix = {"invoices": "INV-", "purchases": "PUR-", "orders": "ORD-"}[name]

    # Find the highest existing sequence from the actual collection
    max_existing = 0
    cursor = coll.find({number_field: {"$regex": f"^{prefix}"}}, {"_id": 0, number_field: 1})
    async for doc in cursor:
        try:
            num = int(doc[number_field].replace(prefix, ""))
            if num > max_existing:
                max_existing = num
        except (ValueError, KeyError):
            continue

    if data.value < max_existing:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot set counter below highest existing {name[:-1]} number ({max_existing})"
        )

    await db.counters.update_one(
        {"_id": name},
        {"$set": {"seq": data.value}},
        upsert=True
    )
    return {"name": name, "value": data.value, "next": data.value + 1}
