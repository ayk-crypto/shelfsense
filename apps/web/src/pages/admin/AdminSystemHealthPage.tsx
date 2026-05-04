import { useEffect, useState } from "react";
import { getAdminSystemHealth } from "../../api/admin";
import type { AdminSystemHealth } from "../../types";

export function AdminSystemHealthPage() {
  const [health, setHealth] = useState<AdminSystemHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    getAdminSystemHealth()
      .then((r) => setHealth(r.health))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">System Health</h1>
          <p className="admin-page-subtitle">Platform infrastructure and service status</p>
        </div>
        <button className="btn btn--ghost" onClick={load} disabled={loading}>↺ Refresh</button>
      </div>

      {loading ? (
        <div className="admin-loading"><div className="spinner" /></div>
      ) : error ? (
        <div className="alert alert--error">{error}</div>
      ) : health ? (
        <div className="admin-health-grid">
          <div className="admin-health-card">
            <div className="admin-health-card-header">
              <div className="admin-health-indicator admin-health-indicator--ok" />
              <h3>API Server</h3>
            </div>
            <dl className="admin-dl">
              <dt>Status</dt><dd className="admin-health-ok">Operational</dd>
              <dt>Timestamp</dt><dd className="admin-muted">{new Date(health.api.timestamp).toLocaleString()}</dd>
            </dl>
          </div>

          <div className="admin-health-card">
            <div className="admin-health-card-header">
              <div className={`admin-health-indicator admin-health-indicator--${health.database.status === "ok" ? "ok" : "error"}`} />
              <h3>Database</h3>
            </div>
            <dl className="admin-dl">
              <dt>Status</dt>
              <dd className={health.database.status === "ok" ? "admin-health-ok" : "admin-health-error"}>
                {health.database.status === "ok" ? "Connected" : "Error"}
              </dd>
              {health.database.latencyMs != null && (
                <><dt>Latency</dt><dd className="admin-muted">{health.database.latencyMs}ms</dd></>
              )}
            </dl>
          </div>

          <div className="admin-health-card">
            <div className="admin-health-card-header">
              <div className={`admin-health-indicator admin-health-indicator--${health.email.configured ? "ok" : "warn"}`} />
              <h3>Email</h3>
            </div>
            <dl className="admin-dl">
              <dt>Configured</dt>
              <dd className={health.email.configured ? "admin-health-ok" : "admin-health-warn"}>
                {health.email.configured ? "Yes" : "Not configured (dev mode)"}
              </dd>
              <dt>Provider</dt><dd className="admin-muted">{health.email.provider}</dd>
              <dt>Total Sent</dt><dd>{health.email.totalSent.toLocaleString()}</dd>
              <dt>Failed (24h)</dt>
              <dd className={health.email.failedLast24h > 0 ? "admin-health-error" : "admin-health-ok"}>
                {health.email.failedLast24h}
              </dd>
              {health.email.lastSentAt && (
                <><dt>Last Sent</dt><dd className="admin-muted">{new Date(health.email.lastSentAt).toLocaleString()}</dd></>
              )}
            </dl>
          </div>

          <div className="admin-health-card">
            <div className="admin-health-card-header">
              <div className={`admin-health-indicator admin-health-indicator--${health.scheduler.status === "running" ? "ok" : "warn"}`} />
              <h3>Scheduler</h3>
            </div>
            <dl className="admin-dl">
              <dt>Status</dt>
              <dd className={health.scheduler.status === "running" ? "admin-health-ok" : "admin-health-warn"}>
                {health.scheduler.status}
              </dd>
            </dl>
          </div>

          <div className="admin-health-card">
            <div className="admin-health-card-header">
              <div className="admin-health-indicator admin-health-indicator--ok" />
              <h3>Build Info</h3>
            </div>
            <dl className="admin-dl">
              <dt>Node.js</dt><dd className="admin-muted">{health.build.nodeVersion}</dd>
              <dt>Environment</dt><dd className="admin-muted">{health.build.env}</dd>
            </dl>
          </div>
        </div>
      ) : null}
    </div>
  );
}
