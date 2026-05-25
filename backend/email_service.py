"""Email service — Resend integration with a safe fallback.

If RESEND_API_KEY is set, sends HTML email via Resend API (non-blocking).
Otherwise, logs the message and returns False so the caller can fall back.
"""
import os
import asyncio
import logging

try:
    import resend as _resend
    _RESEND_AVAILABLE = True
except ImportError:
    _RESEND_AVAILABLE = False

logger = logging.getLogger(__name__)


def _sender_header() -> str:
    name = os.environ.get("SENDER_NAME", "Commercial Trading")
    email = os.environ.get("SENDER_EMAIL", "onboarding@resend.dev")
    return f"{name} <{email}>"


async def send_email(to: str, subject: str, html: str) -> bool:
    """Send an email via Resend. Returns True on success, False on failure or no key."""
    api_key = os.environ.get("RESEND_API_KEY", "").strip()
    if not api_key or not _RESEND_AVAILABLE:
        logger.warning("RESEND_API_KEY not configured — skipping email to %s", to)
        return False

    _resend.api_key = api_key
    params = {
        "from": _sender_header(),
        "to": [to],
        "subject": subject,
        "html": html,
    }
    try:
        result = await asyncio.to_thread(_resend.Emails.send, params)
        logger.info("Email sent to %s (id=%s)", to, (result or {}).get("id"))
        return True
    except Exception as e:  # noqa: BLE001
        logger.error("Resend failed for %s: %s", to, e)
        return False


def build_otp_email_html(name: str, otp: str, app_name: str = "Commercial Trading") -> str:
    """Minimal, inline-styled HTML email for OTP — safe across email clients."""
    return f"""
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 20px;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 4px 16px rgba(15,23,42,0.08);">
        <tr><td style="background:#0f172a;padding:26px 32px;">
          <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600;letter-spacing:-0.2px;">{app_name}</h1>
          <p style="margin:4px 0 0;color:#94a3b8;font-size:12px;">Password Reset Request</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 14px;color:#0f172a;font-size:15px;">Hi {name or 'there'},</p>
          <p style="margin:0 0 22px;color:#334155;font-size:14px;line-height:22px;">
            We received a request to reset your password. Use the one-time code below to continue.
            This code is valid for <strong>15 minutes</strong>. If you didn't request this, you can safely ignore this email.
          </p>
          <div style="background:#f8fafc;border:1px dashed #cbd5e1;border-radius:10px;padding:22px;text-align:center;">
            <div style="color:#64748b;font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:700;">Your OTP</div>
            <div style="margin-top:8px;font-size:36px;font-weight:700;color:#0f172a;letter-spacing:8px;font-family:'Courier New',monospace;">{otp}</div>
          </div>
          <p style="margin:26px 0 0;color:#64748b;font-size:12px;">— {app_name} Team</p>
        </td></tr>
        <tr><td style="padding:18px 32px;border-top:1px solid #e2e8f0;background:#f8fafc;">
          <p style="margin:0;color:#94a3b8;font-size:11px;">This is an automated message — please do not reply.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
""".strip()
