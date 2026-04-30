# Mini Accounting (Finance-biz1) — PRD

## Original Problem Statement
Continue Mini Accounting system from GitHub branch `conflict_010526_0312`.
Phase 7 fixes:
1. Product dropdown scroll fix
2. Supplier returns must NOT modify original purchase value — instead create
   supplier credit notes linked to purchases (net payable computed)
3. Supplier outstanding report (per supplier with credit notes annexure)
4. Historical customer payment with multi-invoice + multi-cheque
5. Historical supplier payment with multi-allocation + multi-cheque
6. Payment view + print dialog
7. Customer outstanding report MUST include credit notes annexure
8. Customer ledger system
9. Supplier ledger system

Email integration: Resend for forgot-password OTPs.

## Architecture
- React 19 + Tailwind + shadcn/ui front-end
- FastAPI + Motor (MongoDB) back-end
- Cookie-based auth (HttpOnly access + refresh tokens)
- Resend for transactional email (with safe inline-OTP fallback)

## What's been implemented (Phase 7 — Apr 30, 2026)
1. **SearchableSelect**: dropdown traps wheel events so the page no longer
   scrolls while browsing options; max-h-72 + overscroll-contain. Keyboard
   nav inherited from cmdk.
2. **Supplier Credit Note system (CRITICAL)**: `routes/returns.py` no longer
   mutates `purchases.total_amount`. Returns with `destination=supplier`
   create a Supplier Credit Note (`SCN-####`) and append a line to
   `purchase.supplier_return_adjustments`. Net payable is computed as
   `total_amount − sum(adjustments)`. Startup migration restores any
   purchases that had been previously reduced by older code.
3. **Supplier Outstanding Report**: new `/api/reports/supplier-outstanding/{id}`
   returns per-purchase original/credit/paid/balance plus a credit-note
   annexure. Reports page exposes a new tab "Supplier Outstanding" with
   printable A4 layout including annexure pages.
4. **Historical Customer & Supplier payments**: Migration page now supports
   multi-cheque entries and multi-invoice/purchase allocations (same logic
   as the live Payments page).
5. **Payment View + Print**: PaymentsPage adds an Eye action that opens a
   dialog with cheque breakdown + allocations; Print button generates a
   clean A5 voucher (lib/print.js → printPaymentVoucher).
6. **Customer Outstanding annexure**: report endpoint returns a
   `credit_notes` annexure list and the printable HTML now contains one
   annexure page per credit note (page-break-before:always).
7. **Customer & Supplier Ledger pages**: existing `/ledger/:type/:id`
   endpoint reused. Backend ledger excludes supplier-bound returns from
   customer view; supplier view includes purchases (credit), credit notes
   (debit reduces payable), payments (debit). Print-friendly view with
   running balance.
8. **Resend integration**: emails sent via `email_service.py`. Sandbox key
   restriction handled — when Resend rejects a non-verified recipient, the
   backend falls back to inline OTP so the reset flow always works.
9. **Cross-module consistency**: `destination=supplier` returns are filtered
   out of every customer-side aggregation (customers list/detail,
   customer-outstanding, global-outstanding, financial-summary,
   recalc_invoice_status) — supplier credit notes do NOT reduce customer
   invoice balances or affect customer outstanding.

## Tests
- Backend: 18/18 passed in `/app/backend/tests/test_phase7.py`
  (auth/login, forgot-pw with inline OTP, reset-pw, supplier listing &
  detail, purchases enrichment, supplier-credit-note critical invariant,
  supplier-bound return delete reversal, customer/supplier outstanding,
  supplier-payable, customer/supplier ledger, multi-cheque payment
  validation, multi-allocation validation).
- Frontend: smoke-tested via screenshot (login + dashboard + payments).

## Backlog / Future
- (P1) Resend domain verification & change SENDER_EMAIL to user's domain so
  emails reach customers/suppliers (not just the API-key owner).
- (P2) Refactor `routes/reports.py` (661 lines) into a `routes/reports/`
  package — customer/supplier/financial/payments modules.
- (P2) Extract shared `_credit_total` helper into `routes/_helpers.py`.
- (P2) Reconcile supplier-payable (entity-level paid total) vs
  supplier-outstanding (allocation-level paid) to match exactly when
  supplier payments are recorded without allocations.
- (P3) Email customer/supplier statements directly from the outstanding
  report screen.

## Acceptance Criteria — STATUS
- [x] Fix dropdown scroll
- [x] Show supplier credit notes clearly (Supplier Profile + Purchase detail)
- [x] Maintain original purchase values (preserved + migration restores)
- [x] Provide supplier outstanding report (per-supplier, printable)
- [x] Support advanced historical payments (multi-cheque + multi-allocation)
- [x] Show full payment breakdown (View dialog + Print voucher)
- [x] Include credit notes in reports (annexure pages)
- [x] Provide customer ledger (date-range, running balance, printable)
- [x] Provide supplier ledger (date-range, running balance, printable)
