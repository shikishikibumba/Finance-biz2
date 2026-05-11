# Mini Accounting (Commercial Trading / Finance-biz1) — PRD

## Original Problem Statement
Continue Mini Accounting system from GitHub branch `conflict_010526_0312`.

- **Phase 7** (Apr 30): dropdown scroll, supplier credit notes (no purchase-value mutation),
  supplier outstanding report, multi-cheque/multi-allocation historical payments, payment
  view/print, customer-outstanding credit-note annexure, customer & supplier ledger, Resend OTP.
- **Phase 8** (May 2): customer-outstanding returns column fix, supplier-ledger print rendering,
  remove Emergent watermark, "Commerical" → "Commercial".
- **Phase 9** (May 2): supplier-payable vs supplier-outstanding consistency (canonical formula);
  centralized `_credit_total` helper.
- **Phase 10** (May 11): backdated returns, returned-stock as a source in historical invoices,
  opening-balance date, ledger debit/credit presentation fix.

## Architecture
- React 19 + Tailwind + shadcn/ui front-end
- FastAPI + Motor (MongoDB) back-end
- Cookie-based auth (HttpOnly access + refresh tokens)
- Resend for transactional email (with safe inline-OTP fallback)

## What's been implemented

### Phase 10 (May 11, 2026)
- **Backdated returns**: `ReturnsPage` exposes a "Return Date" field; backend was already
  capable, only the form payload was missing the value.
- **Returned stock in historical invoices**: `InvoiceItemInput` now accepts `source`
  (`supplier` | `returned_stock`) and `returned_stock_id`. The migration page invoice
  form has a per-line Stock Source toggle: when a line uses returned stock the cost is
  taken from the stock entry, the stock's `quantity_used` is reserved, and the
  auto-created linked purchase EXCLUDES that line. Supplier and supplier-invoice-number
  are now required only when at least one line is supplier-sourced.
- **Opening balance date**: customers and suppliers gain `opening_balance_date`.
  Customer & Supplier ledger endpoints echo it back and treat it as `effective_from` —
  transactions dated before that date are filtered out (they're assumed to be embedded
  in the opening figure). Migration page > Opening Balance now includes a date picker.
- **Ledger debit/credit presentation**: the Opening row no longer collapses into a
  colspan that pushed the balance into the Credit column. Customer = Debit (receivable),
  Supplier = Credit (payable). Print output mirrors the on-screen layout.

### Phase 7–9 (carried forward)
- Supplier credit notes preserve original purchase value
- Phase 9 canonical payable formula reconciled across `suppliers`, `supplier-payable`,
  and `supplier-outstanding`
- Centralized `routes/_helpers.py` (`credit_total`, `sum_credit_totals`, `enrich_purchase`)
- Watermark removal via global `@media print` + dedicated print window
- Resend with inline-OTP fallback

## Tests
- `pytest /app/backend/tests/test_phase7.py test_phase8_9.py test_phase10.py`
  → **48/48 pass**
  - Phase 7: 18 tests
  - Phase 8/9: 15 tests
  - Phase 10: 15 tests (backdated returns, returned-stock invoice, validation, opening-date
    filtering for both customer & supplier ledgers, regression)

## Acceptance Criteria — STATUS
- [x] Backdated returns supported (UI + backend)
- [x] Historical invoices can source items from returned stock
- [x] Opening balance dates stored & enforced in ledger
- [x] Customer ledger: outstanding on debit, payments on credit
- [x] Supplier ledger: purchases on credit, payments on debit
- [x] Outstanding totals remain mathematically correct (regression passes)

## Backlog / Future
- (P1) Verify domain at https://resend.com/domains and update SENDER_EMAIL so OTPs reach
  real customers/suppliers.
- (P2) Preserve `source` and `returned_stock_id` on `update_invoice` (currently lost on edit).
- (P2) Atomic rollback for returned-stock reservation if invoice insert fails mid-write.
- (P2) Split `routes/reports.py` (~700 lines) into a `routes/reports/` package.
- (P3) Email statements directly from the outstanding screen.
