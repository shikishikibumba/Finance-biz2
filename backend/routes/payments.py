from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import uuid
from database import db
from auth import get_current_user

router = APIRouter(prefix="/api/payments", tags=["payments"])


class PaymentAllocation(BaseModel):
    reference_id: str
    reference_type: str  # "invoice" or "purchase"
    amount: float


class ChequeDetail(BaseModel):
    amount: float
    bank_name: Optional[str] = ""
    cheque_number: str
    cheque_date: Optional[str] = ""


class PaymentCreate(BaseModel):
    payment_type: str  # "customer" or "supplier"
    entity_id: str
    entity_name: str
    amount: float
    payment_method: str  # cash, bank, cheque, transfer
    cheque_number: Optional[str] = ""
    bank_name: Optional[str] = ""
    cheque_date: Optional[str] = ""
    cheques: Optional[List[ChequeDetail]] = []
    allocations: Optional[List[PaymentAllocation]] = []
    notes: Optional[str] = ""
    created_at: Optional[str] = None   # optional backdated entry


class PaymentUpdate(BaseModel):
    amount: Optional[float] = None
    payment_method: Optional[str] = None
    cheque_number: Optional[str] = None
    bank_name: Optional[str] = None
    cheque_date: Optional[str] = None
    cheques: Optional[List[ChequeDetail]] = None
    allocations: Optional[List[PaymentAllocation]] = None
    notes: Optional[str] = None


async def recalc_invoice_status(invoice_id: str):
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        return
    pay_total = await db.payments.aggregate([
        {"$match": {"payment_type": "customer"}},
        {"$unwind": "$allocations"},
        {"$match": {"allocations.reference_id": invoice_id, "allocations.reference_type": "invoice"}},
        {"$group": {"_id": None, "total": {"$sum": "$allocations.amount"}}}
    ]).to_list(1)
    total_paid = pay_total[0]["total"] if pay_total else 0
    # Include returns (credit notes) and manual settlement in the status
    ret_total = await db.returns.aggregate([
        {"$match": {"invoice_id": invoice_id}},
        {"$unwind": "$items"},
        {"$group": {"_id": None, "total": {"$sum": "$items.amount"}}}
    ]).to_list(1)
    total_returned = ret_total[0]["total"] if ret_total else 0
    manual_settled = float(invoice.get("manual_settled_amount", 0) or 0)
    total_amount = float(invoice.get("total_amount", 0))
    covered = total_paid + total_returned + manual_settled
    if covered <= 0.01:
        new_status = "unpaid"
    elif covered >= total_amount - 0.01:
        new_status = "paid"
    else:
        new_status = "partial"
    await db.invoices.update_one({"id": invoice_id}, {"$set": {"status": new_status}})


def validate_cheques(method: str, amount: float, cheques: Optional[List[ChequeDetail]]):
    """If method=cheque and cheques provided, ensure sum matches amount."""
    if method != "cheque":
        return
    if not cheques:
        return  # legacy single-cheque flow (cheque_number etc.)
    total = round(sum(c.amount for c in cheques), 2)
    if total != round(amount, 2):
        raise HTTPException(
            status_code=400,
            detail=f"Cheque total ({total}) does not match payment amount ({amount})"
        )
    for c in cheques:
        if not c.cheque_number:
            raise HTTPException(status_code=400, detail="Every cheque must have a cheque number")
        if c.amount <= 0:
            raise HTTPException(status_code=400, detail="Cheque amount must be positive")


@router.get("")
async def list_payments(
    payment_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    search: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    user=Depends(get_current_user)
):
    query = {}
    conditions = []
    if payment_type:
        conditions.append({"payment_type": payment_type})
    if entity_id:
        conditions.append({"entity_id": entity_id})
    if search:
        conditions.append({"$or": [
            {"entity_name": {"$regex": search, "$options": "i"}},
            {"payment_method": {"$regex": search, "$options": "i"}},
            {"notes": {"$regex": search, "$options": "i"}}
        ]})
    if date_from:
        conditions.append({"created_at": {"$gte": date_from}})
    if date_to:
        # inclusive end of day
        conditions.append({"created_at": {"$lte": date_to + "T23:59:59"}})
    if conditions:
        query = {"$and": conditions} if len(conditions) > 1 else conditions[0]

    payments = await db.payments.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return payments


@router.get("/{payment_id}")
async def get_payment(payment_id: str, user=Depends(get_current_user)):
    payment = await db.payments.find_one({"id": payment_id}, {"_id": 0})
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    return payment


@router.post("")
async def create_payment(data: PaymentCreate, user=Depends(get_current_user)):
    validate_cheques(data.payment_method, data.amount, data.cheques)

    # Validate allocations don't exceed amount
    if data.allocations:
        alloc_total = round(sum(a.amount for a in data.allocations), 2)
        if alloc_total > round(data.amount, 2) + 0.01:
            raise HTTPException(
                status_code=400,
                detail=f"Allocation total ({alloc_total}) exceeds payment amount ({data.amount})"
            )

    doc = {
        "id": str(uuid.uuid4()),
        "payment_type": data.payment_type,
        "entity_id": data.entity_id,
        "entity_name": data.entity_name,
        "amount": data.amount,
        "payment_method": data.payment_method,
        "cheque_number": data.cheque_number or "",
        "bank_name": data.bank_name or "",
        "cheque_date": data.cheque_date or "",
        "cheques": [c.model_dump() for c in (data.cheques or [])],
        "allocations": [a.model_dump() for a in (data.allocations or [])],
        "notes": data.notes or "",
        "created_at": data.created_at or datetime.now(timezone.utc).isoformat()
    }
    await db.payments.insert_one(doc)
    doc.pop("_id", None)

    # Update invoice statuses
    if data.payment_type == "customer":
        for alloc in (data.allocations or []):
            if alloc.reference_type == "invoice":
                await recalc_invoice_status(alloc.reference_id)

    return doc


@router.put("/{payment_id}")
async def update_payment(payment_id: str, data: PaymentUpdate, user=Depends(get_current_user)):
    payment = await db.payments.find_one({"id": payment_id}, {"_id": 0})
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")

    old_invoice_ids = {
        a["reference_id"] for a in payment.get("allocations", [])
        if a.get("reference_type") == "invoice"
    }

    update_doc = {}
    new_amount = data.amount if data.amount is not None else payment["amount"]
    new_method = data.payment_method if data.payment_method is not None else payment["payment_method"]
    new_cheques = data.cheques if data.cheques is not None else [ChequeDetail(**c) for c in payment.get("cheques", [])]

    validate_cheques(new_method, new_amount, new_cheques)

    if data.allocations is not None:
        alloc_total = round(sum(a.amount for a in data.allocations), 2)
        if alloc_total > round(new_amount, 2) + 0.01:
            raise HTTPException(
                status_code=400,
                detail=f"Allocation total ({alloc_total}) exceeds payment amount ({new_amount})"
            )
        update_doc["allocations"] = [a.model_dump() for a in data.allocations]
    elif data.amount is not None:
        # Amount changed but allocations kept → ensure existing allocations still fit
        existing_alloc_total = round(sum(a.get("amount", 0) for a in payment.get("allocations", [])), 2)
        if existing_alloc_total > round(new_amount, 2) + 0.01:
            raise HTTPException(
                status_code=400,
                detail=f"Existing allocation total ({existing_alloc_total}) exceeds new payment amount ({new_amount}). Update allocations too."
            )

    if data.amount is not None:
        update_doc["amount"] = data.amount
    if data.payment_method is not None:
        update_doc["payment_method"] = data.payment_method
    if data.cheque_number is not None:
        update_doc["cheque_number"] = data.cheque_number
    if data.bank_name is not None:
        update_doc["bank_name"] = data.bank_name
    if data.cheque_date is not None:
        update_doc["cheque_date"] = data.cheque_date
    if data.cheques is not None:
        update_doc["cheques"] = [c.model_dump() for c in data.cheques]
    if data.notes is not None:
        update_doc["notes"] = data.notes
    update_doc["updated_at"] = datetime.now(timezone.utc).isoformat()

    await db.payments.update_one({"id": payment_id}, {"$set": update_doc})

    # Recalc invoice statuses: old and new allocations
    new_invoice_ids = set()
    if data.allocations is not None:
        for a in data.allocations:
            if a.reference_type == "invoice":
                new_invoice_ids.add(a.reference_id)
    else:
        new_invoice_ids = old_invoice_ids

    affected = old_invoice_ids | new_invoice_ids
    if payment.get("payment_type") == "customer":
        for inv_id in affected:
            await recalc_invoice_status(inv_id)

    updated = await db.payments.find_one({"id": payment_id}, {"_id": 0})
    return updated


@router.delete("/{payment_id}")
async def delete_payment(payment_id: str, user=Depends(get_current_user)):
    payment = await db.payments.find_one({"id": payment_id}, {"_id": 0})
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")

    await db.payments.delete_one({"id": payment_id})

    # Recalculate invoice statuses for affected allocations
    if payment.get("payment_type") == "customer":
        for alloc in payment.get("allocations", []):
            if alloc.get("reference_type") == "invoice":
                await recalc_invoice_status(alloc["reference_id"])

    return {"message": "Payment deleted"}
