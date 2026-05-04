import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { resetPassword } from "../api/auth";

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!token) {
    return (
      <div className="login-bg">
        <div className="login-card">
          <div className="login-brand">
            <span className="login-logo-icon">S</span>
            <h1 className="login-logo-text">Invalid link</h1>
          </div>
          <div className="fp-success">
            <div className="fp-success-icon fp-success-icon--error">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </div>
            <p className="fp-success-title">Missing reset token</p>
            <p className="fp-success-body">This link is invalid. Please request a new password reset.</p>
          </div>
          <p className="auth-switch">
            <Link to="/forgot-password">Request new reset link</Link>
          </p>
        </div>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="login-bg">
        <div className="login-card">
          <div className="login-brand">
            <span className="login-logo-icon">S</span>
            <h1 className="login-logo-text">Password updated</h1>
          </div>
          <div className="fp-success">
            <div className="fp-success-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <p className="fp-success-title">Password changed successfully</p>
            <p className="fp-success-body">You can now sign in with your new password.</p>
          </div>
          <button
            className="btn btn--primary btn--full"
            type="button"
            onClick={() => navigate("/login")}
          >
            Sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="login-bg">
      <div className="login-card">
        <div className="login-brand">
          <span className="login-logo-icon">S</span>
          <h1 className="login-logo-text">Set new password</h1>
          <p className="login-tagline">Choose a strong password for your account.</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          {error && (
            <div className="alert alert--error" role="alert">{error}</div>
          )}
          <div className="field">
            <label className="field-label" htmlFor="rp-password">New password</label>
            <input
              id="rp-password"
              type="password"
              className="field-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              required
              autoComplete="new-password"
              autoFocus
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="rp-confirm">Confirm new password</label>
            <input
              id="rp-confirm"
              type="password"
              className="field-input"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Re-enter your password"
              required
              autoComplete="new-password"
            />
          </div>
          <button
            className="btn btn--primary btn--full"
            type="submit"
            disabled={loading || !password || !confirm}
          >
            {loading ? <span className="btn-spinner" /> : "Update password"}
          </button>
        </form>

        <p className="auth-switch">
          <Link to="/login">← Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
