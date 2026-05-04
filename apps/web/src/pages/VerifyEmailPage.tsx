import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { verifyEmail, resendVerification } from "../api/auth";
import { useAuth } from "../context/AuthContext";

type PageState = "idle" | "verifying" | "success" | "already_verified" | "error" | "resent";

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const sent = params.get("sent") === "1";
  const emailHint = params.get("email") ?? "";
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [pageState, setPageState] = useState<PageState>(token ? "verifying" : "idle");
  const [resending, setResending] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!token) return;
    setPageState("verifying");
    verifyEmail(token)
      .then(() => setPageState("success"))
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "Verification failed.";
        if (msg.toLowerCase().includes("already")) {
          setPageState("already_verified");
        } else {
          setPageState("error");
          setErrorMsg(msg);
        }
      });
  }, [token]);

  async function handleResend() {
    if (!isAuthenticated || resending) return;
    setResending(true);
    try {
      await resendVerification();
      setPageState("resent");
    } catch (err) {
      setPageState("error");
      setErrorMsg(err instanceof Error ? err.message : "Could not resend verification email.");
    } finally {
      setResending(false);
    }
  }

  const displayEmail = emailHint || user?.email || "";

  return (
    <div className="login-bg">
      <div className="login-card">
        <div className="login-brand">
          <span className="login-logo-icon">S</span>
          <h1 className="login-logo-text">Verify your email</h1>
        </div>

        {pageState === "verifying" && (
          <div className="auth-notice auth-notice--info">
            <span className="btn-spinner" style={{ flexShrink: 0 }} />
            <div>
              <p className="auth-notice-title">Verifying your email…</p>
            </div>
          </div>
        )}

        {pageState === "success" && (
          <>
            <div className="auth-notice auth-notice--success">
              <svg viewBox="0 0 20 20" fill="currentColor" className="auth-notice-icon">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="auth-notice-title">Email verified!</p>
                <p className="auth-notice-body">Your email address has been verified successfully.</p>
              </div>
            </div>
            <button className="btn btn--primary btn--full" type="button" onClick={() => navigate("/dashboard")}>
              Go to dashboard
            </button>
          </>
        )}

        {pageState === "already_verified" && (
          <>
            <div className="auth-notice auth-notice--success">
              <svg viewBox="0 0 20 20" fill="currentColor" className="auth-notice-icon">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="auth-notice-title">Already verified</p>
                <p className="auth-notice-body">Your email address is already verified.</p>
              </div>
            </div>
            <button className="btn btn--primary btn--full" type="button" onClick={() => navigate("/dashboard")}>
              Go to dashboard
            </button>
          </>
        )}

        {pageState === "error" && (
          <>
            <div className="auth-notice auth-notice--error">
              <svg viewBox="0 0 20 20" fill="currentColor" className="auth-notice-icon">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="auth-notice-title">Verification failed</p>
                <p className="auth-notice-body">{errorMsg || "This link is invalid or has expired."}</p>
              </div>
            </div>
            {isAuthenticated && (
              <button
                className="btn btn--primary btn--full"
                type="button"
                onClick={handleResend}
                disabled={resending}
              >
                {resending ? <span className="btn-spinner" /> : "Send a new verification link"}
              </button>
            )}
          </>
        )}

        {pageState === "idle" && sent && (
          <>
            <div className="auth-notice auth-notice--info">
              <svg viewBox="0 0 20 20" fill="currentColor" className="auth-notice-icon">
                <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
                <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
              </svg>
              <div>
                <p className="auth-notice-title">Check your inbox</p>
                <p className="auth-notice-body">
                  We sent a verification link to <strong>{displayEmail}</strong>. Check your spam folder if you don't see it.
                </p>
              </div>
            </div>
            <button
              className="btn btn--primary btn--full"
              type="button"
              onClick={() => navigate("/dashboard")}
            >
              Continue to dashboard
            </button>
            {isAuthenticated && (
              <button
                className="btn btn--ghost btn--full"
                type="button"
                onClick={handleResend}
                disabled={resending}
              >
                {resending ? <span className="btn-spinner" /> : "Resend verification email"}
              </button>
            )}
          </>
        )}

        {pageState === "resent" && (
          <div className="auth-notice auth-notice--success">
            <svg viewBox="0 0 20 20" fill="currentColor" className="auth-notice-icon">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <div>
              <p className="auth-notice-title">Verification email sent</p>
              <p className="auth-notice-body">Check your inbox for the new verification link.</p>
            </div>
          </div>
        )}

        <p className="auth-switch">
          <Link to="/login">← Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
