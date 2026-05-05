import { useEffect, useRef, useState } from "react";
import {
  getAdminAnnouncements,
  createAdminAnnouncement,
  updateAdminAnnouncement,
  updateAdminAnnouncementStatus,
  getAdminPlans,
  getAdminWorkspaces,
} from "../../api/admin";
import type { AdminAnnouncement, AdminPlan, AdminWorkspace } from "../../types";

// ─── Constants ───────────────────────────────────────────────────────────────

const SEVERITY_CONFIG = {
  INFO:     { label: "Info",     color: "#2563eb", bg: "#eff6ff", border: "#93c5fd", textOnBg: "#1d4ed8" },
  SUCCESS:  { label: "Success",  color: "#16a34a", bg: "#f0fdf4", border: "#86efac", textOnBg: "#15803d" },
  WARNING:  { label: "Warning",  color: "#d97706", bg: "#fffbeb", border: "#fcd34d", textOnBg: "#b45309" },
  CRITICAL: { label: "Critical", color: "#dc2626", bg: "#fef2f2", border: "#fca5a5", textOnBg: "#b91c1c" },
} as const;

type Severity = keyof typeof SEVERITY_CONFIG;

function formatDate(iso: string | null) {
  if (!iso) return "∞";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatRelative(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function targetLabel(a: AdminAnnouncement, plans: AdminPlan[]): string {
  if (a.targetType === "ALL") return "All workspaces";
  if (a.targetType === "PLAN") {
    const plan = plans.find((p) => p.id === a.targetPlanId);
    return plan ? `${plan.name} plan` : "Specific plan";
  }
  return "Specific workspace";
}

// ─── Toast ───────────────────────────────────────────────────────────────────

type Toast = { type: "success" | "error"; text: string };

// ─── Announcement Card ────────────────────────────────────────────────────────

function AnnouncementCard({
  a, plans, onEdit, onToggle, toggling,
}: {
  a: AdminAnnouncement;
  plans: AdminPlan[];
  onEdit: () => void;
  onToggle: () => void;
  toggling: boolean;
}) {
  const sev = SEVERITY_CONFIG[a.severity as Severity] ?? SEVERITY_CONFIG.INFO;
  const hasSchedule = a.startsAt || a.endsAt;
  const now = Date.now();
  const isLive = a.isActive &&
    (!a.startsAt || new Date(a.startsAt).getTime() <= now) &&
    (!a.endsAt || new Date(a.endsAt).getTime() >= now);

  return (
    <div className={`ann-card ${!a.isActive ? "ann-card--inactive" : ""}`} style={{ borderLeftColor: sev.color }}>
      <div className="ann-card-top">
        <div className="ann-card-badges">
          <span className="ann-sev-badge" style={{ background: sev.bg, color: sev.textOnBg, borderColor: sev.border }}>
            {sev.label}
          </span>
          {isLive && (
            <span className="ann-live-badge">
              <span className="ann-live-dot" />
              Live
            </span>
          )}
          {!a.isActive && (
            <span className="ann-sev-badge" style={{ background: "#f8fafc", color: "#94a3b8", borderColor: "#e2e8f0" }}>
              Disabled
            </span>
          )}
        </div>
        <div className="ann-card-actions">
          <button className="ann-icon-btn" onClick={onEdit} title="Edit">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
          <button
            className={`ann-toggle-btn ${a.isActive ? "ann-toggle-btn--disable" : "ann-toggle-btn--enable"}`}
            onClick={onToggle}
            disabled={toggling}
          >
            {toggling ? "…" : a.isActive ? "Disable" : "Enable"}
          </button>
        </div>
      </div>

      <div className="ann-card-body">
        <h3 className="ann-card-title">{a.title}</h3>
        <p className="ann-card-message">{a.message}</p>
      </div>

      <div className="ann-card-footer">
        <div className="ann-card-meta">
          {/* Target */}
          <span className="ann-meta-chip">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 00-3-3.87" />
              <path d="M16 3.13a4 4 0 010 7.75" />
            </svg>
            {targetLabel(a, plans)}
          </span>
          {/* Schedule */}
          {hasSchedule && (
            <span className="ann-meta-chip">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              {formatDate(a.startsAt)} → {formatDate(a.endsAt)}
            </span>
          )}
          {/* Dismissible */}
          {a.dismissible && (
            <span className="ann-meta-chip">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
              Dismissible
            </span>
          )}
        </div>
        {a.createdBy && (
          <span className="ann-card-creator">
            By {a.createdBy.name} · {formatRelative(a.createdAt)}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Preview Banner ───────────────────────────────────────────────────────────

function AnnouncementPreview({ severity, title, message, dismissible }: {
  severity: Severity; title: string; message: string; dismissible: boolean;
}) {
  const sev = SEVERITY_CONFIG[severity];
  if (!title && !message) return null;
  return (
    <div className="ann-preview-wrap">
      <div className="ann-preview-label">Preview</div>
      <div className="ann-preview-banner" style={{ background: sev.bg, borderColor: sev.border }}>
        <div className="ann-preview-left" style={{ background: sev.color }} />
        <div className="ann-preview-content">
          {title && <strong style={{ color: sev.textOnBg, fontSize: 13 }}>{title}</strong>}
          {message && <p style={{ color: sev.color, fontSize: 12.5, margin: 0, opacity: 0.85 }}>{message}</p>}
        </div>
        {dismissible && (
          <button className="ann-preview-dismiss" style={{ color: sev.color }}>✕</button>
        )}
      </div>
    </div>
  );
}

// ─── Audience Picker ──────────────────────────────────────────────────────────

type TargetType = "ALL" | "PLAN" | "WORKSPACE";

function AudiencePicker({
  targetType, targetPlanId, targetWorkspaceId, plans,
  onChangeType, onChangePlanId, onChangeWorkspace,
}: {
  targetType: TargetType;
  targetPlanId: string;
  targetWorkspaceId: string;
  plans: AdminPlan[];
  onChangeType: (t: TargetType) => void;
  onChangePlanId: (id: string) => void;
  onChangeWorkspace: (id: string, name: string) => void;
}) {
  const [wsSearch, setWsSearch] = useState("");
  const [wsResults, setWsResults] = useState<AdminWorkspace[]>([]);
  const [wsLoading, setWsLoading] = useState(false);
  const [selectedWsName, setSelectedWsName] = useState("");
  const [wsOpen, setWsOpen] = useState(false);
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  function handleWsSearch(q: string) {
    setWsSearch(q);
    setSelectedWsName("");
    onChangeWorkspace("", "");
    setWsOpen(true);
    if (searchRef.current) clearTimeout(searchRef.current);
    if (!q.trim()) { setWsResults([]); return; }
    setWsLoading(true);
    searchRef.current = setTimeout(() => {
      getAdminWorkspaces({ search: q, limit: 8 })
        .then((r) => setWsResults(r.workspaces))
        .catch(() => setWsResults([]))
        .finally(() => setWsLoading(false));
    }, 300);
  }

  function selectWorkspace(ws: AdminWorkspace) {
    setWsSearch(ws.name);
    setSelectedWsName(ws.name);
    setWsOpen(false);
    setWsResults([]);
    onChangeWorkspace(ws.id, ws.name);
  }

  const audienceOptions: { type: TargetType; icon: React.ReactNode; title: string; desc: string }[] = [
    {
      type: "ALL",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
        </svg>
      ),
      title: "Everyone",
      desc: "Shown to all active workspaces",
    },
    {
      type: "PLAN",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
      ),
      title: "By Plan",
      desc: "Target all workspaces on a specific plan",
    },
    {
      type: "WORKSPACE",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      ),
      title: "Specific Workspace",
      desc: "Target one workspace by name",
    },
  ];

  return (
    <div className="ann-audience">
      <div className="ann-audience-cards">
        {audienceOptions.map((opt) => (
          <button
            key={opt.type}
            type="button"
            className={`ann-audience-card ${targetType === opt.type ? "ann-audience-card--active" : ""}`}
            onClick={() => onChangeType(opt.type)}
          >
            <div className="ann-audience-card-icon">{opt.icon}</div>
            <div className="ann-audience-card-label">{opt.title}</div>
            <div className="ann-audience-card-desc">{opt.desc}</div>
          </button>
        ))}
      </div>

      {/* Plan selector */}
      {targetType === "PLAN" && (
        <div className="ann-plan-picker">
          <div className="ann-plan-picker-label">Select a plan</div>
          <div className="ann-plan-chips">
            {plans.filter((p) => p.isActive && p.isPublic).map((plan) => (
              <button
                key={plan.id}
                type="button"
                className={`ann-plan-chip ${targetPlanId === plan.id ? "ann-plan-chip--active" : ""}`}
                onClick={() => onChangePlanId(plan.id)}
              >
                <div className="ann-plan-chip-name">{plan.name}</div>
                <div className="ann-plan-chip-price">
                  {plan.monthlyPrice === 0 ? "Free" : `$${plan.monthlyPrice}/mo`}
                </div>
              </button>
            ))}
          </div>
          {targetPlanId && (
            <p className="ann-plan-hint">
              This announcement will appear in all workspaces currently on the <strong>{plans.find((p) => p.id === targetPlanId)?.name}</strong> plan.
            </p>
          )}
        </div>
      )}

      {/* Workspace search */}
      {targetType === "WORKSPACE" && (
        <div className="ann-ws-picker" ref={dropdownRef}>
          <div className="ann-plan-picker-label">Search workspace</div>
          <div className="ann-ws-search-wrap">
            <svg className="ann-ws-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              className="ann-ws-search"
              placeholder="Search by workspace name…"
              value={wsSearch}
              onChange={(e) => handleWsSearch(e.target.value)}
              onFocus={() => wsSearch && setWsOpen(true)}
            />
            {selectedWsName && (
              <span className="ann-ws-selected-badge">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Selected
              </span>
            )}
          </div>
          {wsOpen && (wsLoading || wsResults.length > 0) && (
            <div className="ann-ws-dropdown">
              {wsLoading ? (
                <div className="ann-ws-dropdown-loading">Searching…</div>
              ) : (
                wsResults.map((ws) => (
                  <button
                    key={ws.id}
                    type="button"
                    className="ann-ws-result"
                    onClick={() => selectWorkspace(ws)}
                  >
                    <div className="ann-ws-result-name">{ws.name}</div>
                    <div className="ann-ws-result-meta">{ws.plan} · {ws.owner.email}</div>
                  </button>
                ))
              )}
            </div>
          )}
          {wsOpen && !wsLoading && wsResults.length === 0 && wsSearch.trim() && (
            <div className="ann-ws-dropdown">
              <div className="ann-ws-dropdown-loading">No workspaces found</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function AnnouncementModal({
  announcement, plans, onClose, onSaved,
}: {
  announcement: AdminAnnouncement | null;
  plans: AdminPlan[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setFormState] = useState({
    title: announcement?.title ?? "",
    message: announcement?.message ?? "",
    severity: (announcement?.severity ?? "INFO") as Severity,
    targetType: (announcement?.targetType ?? "ALL") as TargetType,
    targetPlanId: announcement?.targetPlanId ?? "",
    targetWorkspaceId: announcement?.targetWorkspaceId ?? "",
    startsAt: announcement?.startsAt ? announcement.startsAt.slice(0, 16) : "",
    endsAt: announcement?.endsAt ? announcement.endsAt.slice(0, 16) : "",
    dismissible: announcement?.dismissible ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof typeof form>(k: K, v: typeof form[K]) {
    setFormState((f) => ({ ...f, [k]: v }));
  }

  function applyQuickSchedule(days: number) {
    const now = new Date();
    const end = new Date(now.getTime() + days * 86400000);
    set("startsAt", now.toISOString().slice(0, 16));
    set("endsAt", end.toISOString().slice(0, 16));
  }

  async function handleSave() {
    if (!form.title.trim()) { setError("Title is required."); return; }
    if (!form.message.trim()) { setError("Message is required."); return; }
    if (form.targetType === "PLAN" && !form.targetPlanId) { setError("Select a plan for plan-targeted announcements."); return; }
    if (form.targetType === "WORKSPACE" && !form.targetWorkspaceId) { setError("Select a workspace for workspace-targeted announcements."); return; }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        title: form.title.trim(),
        message: form.message.trim(),
        severity: form.severity,
        targetType: form.targetType,
        targetPlanId: form.targetType === "PLAN" ? form.targetPlanId : null,
        targetWorkspaceId: form.targetType === "WORKSPACE" ? form.targetWorkspaceId : null,
        startsAt: form.startsAt || null,
        endsAt: form.endsAt || null,
        dismissible: form.dismissible,
      };
      if (announcement) {
        await updateAdminAnnouncement(announcement.id, payload);
      } else {
        await createAdminAnnouncement(payload);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ann-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ann-modal">
        {/* Header */}
        <div className="ann-modal-header">
          <div>
            <h2 className="ann-modal-title">{announcement ? "Edit Announcement" : "New Announcement"}</h2>
            <p className="ann-modal-sub">Compose a banner that appears inside workspaces</p>
          </div>
          <button className="ann-modal-close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="ann-modal-body">
          {error && <div className="alert alert--error" style={{ marginBottom: 16 }}>{error}</div>}

          {/* Severity */}
          <div className="ann-form-section">
            <label className="ann-form-section-label">Severity</label>
            <div className="ann-sev-chips">
              {(Object.entries(SEVERITY_CONFIG) as [Severity, typeof SEVERITY_CONFIG[Severity]][]).map(([key, cfg]) => (
                <button
                  key={key}
                  type="button"
                  className={`ann-sev-chip ${form.severity === key ? "ann-sev-chip--active" : ""}`}
                  style={form.severity === key ? { background: cfg.bg, borderColor: cfg.color, color: cfg.textOnBg } : {}}
                  onClick={() => set("severity", key)}
                >
                  {cfg.label}
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <div className="ann-form-section">
            <label className="ann-form-section-label">Title <span className="ann-required">*</span></label>
            <input
              className="form-input"
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="e.g. Scheduled maintenance on May 10"
              maxLength={120}
            />
          </div>

          {/* Message */}
          <div className="ann-form-section">
            <label className="ann-form-section-label">Message <span className="ann-required">*</span></label>
            <textarea
              className="form-input"
              value={form.message}
              onChange={(e) => set("message", e.target.value)}
              rows={3}
              placeholder="We will be performing scheduled maintenance from 2–4 AM UTC…"
            />
          </div>

          {/* Preview */}
          <AnnouncementPreview
            severity={form.severity}
            title={form.title}
            message={form.message}
            dismissible={form.dismissible}
          />

          {/* Audience */}
          <div className="ann-form-section">
            <label className="ann-form-section-label">Audience</label>
            <AudiencePicker
              targetType={form.targetType}
              targetPlanId={form.targetPlanId}
              targetWorkspaceId={form.targetWorkspaceId}
              plans={plans}
              onChangeType={(t) => setFormState((f) => ({ ...f, targetType: t, targetPlanId: "", targetWorkspaceId: "" }))}
              onChangePlanId={(id) => set("targetPlanId", id)}
              onChangeWorkspace={(id) => set("targetWorkspaceId", id)}
            />
          </div>

          {/* Schedule */}
          <div className="ann-form-section">
            <label className="ann-form-section-label">Schedule</label>
            <div className="ann-quick-presets">
              <span className="ann-preset-label">Quick:</span>
              {[
                { label: "24h", days: 1 },
                { label: "7 days", days: 7 },
                { label: "14 days", days: 14 },
                { label: "30 days", days: 30 },
              ].map((p) => (
                <button key={p.days} type="button" className="ann-preset-btn" onClick={() => applyQuickSchedule(p.days)}>
                  {p.label}
                </button>
              ))}
              <button type="button" className="ann-preset-btn" onClick={() => { set("startsAt", ""); set("endsAt", ""); }}>
                No end
              </button>
            </div>
            <div className="ann-schedule-grid">
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Starts at</label>
                <input className="form-input" type="datetime-local" value={form.startsAt} onChange={(e) => set("startsAt", e.target.value)} />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Ends at</label>
                <input className="form-input" type="datetime-local" value={form.endsAt} onChange={(e) => set("endsAt", e.target.value)} />
              </div>
            </div>
            {!form.startsAt && !form.endsAt && (
              <p className="ann-schedule-note">No schedule set — the announcement will be shown immediately and indefinitely until disabled.</p>
            )}
          </div>

          {/* Dismissible */}
          <div className="ann-form-section">
            <label className="ann-form-section-label">Options</label>
            <label className="ann-toggle-row">
              <div className={`ann-toggle ${form.dismissible ? "ann-toggle--on" : ""}`} onClick={() => set("dismissible", !form.dismissible)}>
                <div className="ann-toggle-thumb" />
              </div>
              <div>
                <div className="ann-toggle-label">Dismissible by users</div>
                <div className="ann-toggle-sub">Users can close this banner. If off, it stays visible until it expires.</div>
              </div>
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="ann-modal-footer">
          <button className="btn btn--ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn--primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : announcement ? "Save Changes" : "Publish Announcement"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type Filter = "all" | "active" | "inactive";

export function AdminAnnouncementsPage() {
  const [announcements, setAnnouncements] = useState<AdminAnnouncement[]>([]);
  const [plans, setPlans] = useState<AdminPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<AdminAnnouncement | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  function load() {
    setLoading(true);
    Promise.all([
      getAdminAnnouncements(),
      getAdminPlans(),
    ])
      .then(([annRes, planRes]) => {
        setAnnouncements(annRes.announcements);
        setPlans(planRes.plans);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  function showToast(type: "success" | "error", text: string) {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3500);
  }

  async function handleToggle(a: AdminAnnouncement) {
    setActionLoading(a.id);
    try {
      await updateAdminAnnouncementStatus(a.id, !a.isActive);
      showToast("success", a.isActive ? "Announcement disabled." : "Announcement enabled.");
      load();
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : "Failed");
    } finally {
      setActionLoading(null);
    }
  }

  const filtered = announcements.filter((a) => {
    if (filter === "active") return a.isActive;
    if (filter === "inactive") return !a.isActive;
    return true;
  });

  const activeCount = announcements.filter((a) => a.isActive).length;
  const inactiveCount = announcements.filter((a) => !a.isActive).length;

  return (
    <div className="admin-page">
      {/* Header */}
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Announcements</h1>
          <p className="admin-page-subtitle">
            Publish in-app banners to all workspaces or specific audiences
          </p>
        </div>
        <button
          className="btn btn--primary"
          onClick={() => { setEditing(null); setShowModal(true); }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Announcement
        </button>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`alert alert--${toast.type === "success" ? "success" : "error"}`} style={{ marginBottom: 16 }}>
          {toast.text}
        </div>
      )}

      {/* Filter tabs */}
      <div className="ann-filter-tabs">
        {([
          { key: "all", label: "All", count: announcements.length },
          { key: "active", label: "Active", count: activeCount },
          { key: "inactive", label: "Inactive", count: inactiveCount },
        ] as { key: Filter; label: string; count: number }[]).map((tab) => (
          <button
            key={tab.key}
            className={`ann-filter-tab ${filter === tab.key ? "ann-filter-tab--active" : ""}`}
            onClick={() => setFilter(tab.key)}
          >
            {tab.label}
            <span className="ann-filter-tab-count">{tab.count}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="admin-loading"><div className="spinner" /></div>
      ) : error ? (
        <div className="alert alert--error">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="ann-empty">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8h1a4 4 0 010 8h-1" />
            <path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z" />
            <line x1="6" y1="1" x2="6" y2="4" />
            <line x1="10" y1="1" x2="10" y2="4" />
            <line x1="14" y1="1" x2="14" y2="4" />
          </svg>
          <p className="ann-empty-text">
            {filter === "all"
              ? "No announcements yet. Create one to notify your tenants."
              : `No ${filter} announcements.`}
          </p>
          {filter === "all" && (
            <button className="btn btn--primary btn--sm" onClick={() => { setEditing(null); setShowModal(true); }}>
              Create your first announcement
            </button>
          )}
        </div>
      ) : (
        <div className="ann-list">
          {filtered.map((a) => (
            <AnnouncementCard
              key={a.id}
              a={a}
              plans={plans}
              onEdit={() => { setEditing(a); setShowModal(true); }}
              onToggle={() => handleToggle(a)}
              toggling={actionLoading === a.id}
            />
          ))}
        </div>
      )}

      {showModal && (
        <AnnouncementModal
          announcement={editing}
          plans={plans}
          onClose={() => setShowModal(false)}
          onSaved={() => {
            setShowModal(false);
            load();
            showToast("success", editing ? "Announcement updated." : "Announcement published.");
          }}
        />
      )}
    </div>
  );
}
