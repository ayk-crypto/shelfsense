import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { login } from "../api/auth";
import { useAuth } from "../context/AuthContext";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { saveAuth } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const data = await login(email, password);
      saveAuth(data.user, data.token);
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function fillDemo() {
    setEmail("demo@shelfsense.local");
    setPassword("demo123456");
    setError(null);
  }

  return (
    <div className="login-bg">
      <div className="login-card">
        <div className="login-brand">
          <span className="login-logo-icon">S</span>
          <h1 className="login-logo-text">ShelfSense</h1>
          <p className="login-tagline">Sign in to your inventory workspace</p>
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
            <label className="field-label" htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              className="field-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              className="field-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
            />
          </div>

          <button className="btn btn--primary btn--full" type="submit" disabled={loading}>
            {loading ? (
              <span className="btn-spinner" />
            ) : (
              "Sign in"
            )}
          </button>
        </form>

        <div className="login-demo">
          <p className="demo-label">Demo credentials</p>
          <div className="demo-credentials">
            <div className="demo-row">
              <span className="demo-key">Email</span>
              <code className="demo-value">demo@shelfsense.local</code>
            </div>
            <div className="demo-row">
              <span className="demo-key">Password</span>
              <code className="demo-value">demo123456</code>
            </div>
          </div>
          <button className="btn btn--ghost btn--sm" type="button" onClick={fillDemo}>
            Fill demo credentials
          </button>
        </div>

        <p className="auth-switch">
          New to ShelfSense? <Link to="/signup">Create an account</Link>
        </p>
      </div>
    </div>
  );
}

