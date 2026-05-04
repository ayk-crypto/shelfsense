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
          <div className="auth-notice auth-notice--error">
            <svg viewBox="0 0 20 20" fill="currentColor" className="auth-notice-icon">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <div>
              <p className="auth-notice-title">Missing reset token</p>
              <p className="auth-notice-body">This link is invalid. Please request a new password reset.</p>
            </div>
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
          <div className="auth-notice auth-notice--success">
            <svg viewBox="0 0 20 20" fill="currentColor" className="auth-notice-icon">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <div>
              <p className="auth-notice-title">Password changed successfully</p>
              <p className="auth-notice-body">You can now sign in with your new password.</p>
            </div>
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
