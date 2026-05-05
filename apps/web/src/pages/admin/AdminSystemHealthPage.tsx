import { useEffect, useRef, useState } from "react";
import { getAdminSystemHealth } from "../../api/admin";
import type { AdminSystemHealth } from "../../types";

const REFRESH_INTERVAL = 30;

function getDbLatencyLevel(ms: number): "ok" | "warn" | "error" {
  if (ms < 20) return "ok";
  if (ms < 100) return "warn";
  return "error";
}

function getDbLatencyColor(level: "ok" | "warn" | "error") {
  return level === "ok" ? "#16a34a" : level === "warn" ? "#d97706" : "#dc2626";
}

function getDbLatencyBg(level: "ok" | "warn" | "error") {
  return level === "ok" ? "#f0fdf4" : level === "warn" ? "#fff7ed" : "#fef2f2";
}

function formatTs(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function formatRelative(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function StatusPill({ ok, label, warn }: { ok: boolean; label?: string; warn?: boolean }) {
  return (
    <span
      className="sh-status-pill"
      style={{
        background: ok ? "#f0fdf4" : warn ? "#fff7ed" : "#fef2f2",
        color: ok ? "#16a34a" : warn ? "#d97706" : "#dc2626",
      }}
    >
      <span
        className="sh-status-dot"
        style={{ background: ok ? "#22c55e" : warn ? "#f59e0b" : "#ef4444" }}
      />
      {label ?? (ok ? "Operational" : "Error")}
    </span>
  );
}

function OverallBanner({ health }: { health: AdminSystemHealth }) {
  const issues: string[] = [];
  if (health.database.status !== "ok") issues.push("Database");
  if (!health.email.configured) issues.push("Email (not configured)");
  if (health.email.failedLast24h > 0) issues.push(`Email (${health.email.failedLast24h} failures)`);
  if (health.scheduler.status !== "running") issues.push("Scheduler");

  const allOk = issues.length === 0;

  return (
    <div className={`sh-banner ${allOk ? "sh-banner--ok" : "sh-banner--error"}`}>
      <div className="sh-banner-icon">
        {allOk ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        )}
      </div>
      <div>
        <div className="sh-banner-title">
          {allOk ? "All systems operational" : `${issues.length} issue${issues.length > 1 ? "s" : ""} detected`}
        </div>
        {!allOk && (
          <div className="sh-banner-detail">{issues.join(" · ")}</div>
        )}
      </div>
    </div>
  );
}

function ServiceCard({
  icon, title, status, statusLabel, statusWarn, accent, children,
}: {
  icon: React.ReactNode;
  title: string;
  status: "ok" | "warn" | "error";
  statusLabel?: string;
  statusWarn?: boolean;
  accent?: string;
  children: React.ReactNode;
}) {
  const accentColor = status === "ok" ? "#22c55e" : status === "warn" ? "#f59e0b" : "#ef4444";
  return (
    <div className="sh-card" style={{ borderLeftColor: accent ?? accentColor }}>
      <div className="sh-card-header">
        <div className="sh-card-icon">{icon}</div>
        <div className="sh-card-title">{title}</div>
        <StatusPill ok={status === "ok"} warn={statusWarn} label={statusLabel} />
      </div>
      <div className="sh-card-body">{children}</div>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="sh-metric">
      <div className="sh-metric-value">{value}</div>
      <div className="sh-metric-label">{label}</div>
      {sub && <div className="sh-metric-sub">{sub}</div>}
    </div>
  );
}

function Divider() {
  return <div className="sh-divider" />;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="sh-row">
      <span className="sh-row-label">{label}</span>
      <span className="sh-row-value">{value}</span>
    </div>
  );
}

// Icons
const IconServer = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="20" height="8" rx="2" />
    <rect x="2" y="14" width="20" height="8" rx="2" />
    <line x1="6" y1="6" x2="6.01" y2="6" />
    <line x1="6" y1="18" x2="6.01" y2="18" />
  </svg>
);

const IconDatabase = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <ellipse cx="12" cy="5" rx="9" ry="3" />
    <path d="M21 12c0 1.66-4.03 3-9 3S3 13.66 3 12" />
    <path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
  </svg>
);

const IconEmail = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
    <polyline points="22,6 12,13 2,6" />
  </svg>
);

const IconClock = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const IconCode = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="16 18 22 12 16 6" />
    <polyline points="8 6 2 12 8 18" />
  </svg>
);

export function AdminSystemHealthPage() {
  const [health, setHealth] = useState<AdminSystemHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function load(showSpinner = false) {
    if (showSpinner) setLoading(true);
    setCountdown(REFRESH_INTERVAL);
    getAdminSystemHealth()
      .then((r) => {
        setHealth(r.health);
        setCheckedAt(new Date());
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load(true);
    const interval = setInterval(() => load(false), REFRESH_INTERVAL * 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setCountdown((c) => (c <= 1 ? REFRESH_INTERVAL : c - 1));
    }, 1000);
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  }, [checkedAt]);

  const progress = ((REFRESH_INTERVAL - countdown) / REFRESH_INTERVAL) * 100;

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">System Health</h1>
          <p className="admin-page-subtitle">Platform infrastructure and service status</p>
        </div>
        <div className="sh-header-actions">
          {checkedAt && (
            <span className="sh-last-checked">
              Checked {formatRelative(checkedAt.toISOString())}
            </span>
          )}
          <button className="btn btn--ghost btn--sm sh-refresh-btn" onClick={() => load(true)} disabled={loading}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={loading ? "sh-spin" : ""}>
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
            </svg>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* Countdown bar */}
      <div className="sh-countdown-bar">
        <div className="sh-countdown-fill" style={{ width: `${progress}%` }} />
      </div>
      <div className="sh-countdown-label">
        Auto-refreshing in {countdown}s
      </div>

      {loading && !health ? (
        <div className="admin-loading"><div className="spinner" /></div>
      ) : error ? (
        <div className="alert alert--error">{error}</div>
      ) : health ? (
        <>
          <OverallBanner health={health} />

          <div className="sh-grid">
            {/* API Server */}
            <ServiceCard
              icon={<IconServer />}
              title="API Server"
              status="ok"
              statusLabel="Operational"
            >
              <Row label="Response" value={<span style={{ color: "#16a34a", fontWeight: 600 }}>OK</span>} />
              <Row
                label="Checked at"
                value={<span className="sh-mono">{formatTs(health.api.timestamp)}</span>}
              />
            </ServiceCard>

            {/* Database */}
            {(() => {
              const dbOk = health.database.status === "ok";
              const ms = health.database.latencyMs;
              const level = ms != null ? getDbLatencyLevel(ms) : "error";
              return (
                <ServiceCard
                  icon={<IconDatabase />}
                  title="Database"
                  status={dbOk ? "ok" : "error"}
                  statusLabel={dbOk ? "Connected" : "Disconnected"}
                >
                  {ms != null && (
                    <>
                      <div className="sh-latency-block">
                        <div className="sh-latency-header">
                          <span className="sh-row-label">Query latency</span>
                          <span
                            className="sh-latency-badge"
                            style={{ background: getDbLatencyBg(level), color: getDbLatencyColor(level) }}
                          >
                            {ms} ms
                          </span>
                        </div>
                        <div className="sh-latency-bar-track">
                          <div
                            className="sh-latency-bar-fill"
                            style={{
                              width: `${Math.min((ms / 200) * 100, 100)}%`,
                              background: getDbLatencyColor(level),
                            }}
                          />
                        </div>
                        <div className="sh-latency-legend">
                          <span style={{ color: "#16a34a" }}>0–20 ms</span>
                          <span style={{ color: "#d97706" }}>20–100 ms</span>
                          <span style={{ color: "#dc2626" }}>100+ ms</span>
                        </div>
                      </div>
                    </>
                  )}
                </ServiceCard>
              );
            })()}

            {/* Email */}
            {(() => {
              const hasFailed = health.email.failedLast24h > 0;
              const emailStatus = !health.email.configured ? "warn" : hasFailed ? "error" : "ok";
              return (
                <ServiceCard
                  icon={<IconEmail />}
                  title="Email"
                  status={emailStatus}
                  statusWarn={!health.email.configured}
                  statusLabel={
                    !health.email.configured
                      ? "Not configured"
                      : hasFailed
                      ? `${health.email.failedLast24h} failure${health.email.failedLast24h !== 1 ? "s" : ""}`
                      : "Operational"
                  }
                >
                  <div className="sh-metrics-row">
                    <Metric
                      label="Total sent"
                      value={health.email.totalSent.toLocaleString()}
                    />
                    <Metric
                      label="Failed (24h)"
                      value={
                        <span style={{ color: hasFailed ? "#dc2626" : "#16a34a", fontWeight: 700 }}>
                          {health.email.failedLast24h}
                        </span>
                      }
                    />
                  </div>
                  <Divider />
                  <Row label="Provider" value={<span className="sh-badge sh-badge--neutral">{health.email.provider.toUpperCase()}</span>} />
                  {health.email.lastSentAt && (
                    <Row
                      label="Last sent"
                      value={<span className="sh-mono">{formatRelative(health.email.lastSentAt)}</span>}
                    />
                  )}
                  {health.email.lastSentType && (
                    <Row label="Last type" value={<span className="sh-badge sh-badge--neutral">{health.email.lastSentType}</span>} />
                  )}
                </ServiceCard>
              );
            })()}

            {/* Scheduler */}
            {(() => {
              const running = health.scheduler.status === "running";
              return (
                <ServiceCard
                  icon={<IconClock />}
                  title="Job Scheduler"
                  status={running ? "ok" : "warn"}
                  statusLabel={running ? "Running" : health.scheduler.status}
                >
                  <div className="sh-job-list">
                    {[
                      { name: "Low stock alerts", freq: "Every 4h" },
                      { name: "Expiry alerts", freq: "Every 4h" },
                      { name: "Daily digest", freq: "08:00 daily" },
                    ].map((job) => (
                      <div key={job.name} className="sh-job-item">
                        <span
                          className="sh-job-dot"
                          style={{ background: running ? "#22c55e" : "#f59e0b" }}
                        />
                        <span className="sh-job-name">{job.name}</span>
                        <span className="sh-job-freq">{job.freq}</span>
                      </div>
                    ))}
                  </div>
                </ServiceCard>
              );
            })()}

            {/* Build Info */}
            <ServiceCard
              icon={<IconCode />}
              title="Build Info"
              status="ok"
              statusLabel="Info"
            >
              <Row
                label="Node.js"
                value={<span className="sh-badge sh-badge--neutral">{health.build.nodeVersion}</span>}
              />
              <Row
                label="Environment"
                value={
                  <span
                    className="sh-badge"
                    style={
                      health.build.env === "production"
                        ? { background: "#f0fdf4", color: "#16a34a" }
                        : { background: "#fdf4ff", color: "#9333ea" }
                    }
                  >
                    {health.build.env}
                  </span>
                }
              />
            </ServiceCard>
          </div>
        </>
      ) : null}
    </div>
  );
}
