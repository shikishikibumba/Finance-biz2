# Firebase Firestore — Setup & Deployment Guide

This document captures everything you need to run, deploy, and maintain the
**Commercial Trading** mini-accounting backend on Firebase Firestore.

The system is hosted as:

- **Database & Auth users store** → Firebase Firestore (`commercial-trading1`)
- **Backend API** → FastAPI on Render
- **Frontend** → React on Vercel
- **Emails** → Resend (forgot-password OTP)

---

## 1. Firebase Project Setup

1. Go to <https://console.firebase.google.com> → **Add project**.
2. Project name: `commercial-trading` (you used `commercial-trading1`).
3. **Disable** Google Analytics — keeps costs predictable.
4. **Build → Firestore Database → Create database**, choose **Production
   mode**, region **asia-southeast1 (Singapore)**.
5. **Build → Authentication → Get started → Sign-in method**, enable
   **Email/Password** (only needed if you ever switch to Firebase Auth on
   the client; the FastAPI backend currently stores users directly in
   Firestore using bcrypt).
6. **⚙️ Project settings → Service accounts** → **Generate new private
   key** → save the JSON.

> **Where the JSON lives in this repo**
> Locally: `/app/backend/firebase-service-account.json` (gitignored).
> On Render: paste the JSON into the env var `FIREBASE_SERVICE_ACCOUNT_JSON`
> at deploy time and the backend writes it to disk on boot — see deploy
> section below.

---

## 2. Recommended Firestore Security Rules

The backend uses the Admin SDK, which bypasses Firestore rules entirely.
Lock down all client-side access so the React app *must* go through
FastAPI:

```firestore
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

Paste this into **Firestore → Rules → Publish**.

Why deny all? Three reasons:

1. **All accounting integrity** (credit-note linkage, allocation totals,
   counter sequences) is enforced server-side. A direct client write
   could violate invariants.
2. **No financial data ever leaves the server unfiltered** — the React app
   only sees what FastAPI hands it.
3. **Audit trail stays consistent** — every mutation flows through a
   single funnel.

---

## 3. Environment Variables

### Backend (`/app/backend/.env` locally / Render env panel in production)

| Key | Purpose |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | Path to the JSON (local). |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Full JSON contents (Render — preferred). |
| `FIREBASE_PROJECT_ID` | `commercial-trading1` |
| `JWT_SECRET` | Random secret for cookie tokens. |
| `ADMIN_EMAIL` | `admin@example.com` (seeded on first boot). |
| `ADMIN_PASSWORD` | `admin123` (seeded on first boot). |
| `APP_NAME` | `Commercial Trading` |
| `CORS_ORIGINS` | Comma-separated list, e.g. `https://your-app.vercel.app` |
| `RESEND_API_KEY` | Your Resend key. |
| `SENDER_EMAIL` | `onboarding@resend.dev` (or a verified domain). |

### Frontend (`/app/frontend/.env` / Vercel env panel)

| Key | Purpose |
|---|---|
| `REACT_APP_BACKEND_URL` | Full Render URL, e.g. `https://commercial-trading-api.onrender.com` |

The frontend never receives Firebase credentials. That's intentional.

---

## 4. Local Development

```bash
# Backend
cd backend
pip install -r requirements.txt
# Make sure firebase-service-account.json is present (don't commit it)
uvicorn server:app --host 0.0.0.0 --port 8001 --reload

# Frontend (in a separate shell)
cd frontend
yarn install
yarn start
```

Both processes are managed by supervisor in the Emergent container — you
don't need to start them manually here. Just edit and the watcher reloads.

---

## 5. Deployment

### 5.1 Backend → Render

1. **New Web Service** → pick your GitHub repo → branch
   `conflict_010526_0312`.
2. **Root directory:** `backend`
3. **Build command:**
   ```
   pip install -r requirements.txt
   ```
4. **Pre-deploy / Start command:**
   ```
   python -c "import os,base64; open('firebase-service-account.json','w').write(os.environ['FIREBASE_SERVICE_ACCOUNT_JSON'])" && uvicorn server:app --host 0.0.0.0 --port $PORT
   ```
   This writes the service-account JSON from the env var to disk before
   the API starts, so the file never sits in your repo.
5. Add all backend env vars listed in section 3.
6. Deploy → copy the Render URL.

> Free tier sleeps after 15 min of inactivity. Upgrade to **Starter
> ($7/mo)** for always-on.

### 5.2 Frontend → Vercel

1. **Add New Project** → import the repo.
2. **Root directory:** `frontend`
3. **Framework:** Create React App (auto-detected).
4. Add env var `REACT_APP_BACKEND_URL` = your Render URL.
5. Deploy → copy the Vercel URL.

### 5.3 Wire the two

Back in Render, set `CORS_ORIGINS=https://your-frontend.vercel.app`
(no trailing slash). Save → Render will redeploy automatically.

Cookie auth across domains needs both Render and Vercel on HTTPS —
they already are. The backend sets `samesite="none", secure=True` on
the access/refresh cookies, and the frontend uses
`axios { withCredentials: true }`.

---

## 6. Firebase Storage (Optional — for delivery slip uploads)

You haven't enabled this yet. When you're ready:

1. Firebase Console → **Build → Storage → Get started → Production mode**.
2. Add rules denying all client access:
   ```
   service firebase.storage {
     match /b/{bucket}/o {
       match /{allPaths=**} {
         allow read, write: if false;
       }
     }
   }
   ```
3. Backend uploads via `firebase_admin.storage.bucket()`. Generate signed
   URLs valid for ~7 days for the frontend to display delivery-slip
   images.

I haven't built the upload endpoint yet — say the word when you need it.

---

## 7. Cost Optimisation

Firestore is billed per document read / write / delete. The current
implementation is already optimised:

| Pattern | Why |
|---|---|
| **Reports fetch each collection once and aggregate in Python**, instead of pulling per-purchase allocations. | Limits N+1 reads when generating ledgers and outstanding statements. |
| **Counter sequences use a single transaction**. | One read + one write per new invoice/purchase. |
| **Updates use `set(doc.id)` directly** (no merge by query). | Avoids scan-and-write. |

Free-tier limits:

- 50K reads/day, 20K writes/day, 20K deletes/day
- 1 GB stored data

Expected daily reads for a 1-user, ~10-invoice/day shop: **~3-5K**.
You'll likely never breach the free tier.

If you grow to 5K+ documents per collection, the next step is **client-
side cursor pagination** (`limit + start_after`) on list endpoints —
let me know and I'll add it.

---

## 8. Database Backup Strategy

Firestore does **not** include automatic backups on the free tier.
Three options, in order of effort:

1. **Manual export** (recommended for free tier)
   ```bash
   # one-off from your laptop
   gcloud firestore export gs://your-backup-bucket/$(date +%Y%m%d)
   ```
   Schedule via your laptop's cron, or run weekly by hand.

2. **Scheduled export via Cloud Scheduler** (paid — ~$0.10/mo)
   - Cloud Scheduler hits a Cloud Function once a week.
   - Cloud Function calls `firestore.export_documents`.
   - Files land in a GCS bucket with retention policy.

3. **App-level export** — add a `/api/admin/export` endpoint that streams
   every collection as JSON. Useful for off-Google-Cloud backups.
   Tell me when you want it.

To restore: `gcloud firestore import gs://your-backup-bucket/<date>`.

---

## 9. Architecture Notes

```
┌──────────────┐  HTTPS + cookies  ┌─────────────────────┐  Admin SDK  ┌───────────┐
│  React (CRA) │ ────────────────> │ FastAPI on Render    │ ──────────> │ Firestore │
│  on Vercel   │                   │ (Motor-style adapter │             └───────────┘
└──────────────┘                   │  over Firestore)     │
                                   │                      │  Resend SDK  ┌───────────┐
                                   │                      │ ──────────>  │  Resend   │
                                   └─────────────────────┘              └───────────┘
```

### Why a Motor-style adapter?
We had 9 route files containing 4 phases of carefully-tested accounting
logic written against `motor.AsyncIOMotorClient`. Rewriting every query
risked introducing financial bugs. Instead, `firestore_db.py` implements
the *exact* slice of the Motor API that the routes use:

```
.find(query, projection).sort(field, dir).to_list(N)
.find_one(query, projection)
.insert_one(doc)            .insert_many(docs)
.update_one(query, update)  .update_many(query, update)
.delete_one(query)          .delete_many(query)
.aggregate(pipeline).to_list(N)
.create_index(...)          # no-op
```

It supports:

- Operators: `$or`, `$and`, `$ne`, `$gt/$gte/$lt/$lte`, `$in`, `$nin`, `$regex`, `$exists`
- Dotted field paths (`allocations.reference_id`)
- Aggregation stages: `$match`, `$unwind`, `$group` ($sum / $min / $max / $first), `$sort`, `$limit`, `$skip`, `$project`
- Update operators: `$set`, `$inc`, `$push`, `$pull`, `$unset`
- Counter sequences via Firestore transactions in `database.get_next_sequence`.

Result: **all 48 phase-7/8/9/10 accounting tests pass identically on
Firestore as they did on MongoDB**.

---

## 10. Maintenance Checklist

| When | What |
|---|---|
| **After this migration** | Rotate the Firebase service-account key (Console → Service accounts → Manage keys → delete the leaked one, generate a new one, update `FIREBASE_SERVICE_ACCOUNT_JSON` on Render). |
| **Weekly** | Run `gcloud firestore export` to a GCS bucket. |
| **Monthly** | Check Firebase Console → Usage tab. If reads > 30K/day on average, consider pagination. |
| **Before going live to customers** | Verify a domain at <https://resend.com/domains> and switch `SENDER_EMAIL` so OTPs reach real recipients. |
| **Yearly** | Rotate the JWT secret (set new `JWT_SECRET` on Render — users will need to log back in). |

---

## 11. Validation Matrix (what was tested)

| Flow | Test file | Status |
|---|---|---|
| Authentication (login, register, /me, logout, forgot/reset) | test_phase7.py | ✅ |
| Customer create / list / detail / outstanding | test_phase7.py, test_phase8_9.py | ✅ |
| Supplier create / payable / outstanding | test_phase7.py, test_phase8_9.py | ✅ |
| Purchase create / detail / supplier-return-adjustments | test_phase7.py | ✅ |
| Supplier credit-note: original purchase value preserved | test_phase7.py | ✅ |
| Invoice create / list / get | test_phase7.py | ✅ |
| Payment: single allocation | test_phase7.py | ✅ |
| Payment: multi-cheque (sum validation) | test_phase7.py | ✅ |
| Payment: multi-allocation | test_phase7.py | ✅ |
| Returns: warehouse vs supplier destination | test_phase7.py | ✅ |
| Returns: delete reversal | test_phase7.py | ✅ |
| Customer ledger | test_phase7.py | ✅ |
| Supplier ledger | test_phase7.py | ✅ |
| Customer outstanding `returned` column non-zero | test_phase8_9.py | ✅ |
| Ledger credit-note reference present | test_phase8_9.py | ✅ |
| Supplier payable = supplier outstanding (Phase 9.1 canonical formula) | test_phase8_9.py | ✅ |
| Backdated returns | test_phase10.py | ✅ |
| Historical invoice using returned stock | test_phase10.py | ✅ |
| Opening-balance-date filtering on ledgers | test_phase10.py | ✅ |

**Total: 48/48 passing on Firestore.**
