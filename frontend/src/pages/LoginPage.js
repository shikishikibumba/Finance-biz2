import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import API from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShoppingCart, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

export default function LoginPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState("login"); // login, register, forgot, reset
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [generatedOtp, setGeneratedOtp] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const formatError = (err) => {
    const detail = err?.response?.data?.detail;
    if (detail) {
      if (typeof detail === "string") return detail;
      if (Array.isArray(detail)) return detail.map(e => e?.msg || JSON.stringify(e)).join(" ");
      return String(detail);
    }
    // Network error / no response from backend
    if (err?.message === "Network Error") return "Cannot reach backend. Check your connection.";
    if (err?.code === "ERR_NETWORK") return "Network error — backend unreachable.";
    if (err?.response?.status) return `Request failed with status ${err.response.status}`;
    return err?.message || "Something went wrong";
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
    } catch (err) {
      console.error("Login error:", err);
      setError(formatError(err));
    } finally { setLoading(false); }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await register(email, password, name);
    } catch (err) {
      console.error("Register error:", err);
      setError(formatError(err));
    } finally { setLoading(false); }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { data } = await API.post("/auth/forgot-password", { email });
      if (data.email_sent) {
        setGeneratedOtp("");
        toast.success(`OTP sent to ${email}. Check your inbox (and spam folder).`);
      } else {
        // Email service not configured — fall back to showing OTP inline
        setGeneratedOtp(data.otp || "");
        toast.success("OTP generated. Email not configured — code shown below.");
      }
      setMode("reset");
    } catch (err) {
      console.error("Forgot password error:", err);
      setError(formatError(err));
    } finally { setLoading(false); }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await API.post("/auth/reset-password", { email, otp, new_password: newPassword });
      toast.success("Password reset successfully!");
      setMode("login");
      setPassword("");
      setOtp("");
      setNewPassword("");
      setGeneratedOtp("");
    } catch (err) {
      console.error("Reset password error:", err);
      setError(formatError(err));
    } finally { setLoading(false); }
  };

  const switchMode = (newMode) => {
    setMode(newMode);
    setError("");
    setGeneratedOtp("");
    setOtp("");
    setNewPassword("");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[hsl(var(--surface-muted))] p-4">
      <Card className="w-full max-w-md shadow-lg border-[hsl(var(--border))]">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto w-12 h-12 rounded-md bg-[#0F172A] flex items-center justify-center mb-3">
            <ShoppingCart className="text-white" size={24} />
          </div>
          <CardTitle className="text-2xl tracking-tight" style={{ fontFamily: 'Outfit, sans-serif' }}>
            Commerical Trading
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            {mode === "login" && "Sign in to your account"}
            {mode === "register" && "Create your account"}
            {mode === "forgot" && "Reset your password"}
            {mode === "reset" && "Enter OTP and new password"}
          </p>
        </CardHeader>
        <CardContent>
          {/* LOGIN FORM */}
          {mode === "login" && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="font-semibold text-xs uppercase tracking-wider">Email</Label>
                <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@example.com" required data-testid="login-email-input" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="font-semibold text-xs uppercase tracking-wider">Password</Label>
                <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter password" required data-testid="login-password-input" />
              </div>
              {error && <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-sm" data-testid="auth-error">{error}</div>}
              <Button type="submit" className="w-full bg-[#0F172A] hover:bg-[#1E293B] text-white rounded-sm font-medium tracking-wide" disabled={loading} data-testid="login-submit-button">
                {loading ? "Please wait..." : "Sign In"}
              </Button>
              <div className="flex items-center justify-between text-sm">
                <button type="button" className="text-muted-foreground hover:text-foreground transition-colors" onClick={() => switchMode("forgot")} data-testid="forgot-password-link">
                  Forgot Password?
                </button>
                <button type="button" className="text-muted-foreground hover:text-foreground transition-colors" onClick={() => switchMode("register")} data-testid="toggle-auth-mode">
                  Create account
                </button>
              </div>
            </form>
          )}

          {/* REGISTER FORM */}
          {mode === "register" && (
            <form onSubmit={handleRegister} className="space-y-4">
              <div className="space-y-2">
                <Label className="font-semibold text-xs uppercase tracking-wider">Name</Label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" required data-testid="register-name-input" />
              </div>
              <div className="space-y-2">
                <Label className="font-semibold text-xs uppercase tracking-wider">Email</Label>
                <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email address" required data-testid="login-email-input" />
              </div>
              <div className="space-y-2">
                <Label className="font-semibold text-xs uppercase tracking-wider">Password</Label>
                <Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Choose password" required data-testid="login-password-input" />
              </div>
              {error && <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-sm" data-testid="auth-error">{error}</div>}
              <Button type="submit" className="w-full bg-[#0F172A] hover:bg-[#1E293B] text-white rounded-sm font-medium tracking-wide" disabled={loading} data-testid="login-submit-button">
                {loading ? "Please wait..." : "Create Account"}
              </Button>
              <div className="text-center">
                <button type="button" className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 mx-auto" onClick={() => switchMode("login")} data-testid="toggle-auth-mode">
                  <ArrowLeft size={14} /> Back to Sign In
                </button>
              </div>
            </form>
          )}

          {/* FORGOT PASSWORD FORM */}
          {mode === "forgot" && (
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <div className="space-y-2">
                <Label className="font-semibold text-xs uppercase tracking-wider">Email Address</Label>
                <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Enter your email" required data-testid="forgot-email-input" />
              </div>
              {error && <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-sm" data-testid="auth-error">{error}</div>}
              <Button type="submit" className="w-full bg-[#0F172A] hover:bg-[#1E293B] text-white rounded-sm font-medium tracking-wide" disabled={loading} data-testid="send-otp-button">
                {loading ? "Sending..." : "Send OTP"}
              </Button>
              <div className="text-center">
                <button type="button" className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 mx-auto" onClick={() => switchMode("login")}>
                  <ArrowLeft size={14} /> Back to Sign In
                </button>
              </div>
            </form>
          )}

          {/* RESET PASSWORD FORM */}
          {mode === "reset" && (
            <form onSubmit={handleResetPassword} className="space-y-4">
              {generatedOtp ? (
                <div className="bg-blue-50 border border-blue-200 text-blue-800 p-3 rounded-sm text-sm" data-testid="otp-display">
                  <span className="font-bold">Your OTP:</span> <span className="font-mono text-lg">{generatedOtp}</span>
                  <p className="text-xs mt-1 text-blue-600">Email service not configured — copy this OTP and enter below. Expires in 15 minutes.</p>
                </div>
              ) : (
                <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-3 rounded-sm text-sm" data-testid="otp-email-sent">
                  We sent a 6-digit OTP to <strong>{email}</strong>. Check your inbox (and spam folder). Expires in 15 minutes.
                </div>
              )}
              <div className="space-y-2">
                <Label className="font-semibold text-xs uppercase tracking-wider">OTP Code</Label>
                <Input value={otp} onChange={e => setOtp(e.target.value)} placeholder="Enter 6-digit OTP" required maxLength={6} data-testid="otp-input" />
              </div>
              <div className="space-y-2">
                <Label className="font-semibold text-xs uppercase tracking-wider">New Password</Label>
                <Input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Enter new password" required data-testid="new-password-input" />
              </div>
              {error && <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-sm" data-testid="auth-error">{error}</div>}
              <Button type="submit" className="w-full bg-[#0F172A] hover:bg-[#1E293B] text-white rounded-sm font-medium tracking-wide" disabled={loading} data-testid="reset-password-button">
                {loading ? "Resetting..." : "Reset Password"}
              </Button>
              <div className="text-center">
                <button type="button" className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 mx-auto" onClick={() => switchMode("login")}>
                  <ArrowLeft size={14} /> Back to Sign In
                </button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
