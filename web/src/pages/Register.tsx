import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";

export function Register() {
  const { register } = useAuth();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await register(email, name, password);
      setSentTo(email);
    } catch (err: any) {
      setError(err.message || "Registration failed");
    } finally {
      setBusy(false);
    }
  };

  // After a successful sign-up, the account is inactive until the emailed link
  // is confirmed — show a confirmation instead of logging in.
  if (sentTo) {
    return (
      <div className="auth-wrap">
        <div className="card auth-card">
          <h1>Check your email</h1>
          <p>
            We sent a verification link to <strong>{sentTo}</strong>. Open it within
            24 hours to activate your account, then sign in.
          </p>
          <p className="muted">
            <Link to="/login">Back to sign in</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-wrap">
      <form className="card auth-card" onSubmit={onSubmit}>
        <h1>Create account</h1>
        {error && <div className="alert">{error}</div>}
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </label>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
          <span className="hint">At least 8 characters.</span>
        </label>
        <button type="submit" disabled={busy}>{busy ? "Creating…" : "Create account"}</button>
        <p className="muted">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
