import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { register } from "../api/auth";
import { useAuth } from "../context/AuthContext";
import { LegalFooterLinks } from "./LegalPage";

export function SignupPage() {
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    workspaceName: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { saveAuth } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.name.trim() || !form.email.trim() || !form.password) {
      setError("Name, email, and password are required.");
      return;
    }

    if (form.password.trim().length === 0) {
      setError("Password cannot be empty.");
      return;
    }

    if (form.password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    try {
      const data = await register({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        workspaceName: form.workspaceName.trim() || undefined,
      });
      saveAuth(data.user, data.token);
      navigate("/onboarding", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-bg">
      <div className="login-card signup-card">
        <div className="login-brand">
          <span className="login-logo-icon">SS</span>
          <h1 className="login-logo-text">Create your workspace</h1>
          <p className="login-tagline">Set up ShelfSense for your business inventory operations.</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          {error && (
            <div className="alert alert--error" role="alert">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              {error}
            </div>
          )}

          <div className="field">
            <label className="field-label" htmlFor="signup-name">Your name</label>
            <input
              id="signup-name"
              className="field-input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Ayesha Khan"
              required
              autoComplete="name"
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="signup-email">Email address</label>
            <input
              id="signup-email"
              type="email"
              className="field-input"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="you@example.com"
              required
              autoComplete="email"
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="signup-password">Password</label>
            <input
              id="signup-password"
              type="password"
              className="field-input"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="At least 8 characters"
              required
              autoComplete="new-password"
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="signup-workspace">Business / workspace name</label>
            <input
              id="signup-workspace"
              className="field-input"
              value={form.workspaceName}
              onChange={(e) => setForm({ ...form, workspaceName: e.target.value })}
              placeholder="Optional, e.g. FreshMart"
              autoComplete="organization"
            />
          </div>

          <button className="btn btn--primary btn--full" type="submit" disabled={loading}>
            {loading ? <span className="btn-spinner" /> : "Create account"}
          </button>
        </form>

        <p className="auth-switch">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
        <p className="auth-legal-consent">
          By creating an account you agree to our{" "}
          <Link to="/terms">Terms of Service</Link> and{" "}
          <Link to="/privacy">Privacy Policy</Link>.
        </p>
        <LegalFooterLinks />
      </div>
    </div>
  );
}
