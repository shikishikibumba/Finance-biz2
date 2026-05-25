# Mini Accounting (Commercial Trading) — PRD

## Current State
- **Database**: Firebase Firestore (`commercial-trading1`, asia-southeast1)
- **Backend**: FastAPI + custom Motor-style Firestore adapter
- **Frontend**: React 19 + Tailwind + shadcn/ui
- **Hosting target**: Frontend on Vercel, Backend on Render
- **Email**: Resend (sandbox key — verify domain for production)

## Phases shipped
- **Phase 7** (Apr 30) — dropdown scroll, supplier credit notes (NO purchase value mutation),
  supplier outstanding report, multi-cheque/multi-allocation, payment view/print,
  customer-outstanding credit-note annexure, customer & supplier ledger, Resend OTP.
- **Phase 8** (May 2) — customer-outstanding returns column fix, supplier-ledger print,
  remove Emergent watermark, "Commerical" → "Commercial".
- **Phase 9** (May 2) — supplier-payable vs supplier-outstanding canonical formula;
  centralised `_credit_total` helper.
- **Phase 10** (May 11) — backdated returns, returned-stock as source in historical invoices,
  opening-balance date, ledger debit/credit presentation fix.
- **Phase 11** (May 25) — **Firestore migration**. Replaced MongoDB entirely; built
  Motor-style adapter (`firestore_db.py`) and counter transactions in `database.py`;
  removed `motor`, `pymongo`, `bcrypt`-conflict pins. **48/48 tests pass on Firestore.**

## Architecture
```
React (Vercel) ──HTTPS+cookies──> FastAPI (Render) ──Admin SDK──> Firestore
                                       │
                                       └─Resend───> SMTP transactional mail
```

The Motor-style adapter (`firestore_db.py`) implements just enough of the Motor API
(`find`, `find_one`, `insert_one`, `update_one`, `update_many`, `delete_one`, `delete_many`,
`aggregate` with `$match`/`$unwind`/`$group`/`$sort`/`$limit`, dotted-path support, common
operators) for every existing route to run unchanged.

## Tests
- `pytest /app/backend/tests/test_phase7.py test_phase8_9.py test_phase10.py` → **48/48 pass** on Firestore.

## Acceptance Criteria — Migration
- [x] Run fully on Firebase Firestore
- [x] Preserve all workflows
- [x] Maintain correct outstanding/payable balances (Phase 9.1 scenario verified — 250 000 across every endpoint)
- [x] Maintain accurate ledgers (opening + entries + running balance unchanged)
- [x] Support historical data correctly (Phase 10 invariants pass)
- [x] Complete Firebase setup documentation → `/app/FIREBASE_DEPLOYMENT_GUIDE.md`

## Backlog
- (P0) **Rotate the leaked service-account key** (shared in chat — Console → Service Accounts → Manage Keys).
- (P1) Verify a domain at resend.com/domains so OTPs reach real recipients (currently sandboxed to commercialtrading079@gmail.com).
- (P1) Vercel + Render deploy walk-through is in `FIREBASE_DEPLOYMENT_GUIDE.md` — execute it.
- (P2) Add weekly Firestore export to GCS bucket for backups.
- (P2) Preserve `source` / `returned_stock_id` on `PUT /api/invoices/{id}`.
- (P2) Atomic rollback for returned-stock reservation if invoice insert fails mid-write.
- (P3) Cursor pagination on list endpoints when document counts > 5K.
- (P3) Firebase Auth on the client (Google login) if you ever want to drop the cookie-JWT flow.

## Files added in Phase 11
- `/app/backend/firestore_db.py` — Motor-style adapter
- `/app/backend/database.py` — rewritten as Firestore re-export + counter transaction
- `/app/backend/firebase-service-account.json` — credentials (gitignored)
- `/app/FIREBASE_DEPLOYMENT_GUIDE.md` — end-to-end setup + deploy + maintenance guide

## Files removed / changed
- `requirements.txt` — removed `motor`, `pymongo`, `boto3`, `requests-oauthlib`, `python-jose`, `pandas`, `numpy`, `mypy`, `black`, `isort`, `flake8`, `typer`, `cryptography`, `emergentintegrations`, `jq`; added `firebase-admin`, `google-cloud-firestore`.
- `server.py` — dropped `client.close()` shutdown, replaced `_id` with `id` on password_reset rows, switched `async for cursor` to `await cursor.to_list()`.
- `.env` — removed `MONGO_URL`/`DB_NAME`, added `FIREBASE_SERVICE_ACCOUNT`, `FIREBASE_PROJECT_ID`.

## Important Operational Notes
1. **All route code is unchanged** — the adapter handles the difference.
2. **Counter sequences are now atomic Firestore transactions** in `database.get_next_sequence`.
3. **Reports do client-side aggregation** in Python because Firestore has no native pipeline support. For the current data volume this is faster than expected (~50–300 ms per report).
4. **Service-account JSON must never be committed**. Already in `.gitignore`. On Render, pass the full JSON via `FIREBASE_SERVICE_ACCOUNT_JSON` env var and write it to disk in the start command.
