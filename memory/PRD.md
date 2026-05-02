# Mini Accounting (Commercial Trading / Finance-biz1) — PRD

## Original Problem Statement
Continue Mini Accounting system from GitHub branch `conflict_010526_0312`.
Phase 7: dropdown scroll, supplier credit notes (NO purchase value mutation),
supplier outstanding report, multi-cheque/multi-allocation historical payments,
payment view/print, customer-outstanding credit-note annexure, customer ledger,
supplier ledger, Resend email for forgot-password OTP.

Phase 8: customer-outstanding returns column must be non-zero when credit notes
exist; supplier-ledger print must render the full table; remove "Made with
Emergent" watermark from print output; fix "Commerical" spelling to "Commercial"
everywhere.

Phase 9: enforce supplier-payable vs supplier-outstanding consistency (formula
uses entity-level supplier payments — canonical: `opening + purchases − credit
notes − all supplier payments`); centralize credit-note math into a shared
helper.

## Architecture
- React 19 + Tailwind + shadcn/ui front-end
- FastAPI + Motor (MongoDB) back-end
- Cookie-based auth (HttpOnly access + refresh tokens)
- Resend for transactional email (with safe inline-OTP fallback)

## What's been implemented

### Phase 7 (Apr 30, 2026)
- SearchableSelect scroll trap + keyboard nav
- Supplier Credit Note system — `returns.py` never mutates `purchases.total_amount`
- `/api/reports/supplier-outstanding/{id}` with per-purchase credit notes + annexure
- Historical payments support multi-cheque + multi-allocation (Migration page)
- Payment View + Print voucher dialog
- Customer-outstanding includes credit-note annexure pages
- Customer & Supplier ledger pages (date-range, running balance, printable)
- Resend integration with inline-OTP fallback

### Phase 8 + 9 (May 2, 2026)
- "Commerical" → "Commercial" across frontend/backend (sidebar, dashboard,
  login, invoices, email service, APP_NAME)
- Customer-outstanding: now shows `returned` correctly per invoice and still
  lists the invoice row even after full payment+return when returns > 0.
  Fallback match via `invoice_id` for legacy returns missing `customer_id`.
- Supplier ledger print now uses a dedicated print window (`/lib/printer.js
  printHtml`) with landscape orientation, repeating table headers, and no
  platform watermark. CSS also hides `[class*=emergent-badge]` / emergent
  anchors during any in-page print.
- `reports.supplier-outstanding.total_payable` = `opening + purchases −
  credit_notes − total_supplier_payments` (entity-level). Matches
  `supplier-payable` and `suppliers` list exactly. New field
  `unallocated_paid` exposes payments not yet assigned to a purchase.
- New `routes/_helpers.py` with `credit_total`, `sum_credit_totals`,
  `enrich_purchase`. Used by suppliers, purchases, reports.

## Tests
- `pytest /app/backend/tests/` → 33/33 pass
  - `test_phase7.py` — 18 tests (auth, supplier credit-note invariant,
    ledgers, outstanding, multi-cheque + multi-allocation validations)
  - `test_phase8_9.py` — 15 tests (customer-outstanding returns column,
    ledger credit-note reference, Phase 9.1 MANDATORY scenario ending at
    payable=250000 on all four surfaces, helper import checks, no typos)

## Acceptance Criteria — STATUS
- [x] Dropdown scroll fixed
- [x] Supplier credit notes visible in supplier profile + purchase detail
- [x] Original purchase value preserved (migration auto-restores legacy)
- [x] Supplier outstanding report (per-supplier, printable, consistent)
- [x] Multi-cheque + multi-allocation historical payments
- [x] Payment View + Print voucher
- [x] Credit notes in outstanding reports (annexure pages)
- [x] Customer ledger + Supplier ledger
- [x] **Phase 8** — Customer-outstanding returns column reflects CN value
- [x] **Phase 8** — Supplier ledger prints full table, no watermark
- [x] **Phase 8** — System name spelling corrected globally
- [x] **Phase 9** — Supplier payable = Supplier outstanding (250,000 on all
  surfaces in the final scenario)
- [x] **Phase 9** — Centralized `_credit_total` helper

## Backlog / Future (Next Action Items)
- (P1) Verify domain on resend.com/domains and update SENDER_EMAIL in
  `backend/.env` so OTPs reach real customers/suppliers.
- (P2) Split `reports.py` (692 lines) into a `routes/reports/` package.
- (P2) Rename `enrich_purchase` → `enrich_purchase_inplace` to signal
  mutation to callers.
- (P3) Email customer/supplier statements directly from the outstanding UI.
