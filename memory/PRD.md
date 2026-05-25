# Commercial Trading — PRD & Project Memory

## Original Problem Statement
Repo: https://github.com/shikishikibumba/Finance-biz2.git
User requested: "Go through this repo and study about it. The system is built on Firebase. I will be using this account for further development."

Follow-up: "Need to Deploy it through Vercel + Render."

## What This App Is
A **Commercial Trading mini-accounting backend** with end-to-end accounting integrity:
- Customers, Suppliers, Products
- Orders, Purchases, Invoices, Payments, Returns, Delivery Orders, Returned Stock
- Customer & Supplier Ledgers, Outstanding reports, Analytics, Dashboard
- Counter-sequenced invoice / purchase numbers via Firestore transactions
- Multi-allocation + multi-cheque payments
- Backdated returns + historical invoices using returned stock
- Phase 7/8/9/10 accounting tests — **48/48 passing on Firestore**

## Tech Stack
- **Backend**: FastAPI (Python 3.11) — runs on Render
- **Database**: Firebase Firestore (`commercial-trading1` project)
- **Database adapter**: `firestore_db.py` — custom Motor-style async shim over the Firestore Admin SDK (so the routes still read like MongoDB)
- **Auth**: Cookie-based JWT (httponly), bcrypt password hashing, OTP forgot-password via Resend
- **Frontend**: React 19 + CRA + Tailwind + shadcn/ui — runs on Vercel
- **Emails**: Resend (forgot-password OTP)

## Active Branch
- `v3_25052026` — most recent feature branch (14 commits ahead of `main`)
- `main` is empty starter boilerplate — do NOT deploy from main

## Architecture Tasks Done
- ✅ Loaded `v3_25052026` into `/app`
- ✅ Installed `firebase-admin`, `google-cloud-firestore`, `resend`, `bcrypt`, `pyjwt`
- ✅ Saved Firebase service-account JSON to `/app/backend/firebase-service-account.json`
- ✅ Created `/app/backend/.env` (FIREBASE_*, JWT_SECRET, ADMIN_*, COOKIE_*)
- ✅ Made cookie flags env-driven (`COOKIE_SECURE`, `COOKIE_SAMESITE`) so the same code runs locally (lax/false) AND in cross-origin production (none/true)
- ✅ Backend boots, seeds admin, creates indexes (no-op on Firestore), login + /api/health verified
- ✅ Frontend loads — Commercial Trading login page renders correctly
- ✅ Created deployment helper files:
  - `/app/backend/Procfile` (Render-compatible start command)
  - `/app/backend/runtime.txt` (Python 3.11.9)
  - `/app/frontend/vercel.json` (SPA rewrite rule)
  - `/app/render.yaml` (Infrastructure-as-Code for Render Blueprint)

## What's Implemented (already in repo on v3_25052026)
- Auth (login, register, /me, logout, forgot/reset-password)
- 13 route modules: customers, suppliers, products, orders, purchases, invoices, payments, dashboard, reports, analytics, settings, returns, returned_stock, delivery_orders
- 18 React pages including Dashboard, Customers, Suppliers, Products, Invoices, Purchases, Orders, Payments, Returns, Delivery Orders, Reports, Analytics, Ledger, Settings, Customer/Supplier profile pages, Migration page

## Prioritized Backlog
### P0 — Deployment (current task)
- [ ] User creates Render Web Service (paste env vars from `.env`, set `FIREBASE_SERVICE_ACCOUNT_JSON` as full JSON, `JWT_SECRET` as a strong random string, `COOKIE_SECURE=true`, `COOKIE_SAMESITE=none`)
- [ ] User creates Vercel Project (root = `frontend`, env var `REACT_APP_BACKEND_URL` = Render URL)
- [ ] User updates `CORS_ORIGINS` on Render to the Vercel URL
- [ ] **Rotate Firebase service-account key** (current one was shared in chat — compromised)

### P1
- [ ] Resend integration for forgot-password OTP (skipped per user request — fallback returns OTP in response)
- [ ] Domain pin: custom domain on Vercel + Render

### P2
- [ ] Firebase Storage for delivery-slip uploads (backend hook in `storage_service.py` already initialised)
- [ ] Scheduled Firestore backups via Cloud Scheduler
- [ ] Pagination (limit + start_after) on list endpoints when collections grow > 5K docs

## Local Test Credentials
See `/app/memory/test_credentials.md`.
