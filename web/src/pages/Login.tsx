import { FormEvent, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import { api } from "../api";

// Banner text for the ?verified=… flag set by the API's verification redirect.
const VERIFY_BANNERS: Record<string, { kind: "notice" | "alert"; text: string }> = {
  verified: { kind: "notice", text: "Email verified — you can now sign in." },
  expired: { kind: "alert", text: "That verification link has expired. Sign in to request a new one." },
  invalid: { kind: "alert", text: "That verification link is invalid or has already been used." },
};

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resendMsg, setResendMsg] = useState("");

  const banner = VERIFY_BANNERS[searchParams.get("verified") || ""];

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setResendMsg("");
    setNeedsVerification(false);
    setBusy(true);
    try {
      await login(email, password);
      navigate("/");
    } catch (err: any) {
      setError(err.message || "Login failed");
      // 403 on login means the account exists but isn't verified yet.
      if (err.status === 403) setNeedsVerification(true);
    } finally {
      setBusy(false);
    }
  };

  const onResend = async () => {
    setResendMsg("");
    setError("");
    setBusy(true);
    try {
      const res = await api.resendVerification(email);
      setResendMsg(res.message);
      setNeedsVerification(false);
    } catch (err: any) {
      setError(err.message || "Could not resend verification email");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <form className="card auth-card" onSubmit={onSubmit}>
        <h1>Sign in</h1>
        {banner && <div className={banner.kind}>{banner.text}</div>}
        {resendMsg && <div className="notice">{resendMsg}</div>}
        {error && <div className="alert">{error}</div>}
        {needsVerification && (
          <button type="button" className="link-btn" onClick={onResend} disabled={busy || !email}>
            Resend verification email
          </button>
        )}
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <button type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        <p className="muted">
          No account? <Link to="/register">Register</Link>
        </p>
      </form>
    </div>
  );
}
