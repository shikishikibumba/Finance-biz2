"""Shared financial helpers.

Single source of truth for credit-note math so that suppliers, purchases,
reports, and ledger calculations stay consistent.
"""
from typing import Iterable


def credit_total(purchase: dict) -> float:
    """Sum of all supplier-return adjustments recorded against a purchase.

    The adjustments are stored as a list of dicts on the purchase document
    (`supplier_return_adjustments`). Each entry has an `amount` (cost-side
    reduction). Returns 0.0 when the field is missing or empty.
    """
    adjustments = purchase.get("supplier_return_adjustments") or []
    return round(sum(float(a.get("amount", 0) or 0) for a in adjustments), 2)


def sum_credit_totals(purchases: Iterable[dict]) -> float:
    """Aggregate credit_total across a list of purchase docs."""
    return round(sum(credit_total(p) for p in purchases), 2)


def enrich_purchase(purchase: dict) -> dict:
    """Attach derived fields (original/credit/net) to a purchase doc IN-PLACE.

    Original `total_amount` is never mutated.
    """
    ct = credit_total(purchase)
    original = float(purchase.get("total_amount", 0) or 0)
    purchase["original_amount"] = round(original, 2)
    purchase["credit_notes_total"] = ct
    purchase["net_payable"] = round(original - ct, 2)
    purchase["credit_notes"] = purchase.get("supplier_return_adjustments", []) or []
    return purchase
