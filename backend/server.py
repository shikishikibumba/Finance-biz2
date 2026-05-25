from pathlib import Path
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from fastapi import FastAPI, APIRouter, HTTPException, Response, Depends
from starlette.middleware.cors import CORSMiddleware
import os
import logging
import uuid
from datetime import datetime, timezone, timedelta
from pydantic import BaseModel
import random
from database import db
from auth import (
    hash_password, verify_password,
    create_access_token, create_refresh_token,
    get_current_user
)
from email_service import send_email, build_otp_email_html

app = FastAPI(redirect_slashes=False)

# CORS — if CORS_ORIGINS is "*" we cannot use allow_credentials=True (browsers block it).
# We either:
#   1) echo back the request origin (works with credentials), or
#   2) use the explicit list the user configured.
_cors_env = os.environ.get('CORS_ORIGINS', '*').strip()
if _cors_env == '*' or _cors_env == '':
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=".*",   # echoes Origin back → compatible with credentials
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in _cors_env.split(',') if o.strip()],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# ── Auth Routes ──
auth_router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: str
    password: str


class RegisterRequest(BaseModel):
    email: str
    password: str
    name: str


@auth_router.post("/login")
async def login(req: LoginRequest, response: Response):
    email = req.email.lower().strip()
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or not verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    access_token = create_access_token(user["id"], email)
    refresh_token = create_refresh_token(user["id"])
    response.set_cookie(key="access_token", value=access_token, httponly=True, secure=False, samesite="lax", max_age=86400, path="/")
    response.set_cookie(key="refresh_token", value=refresh_token, httponly=True, secure=False, samesite="lax", max_age=604800, path="/")
    return {"id": user["id"], "email": user["email"], "name": user["name"], "role": user.get("role", "user")}


@auth_router.post("/register")
async def register(req: RegisterRequest, response: Response):
    email = req.email.lower().strip()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user_id = str(uuid.uuid4())
    user_doc = {
        "id": user_id,
        "email": email,
        "password_hash": hash_password(req.password),
        "name": req.name,
        "role": "user",
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.users.insert_one(user_doc)
    access_token = create_access_token(user_id, email)
    refresh_token = create_refresh_token(user_id)
    response.set_cookie(key="access_token", value=access_token, httponly=True, secure=False, samesite="lax", max_age=86400, path="/")
    response.set_cookie(key="refresh_token", value=refresh_token, httponly=True, secure=False, samesite="lax", max_age=604800, path="/")
    return {"id": user_id, "email": email, "name": req.name, "role": "user"}


@auth_router.get("/me")
async def get_me(user: dict = Depends(get_current_user)):
    return user


@auth_router.post("/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"message": "Logged out"}


class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    email: str
    otp: str
    new_password: str


@auth_router.post("/forgot-password")
async def forgot_password(req: ForgotPasswordRequest):
    email = req.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if not user:
        raise HTTPException(status_code=404, detail="Email not found")
    otp = str(random.randint(100000, 999999))
    await db.password_resets.insert_one({
        "id": str(uuid.uuid4()),
        "email": email,
        "otp": otp,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat(),
        "used": False
    })

    # Send OTP email (Resend). If it fails, we fall back to returning OTP in the
    # response so the user can still reset the password.
    app_name = os.environ.get("APP_NAME", "Commercial Trading")
    html = build_otp_email_html(name=user.get("name", ""), otp=otp, app_name=app_name)
    email_sent = await send_email(
        to=email,
        subject=f"{app_name} - Password Reset Code",
        html=html,
    )
    if email_sent:
        return {"message": f"OTP sent to {email}. Check your inbox.", "email_sent": True}
    # Fallback — development / no Resend key
    return {
        "message": "OTP generated (email service not configured — shown inline).",
        "email_sent": False,
        "otp": otp,
    }


@auth_router.post("/reset-password")
async def reset_password(req: ResetPasswordRequest):
    email = req.email.lower().strip()
    reset = await db.password_resets.find_one(
        {"email": email, "otp": req.otp, "used": False,
         "expires_at": {"$gte": datetime.now(timezone.utc).isoformat()}},
        sort=[("created_at", -1)]
    )
    if not reset:
        raise HTTPException(status_code=400, detail="Invalid or expired OTP")
    await db.users.update_one(
        {"email": email},
        {"$set": {"password_hash": hash_password(req.new_password)}}
    )
    await db.password_resets.update_one(
        {"id": reset["id"]},
        {"$set": {"used": True}}
    )
    return {"message": "Password reset successfully"}


app.include_router(auth_router)

# ── Include module routers ──
from routes.customers import router as customers_router
from routes.suppliers import router as suppliers_router
from routes.products import router as products_router
from routes.orders import router as orders_router
from routes.purchases import router as purchases_router
from routes.invoices import router as invoices_router
from routes.payments import router as payments_router
from routes.dashboard import router as dashboard_router
from routes.reports import router as reports_router
from routes.analytics import router as analytics_router
from routes.settings import router as settings_router
from routes.returns import router as returns_router
from routes.delivery_orders import router as delivery_orders_router
from routes.returned_stock import router as returned_stock_router

app.include_router(customers_router)
app.include_router(suppliers_router)
app.include_router(products_router)
app.include_router(orders_router)
app.include_router(purchases_router)
app.include_router(invoices_router)
app.include_router(payments_router)
app.include_router(dashboard_router)
app.include_router(reports_router)
app.include_router(analytics_router)
app.include_router(settings_router)
app.include_router(returns_router)
app.include_router(returned_stock_router)
app.include_router(delivery_orders_router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.customers.create_index("id", unique=True)
    await db.suppliers.create_index("id", unique=True)
    await db.products.create_index("id", unique=True)
    await db.orders.create_index("id", unique=True)
    await db.purchases.create_index("id", unique=True)
    await db.invoices.create_index("id", unique=True)
    await db.payments.create_index("id", unique=True)
    await db.returns.create_index("id", unique=True)
    await db.returned_stock.create_index("id", unique=True)
    await db.invoices.create_index("invoice_number", unique=True)
    await db.purchases.create_index("purchase_number", unique=True)

    admin_email = os.environ.get("ADMIN_EMAIL", "admin@example.com")
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin123")
    existing = await db.users.find_one({"email": admin_email})
    if not existing:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "email": admin_email,
            "password_hash": hash_password(admin_password),
            "name": "Admin",
            "role": "admin",
            "created_at": datetime.now(timezone.utc).isoformat()
        })
    elif not verify_password(admin_password, existing["password_hash"]):
        await db.users.update_one(
            {"email": admin_email},
            {"$set": {"password_hash": hash_password(admin_password)}}
        )

    # Phase 7 migration — restore original total_amount on purchases that
    # had been previously reduced by supplier returns.
    purs = await db.purchases.find({"supplier_return_adjustments": {"$exists": True, "$ne": []}}).to_list(None)
    for pur in purs:
        adjs = pur.get("supplier_return_adjustments") or []
        if not adjs:
            continue
        if pur.get("_phase7_total_restored"):
            continue
        adj_total = round(sum(float(a.get("amount", 0) or 0) for a in adjs), 2)
        if adj_total <= 0:
            continue
        original = float(pur.get("total_amount", 0) or 0)
        await db.purchases.update_one(
            {"id": pur["id"]},
            {"$set": {
                "total_amount": round(original + adj_total, 2),
                "_phase7_total_restored": True
            }}
        )

    os.makedirs("/app/memory", exist_ok=True)
    with open("/app/memory/test_credentials.md", "w") as f:
        f.write(f"# Test Credentials\n\n## Admin\n- Email: {admin_email}\n- Password: {admin_password}\n- Role: admin\n\n## Auth Endpoints\n- POST /api/auth/login\n- POST /api/auth/register\n- GET /api/auth/me\n- POST /api/auth/logout\n")
    logger.info("Admin seeded and indexes created")


@app.on_event("shutdown")
async def shutdown():
    pass


logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)
