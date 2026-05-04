import { useState } from "react";
import { Link } from "react-router-dom";
import { forgotPassword } from "../api/auth";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await forgotPassword(email.trim());
      setSubmitted(true);
    } catch {
      setSubmitted(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-bg">
      <div className="login-card">
        <div className="login-brand">
          <span className="login-logo-icon">S</span>
          <h1 className="login-logo-text">Reset your password</h1>
          <p className="login-tagline">Enter your email and we'll send you a reset link.</p>
        </div>

        {submitted ? (
          <div className="fp-success">
            <div className="fp-success-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <p className="fp-success-title">Check your inbox</p>
            <p className="fp-success-body">
              If <strong>{email}</strong> is registered, a reset link has been sent. Check your spam folder if you don't see it within a minute.
            </p>
          </div>
        ) : (
          <form className="login-form" onSubmit={handleSubmit} noValidate>
            {error && (
              <div className="alert alert--error" role="alert">{error}</div>
            )}
            <div className="field">
              <label className="field-label" htmlFor="fp-email">Email address</label>
              <input
                id="fp-email"
                type="email"
                className="field-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoComplete="email"
                autoFocus
              />
            </div>
            <button className="btn btn--primary btn--full" type="submit" disabled={loading || !email.trim()}>
              {loading ? <span className="btn-spinner" /> : "Send reset link"}
            </button>
          </form>
        )}

        <p className="auth-switch">
          <Link to="/login">← Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
