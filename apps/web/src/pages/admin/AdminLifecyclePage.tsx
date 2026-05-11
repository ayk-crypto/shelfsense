import { useEffect, useState, useRef, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import {
  getLifecycleStats,
  getLifecycleWorkspaces,
  getWorkspaceLifecycleLogs,
  lifecycleStartTrial,
  lifecycleExtendTrial,
  lifecycleExpireTrial,
  lifecycleMarkDemo,
  lifecycleResetDemo,
  lifecycleArchive,
  lifecycleUnarchive,
  lifecycleSoftDelete,
  lifecycleRestore,
  lifecyclePermanentDelete,
} from "../../api/admin";
import type { LifecycleWorkspace, LifecycleStats, WorkspaceLifecycleLog } from "../../types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function daysUntil(iso: string | null): string {
  if (!iso) return "—";
  const diff = new Date(iso).getTime() - Date.now();
  if (diff < 0) return "Expired";
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  return days === 1 ? "1 day" : `${days} days`;
}

function timeSince(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

const STATUS_META: Record<string, { label: string; cls: string }> = {
  active:        { label: "Active",          cls: "lc-badge--active" },
  trial:         { label: "Trial",           cls: "lc-badge--trial" },
  trial_expiring:{ label: "Trial Expiring",  cls: "lc-badge--trial-expiring" },
  trial_expired: { label: "Trial Expired",   cls: "lc-badge--expired" },
  demo:          { label: "Demo",            cls: "lc-badge--demo" },
  suspended:     { label: "Suspended",       cls: "lc-badge--suspended" },
  archived:      { label: "Archived",        cls: "lc-badge--archived" },
  deleted:       { label: "Soft Deleted",    cls: "lc-badge--deleted" },
};

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? { label: status, cls: "lc-badge--active" };
  return <span className={`lc-badge ${m.cls}`}>{m.label}</span>;
}

// ─── Action label map ─────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  trial_started:          "Trial started",
  trial_extended:         "Trial extended",
  trial_expired_manual:   "Trial expired (manual)",
  marked_as_demo:         "Marked as demo",
  unmarked_as_demo:       "Unmarked as demo",
  demo_reset:             "Demo data reset",
  archived:               "Archived",
  unarchived:             "Restored from archive",
  soft_deleted:           "Soft deleted",
  restored:               "Restored",
};

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  label, value, active, color, onClick,
}: {
  label: string; value: number; active?: boolean; color: string; onClick?: () => void;
}) {
  return (
    <div
      className={`lc-stat${active ? " lc-stat--active" : ""}${onClick ? " lc-stat--clickable" : ""} lc-stat--${color}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") onClick(); } : undefined}
    >
      <div className="lc-stat-value">{value.toLocaleString()}</div>
      <div className="lc-stat-label">{label}</div>
      {active && <div className="lc-stat-dot" />}
    </div>
  );
}

// ─── Lifecycle Logs Panel ─────────────────────────────────────────────────────

function LifecycleLogsPanel({ wsId, onClose }: { wsId: string; onClose: () => void }) {
  const [logs, setLogs] = useState<WorkspaceLifecycleLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getWorkspaceLifecycleLogs(wsId)
      .then((r) => { setLogs(r.logs); })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [wsId]);

  return (
    <div className="lc-logs-overlay" onClick={onClose}>
      <div className="lc-logs-panel" onClick={(e) => e.stopPropagation()}>
        <div className="lc-logs-header">
          <h3 className="lc-logs-title">Lifecycle History</h3>
          <button className="lc-logs-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="16" height="16">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        {loading ? (
          <div className="lc-logs-loading"><div className="spinner spinner--sm" /></div>
        ) : error ? (
          <div className="alert alert--error">{error}</div>
        ) : logs.length === 0 ? (
          <p className="lc-logs-empty">No lifecycle events recorded yet.</p>
        ) : (
          <div className="lc-logs-list">
            {logs.map((log) => (
              <div key={log.id} className="lc-log-item">
                <div className="lc-log-action">{ACTION_LABELS[log.action] ?? log.action}</div>
                {log.note && <div className="lc-log-note">"{log.note}"</div>}
                <div className="lc-log-meta">
                  by <strong>{log.admin.name}</strong> · {fmtDateTime(log.createdAt)}
                </div>
                {log.meta && Object.keys(log.meta).length > 0 && (
                  <details className="lc-log-meta-detail">
                    <summary>Details</summary>
                    <pre className="lc-log-pre">{JSON.stringify(log.meta, null, 2)}</pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Action Modal ─────────────────────────────────────────────────────────────

type ModalAction =
  | { type: "start_trial"; ws: LifecycleWorkspace }
  | { type: "extend_trial"; ws: LifecycleWorkspace }
  | { type: "expire_trial"; ws: LifecycleWorkspace }
  | { type: "mark_demo"; ws: LifecycleWorkspace; flag: boolean }
  | { type: "reset_demo"; ws: LifecycleWorkspace }
  | { type: "archive"; ws: LifecycleWorkspace }
  | { type: "unarchive"; ws: LifecycleWorkspace }
  | { type: "soft_delete"; ws: LifecycleWorkspace }
  | { type: "restore"; ws: LifecycleWorkspace }
  | { type: "permanent_delete"; ws: LifecycleWorkspace };

function ActionModal({
  modal,
  onClose,
  onDone,
  isSuperAdmin,
}: {
  modal: ModalAction;
  onClose: () => void;
  onDone: () => void;
  isSuperAdmin: boolean;
}) {
  const [days, setDays] = useState(14);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [scheduleDays, setScheduleDays] = useState<number | "">("");
  const [confirmPhrase, setConfirmPhrase] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const phraseInputRef = useRef<HTMLInputElement>(null);

  const ws = modal.ws;

  useEffect(() => {
    setTimeout(() => phraseInputRef.current?.focus(), 80);
  }, []);

  const expectedPhrase = modal.type === "permanent_delete"
    ? `permanently delete ${ws.name}`
    : modal.type === "reset_demo"
    ? `reset ${ws.name}`
    : "";

  const needsConfirm = modal.type === "permanent_delete" || modal.type === "reset_demo" || modal.type === "expire_trial";
  const phraseOk = !["permanent_delete", "reset_demo"].includes(modal.type) || confirmPhrase.trim().toLowerCase() === expectedPhrase.toLowerCase();

  async function submit() {
    if (!phraseOk) return;
    setLoading(true);
    setError(null);
    try {
      let r: Record<string, unknown> = {};
      switch (modal.type) {
        case "start_trial":
          r = await lifecycleStartTrial(ws.id, { days, note: note || undefined });
          break;
        case "extend_trial":
          r = await lifecycleExtendTrial(ws.id, { days, reason: reason || undefined, note: note || undefined });
          break;
        case "expire_trial":
          r = await lifecycleExpireTrial(ws.id, { note: note || undefined });
          break;
        case "mark_demo":
          r = await lifecycleMarkDemo(ws.id, { isDemoWorkspace: modal.flag, note: note || undefined });
          break;
        case "reset_demo":
          r = await lifecycleResetDemo(ws.id, { note: note || undefined });
          setResult(r as Record<string, unknown>);
          onDone();
          break;
        case "archive":
          r = await lifecycleArchive(ws.id, { reason: reason || undefined, note: note || undefined });
          break;
        case "unarchive":
          r = await lifecycleUnarchive(ws.id, { note: note || undefined });
          break;
        case "soft_delete":
          r = await lifecycleSoftDelete(ws.id, { reason: reason || undefined, note: note || undefined, scheduleDays: scheduleDays ? Number(scheduleDays) : undefined });
          break;
        case "restore":
          r = await lifecycleRestore(ws.id, { note: note || undefined });
          break;
        case "permanent_delete":
          await lifecyclePermanentDelete(ws.id, { confirmPhrase: confirmPhrase.trim(), reason: reason || undefined });
          onDone();
          onClose();
          return;
      }
      if (modal.type !== "reset_demo") {
        onDone();
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setLoading(false);
    }
  }

  const isDanger = ["expire_trial", "soft_delete", "permanent_delete", "reset_demo", "archive"].includes(modal.type);
  const isSuccess = ["start_trial", "extend_trial", "unarchive", "restore", "mark_demo"].includes(modal.type);

  const titles: Record<string, string> = {
    start_trial: "Start Trial",
    extend_trial: "Extend Trial",
    expire_trial: "Expire Trial",
    mark_demo: modal.type === "mark_demo" && !modal.flag ? "Remove Demo Flag" : "Mark as Demo",
    reset_demo: "Reset Demo Workspace",
    archive: "Archive Workspace",
    unarchive: "Restore from Archive",
    soft_delete: "Soft Delete Workspace",
    restore: "Restore Workspace",
    permanent_delete: "Permanently Delete Workspace",
  };

  const descriptions: Record<string, React.ReactNode> = {
    start_trial: <span>Start a trial period for <strong>{ws.name}</strong>. The workspace will be set to TRIAL status.</span>,
    extend_trial: <span>Extend the trial for <strong>{ws.name}</strong>. Days are added from the current trial end date (or today if expired).</span>,
    expire_trial: <span>Manually expire the trial for <strong>{ws.name}</strong>. The workspace subscription status will be set to EXPIRED.</span>,
    mark_demo: modal.type === "mark_demo" && !modal.flag
      ? <span>Remove the demo flag from <strong>{ws.name}</strong>. It will be treated as a regular workspace.</span>
      : <span>Mark <strong>{ws.name}</strong> as a demo workspace. Demo workspaces can be reset by Super Admins.</span>,
    reset_demo: <span>This will <strong>permanently delete all transactional data</strong> in <strong>{ws.name}</strong> (items, stock, movements, purchases, suppliers). The workspace structure (locations, members, settings) will be preserved.</span>,
    archive: <span>Archive <strong>{ws.name}</strong>. The workspace will be suspended and hidden from normal operations.</span>,
    unarchive: <span>Restore <strong>{ws.name}</strong> from the archive. Access will be re-enabled.</span>,
    soft_delete: <span>Soft-delete <strong>{ws.name}</strong>. The workspace will be suspended and hidden. Data is preserved and can be restored.</span>,
    restore: <span>Restore <strong>{ws.name}</strong> from soft-deleted state. Access and normal operations will resume.</span>,
    permanent_delete: <span><strong>This action is irreversible.</strong> All data for <strong>{ws.name}</strong> will be permanently erased from the database, including all members, items, stock movements, subscriptions, and payments.</span>,
  };

  // If demo reset completed, show the result
  if (result && modal.type === "reset_demo") {
    const deleted = result.deleted as Record<string, number>;
    return (
      <div className="lc-modal-overlay" onClick={onClose}>
        <div className="lc-modal lc-modal--success" onClick={(e) => e.stopPropagation()}>
          <div className="lc-modal-header lc-modal-header--success">
            <span className="lc-modal-icon">✅</span>
            <div>
              <div className="lc-modal-title">Demo Reset Complete</div>
              <div className="lc-modal-sub">{ws.name}</div>
            </div>
          </div>
          <div className="lc-modal-body">
            <p className="lc-modal-desc">The demo workspace has been reset. The following data was deleted:</p>
            <table className="lc-reset-table">
              <tbody>
                {Object.entries(deleted).map(([k, v]) => (
                  <tr key={k}><td className="lc-reset-key">{k}</td><td className="lc-reset-val">{v.toLocaleString()} deleted</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="lc-modal-actions">
            <button className="btn btn--primary btn--sm" onClick={onClose}>Done</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="lc-modal-overlay" onClick={onClose}>
      <div
        className={`lc-modal${isDanger ? " lc-modal--danger" : isSuccess ? " lc-modal--success" : ""}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className={`lc-modal-header${isDanger ? " lc-modal-header--danger" : isSuccess ? " lc-modal-header--success" : ""}`}>
          <span className="lc-modal-icon">{isDanger ? "⚠️" : "✅"}</span>
          <div>
            <div className="lc-modal-title">{titles[modal.type]}</div>
            <div className="lc-modal-sub">{ws.name}</div>
          </div>
          <button className="lc-modal-x" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="16" height="16">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="lc-modal-body">
          <p className="lc-modal-desc">{descriptions[modal.type]}</p>

          {/* Days input for trial actions */}
          {(modal.type === "start_trial" || modal.type === "extend_trial") && (
            <div className="lc-field">
              <label className="lc-label">Number of days</label>
              <input
                type="number"
                className="lc-input"
                min={1}
                max={365}
                value={days}
                onChange={(e) => setDays(Math.max(1, parseInt(e.target.value) || 14))}
              />
              {modal.type === "start_trial" && ws.trialEndsAt && (
                <p className="lc-hint">Current trial ends: {fmtDate(ws.trialEndsAt)}</p>
              )}
              {modal.type === "extend_trial" && ws.trialEndsAt && (
                <p className="lc-hint">
                  Current trial ends: {fmtDate(ws.trialEndsAt)} → will extend to{" "}
                  {fmtDate(new Date(Math.max(new Date(ws.trialEndsAt).getTime(), Date.now()) + days * 86400000).toISOString())}
                </p>
              )}
            </div>
          )}

          {/* Schedule days for soft delete */}
          {modal.type === "soft_delete" && (
            <div className="lc-field">
              <label className="lc-label">Schedule permanent deletion after (days) <span className="lc-opt">optional</span></label>
              <input
                type="number"
                className="lc-input"
                min={1}
                max={3650}
                placeholder="e.g. 30"
                value={scheduleDays}
                onChange={(e) => setScheduleDays(e.target.value ? parseInt(e.target.value) : "")}
              />
              <p className="lc-hint">Leave blank to soft-delete without scheduling permanent deletion.</p>
            </div>
          )}

          {/* Reason field */}
          {["archive", "soft_delete", "extend_trial", "permanent_delete"].includes(modal.type) && (
            <div className="lc-field">
              <label className="lc-label">Reason <span className="lc-opt">optional</span></label>
              <input
                type="text"
                className="lc-input"
                placeholder="e.g. Non-payment, Account closed…"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          )}

          {/* Note field */}
          {!["permanent_delete"].includes(modal.type) && (
            <div className="lc-field">
              <label className="lc-label">Admin note <span className="lc-opt">optional</span></label>
              <textarea
                className="lc-textarea"
                rows={2}
                placeholder="Internal note for audit log…"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          )}

          {/* Confirmation phrase */}
          {["permanent_delete", "reset_demo"].includes(modal.type) && (
            <div className="lc-field">
              <label className="lc-label">
                Type <code className="lc-code">{expectedPhrase}</code> to confirm
              </label>
              <input
                ref={phraseInputRef}
                type="text"
                className={`lc-input${phraseOk && confirmPhrase ? " lc-input--match" : ""}`}
                placeholder={expectedPhrase}
                value={confirmPhrase}
                onChange={(e) => setConfirmPhrase(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && phraseOk && !loading) void submit(); }}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          )}

          {/* Super admin notice for permanent delete */}
          {modal.type === "permanent_delete" && !isSuperAdmin && (
            <div className="alert alert--error" style={{ marginTop: 8 }}>
              Only Super Admins can permanently delete workspaces.
            </div>
          )}

          {error && <div className="alert alert--error" style={{ marginTop: 8 }}>{error}</div>}
        </div>

        <div className="lc-modal-actions">
          <button className="btn btn--ghost btn--sm" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button
            className={`btn btn--sm ${isDanger ? "btn--danger" : "btn--primary"}`}
            disabled={loading || !phraseOk || (modal.type === "permanent_delete" && !isSuperAdmin)}
            onClick={() => void submit()}
          >
            {loading ? "Working…" : titles[modal.type]}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Action Menu ──────────────────────────────────────────────────────────────
// Uses position:fixed for the dropdown so it escapes overflow:hidden table containers.

function ActionMenu({
  ws,
  isSuperAdmin,
  onAction,
}: {
  ws: LifecycleWorkspace;
  isSuperAdmin: boolean;
  onAction: (m: ModalAction) => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  function openMenu() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setMenuPos({
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right,
      });
    }
    setOpen(true);
  }

  function closeMenu() {
    setOpen(false);
    setMenuPos(null);
  }

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (
        !triggerRef.current?.contains(e.target as Node) &&
        !menuRef.current?.contains(e.target as Node)
      ) {
        closeMenu();
      }
    }
    function onScroll() { closeMenu(); }
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  const isDeleted = !!ws.deletedAt;
  const isArchived = !!ws.archivedAt && !isDeleted;
  const isDemo = ws.isDemoWorkspace;
  const hasTrial = !!ws.trialEndsAt;
  const trialActive = hasTrial && new Date(ws.trialEndsAt!) > new Date();

  function item(label: string, action: () => void, danger = false) {
    return (
      <button
        key={label}
        className={`lc-menu-item${danger ? " lc-menu-item--danger" : ""}`}
        onClick={() => { closeMenu(); action(); }}
        type="button"
      >
        {label}
      </button>
    );
  }

  const items = [];

  if (isDeleted) {
    items.push(item("Restore", () => onAction({ type: "restore", ws })));
    if (isSuperAdmin) items.push(item("Permanently Delete", () => onAction({ type: "permanent_delete", ws }), true));
  } else if (isArchived) {
    items.push(item("Restore from Archive", () => onAction({ type: "unarchive", ws })));
    items.push(item("Soft Delete", () => onAction({ type: "soft_delete", ws }), true));
  } else {
    if (!hasTrial || !trialActive) items.push(item("Start Trial", () => onAction({ type: "start_trial", ws })));
    if (hasTrial) items.push(item("Extend Trial", () => onAction({ type: "extend_trial", ws })));
    if (trialActive) items.push(item("Expire Trial", () => onAction({ type: "expire_trial", ws }), true));
    items.push(
      isDemo
        ? item("Remove Demo Flag", () => onAction({ type: "mark_demo", ws, flag: false }))
        : item("Mark as Demo", () => onAction({ type: "mark_demo", ws, flag: true }))
    );
    if (isDemo && isSuperAdmin) items.push(item("Reset Demo Data", () => onAction({ type: "reset_demo", ws }), true));
    items.push(item("Archive", () => onAction({ type: "archive", ws }), true));
    items.push(item("Soft Delete", () => onAction({ type: "soft_delete", ws }), true));
  }

  return (
    <div className="lc-action-wrap">
      <button
        ref={triggerRef}
        className="lc-action-trigger"
        onClick={() => open ? closeMenu() : openMenu()}
        type="button"
        aria-label="Actions"
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
          <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
        </svg>
      </button>
      {open && menuPos && (
        <div
          ref={menuRef}
          className="lc-action-menu"
          style={{ position: "fixed", top: menuPos.top, right: menuPos.right, left: "auto" }}
        >
          {items}
        </div>
      )}
    </div>
  );
}

// ─── Filter Tabs ──────────────────────────────────────────────────────────────

const FILTER_TABS: Array<{ key: string; label: string }> = [
  { key: "all",            label: "All Active" },
  { key: "trial",          label: "Trials" },
  { key: "trial_expiring", label: "Expiring Soon" },
  { key: "trial_expired",  label: "Expired Trials" },
  { key: "inactive",       label: "Inactive" },
  { key: "demo",           label: "Demo" },
  { key: "archived",       label: "Archived" },
  { key: "deleted",        label: "Soft Deleted" },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export function AdminLifecyclePage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.platformRole === "SUPER_ADMIN";

  const [searchParams, setSearchParams] = useSearchParams();
  const [stats, setStats] = useState<LifecycleStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [workspaces, setWorkspaces] = useState<LifecycleWorkspace[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalAction | null>(null);
  const [logsWsId, setLogsWsId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const filter = searchParams.get("filter") ?? "all";
  const page = parseInt(searchParams.get("page") ?? "1", 10);
  const search = searchParams.get("search") ?? "";

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== "page") next.delete("page");
    setSearchParams(next);
  }

  const loadStats = useCallback(() => {
    setStatsLoading(true);
    getLifecycleStats()
      .then((r) => setStats(r.stats))
      .catch(() => {})
      .finally(() => setStatsLoading(false));
  }, []);

  const loadList = useCallback(() => {
    setLoading(true);
    setError(null);
    getLifecycleWorkspaces({ page, filter, search: search || undefined })
      .then((r) => {
        setWorkspaces(r.workspaces);
        setTotal(r.pagination.total);
        setPages(r.pagination.pages);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [page, filter, search]);

  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { loadList(); }, [loadList]);

  function handleDone() {
    loadStats();
    loadList();
  }

  return (
    <div className="admin-page">
      {modal && (
        <ActionModal
          modal={modal}
          onClose={() => setModal(null)}
          onDone={handleDone}
          isSuperAdmin={isSuperAdmin}
        />
      )}
      {logsWsId && (
        <LifecycleLogsPanel wsId={logsWsId} onClose={() => setLogsWsId(null)} />
      )}

      {/* Header */}
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Workspace Lifecycle</h1>
          <p className="admin-page-subtitle">Manage trial periods, demo workspaces, archiving, and deletion</p>
        </div>
      </div>

      {/* Stats strip */}
      <div className="lc-stats-grid">
        {statsLoading ? (
          Array.from({ length: 8 }).map((_, i) => <div key={i} className="lc-stat lc-stat--skeleton" />)
        ) : stats ? (
          <>
            <StatCard label="Total Active" value={stats.total} color="blue" />
            <StatCard label="Active Trials" value={stats.activeTrials} color="teal"
              active={filter === "trial"} onClick={() => setParam("filter", filter === "trial" ? "all" : "trial")} />
            <StatCard label="Expiring Soon" value={stats.expiringTrials} color="yellow"
              active={filter === "trial_expiring"} onClick={() => setParam("filter", filter === "trial_expiring" ? "all" : "trial_expiring")} />
            <StatCard label="Expired Trials" value={stats.expiredTrials} color="orange"
              active={filter === "trial_expired"} onClick={() => setParam("filter", filter === "trial_expired" ? "all" : "trial_expired")} />
            <StatCard label="Inactive (30d)" value={stats.inactive} color="gray"
              active={filter === "inactive"} onClick={() => setParam("filter", filter === "inactive" ? "all" : "inactive")} />
            <StatCard label="Demo" value={stats.demo} color="purple"
              active={filter === "demo"} onClick={() => setParam("filter", filter === "demo" ? "all" : "demo")} />
            <StatCard label="Archived" value={stats.archived} color="slate"
              active={filter === "archived"} onClick={() => setParam("filter", filter === "archived" ? "all" : "archived")} />
            <StatCard label="Soft Deleted" value={stats.softDeleted} color="red"
              active={filter === "deleted"} onClick={() => setParam("filter", filter === "deleted" ? "all" : "deleted")} />
          </>
        ) : null}
      </div>

      {/* Filter tabs + search */}
      <div className="lc-controls">
        <div className="lc-tabs">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.key}
              className={`lc-tab${filter === tab.key ? " lc-tab--active" : ""}`}
              onClick={() => setParam("filter", tab.key)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>

        <form
          className="lc-search-form"
          onSubmit={(e) => {
            e.preventDefault();
            setParam("search", searchRef.current?.value ?? "");
          }}
        >
          <input
            ref={searchRef}
            type="search"
            className="admin-search-input"
            placeholder="Search name or owner email…"
            defaultValue={search}
          />
          <button type="submit" className="btn btn--primary btn--sm">Search</button>
          {search && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => { if (searchRef.current) searchRef.current.value = ""; setParam("search", ""); }}>
              Clear
            </button>
          )}
        </form>
      </div>

      {/* Table */}
      {loading ? (
        <div className="admin-loading"><div className="spinner" /></div>
      ) : error ? (
        <div className="alert alert--error">{error}</div>
      ) : workspaces.length === 0 ? (
        <div className="lc-empty">
          <p>No workspaces match this filter.</p>
        </div>
      ) : (
        <>
          <p className="lc-result-count">{total.toLocaleString()} workspace{total !== 1 ? "s" : ""}</p>

          {/* Desktop table */}
          <div className="admin-table-wrap admin-table-wrap--desktop">
            <table className="admin-table lc-table">
              <thead>
                <tr>
                  <th>Workspace</th>
                  <th>Status</th>
                  <th>Trial / Expiry</th>
                  <th>Last Activity</th>
                  <th>Items</th>
                  <th>Members</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {workspaces.map((ws) => (
                  <tr
                    key={ws.id}
                    className={
                      ws.deletedAt ? "lc-row--deleted"
                      : ws.archivedAt ? "lc-row--archived"
                      : ws.isDemoWorkspace ? "lc-row--demo"
                      : ""
                    }
                  >
                    <td>
                      <div className="lc-ws-name">
                        <Link to={`/admin/workspaces/${ws.id}`} className="admin-link">{ws.name}</Link>
                        {ws.isDemoWorkspace && <span className="lc-demo-chip">DEMO</span>}
                      </div>
                      <div className="admin-muted">{ws.owner.email}</div>
                      <div className="admin-muted" style={{ fontSize: 11 }}>
                        <span className={`admin-plan-badge admin-plan-badge--${ws.plan.toLowerCase()}`}>{ws.plan}</span>
                      </div>
                    </td>
                    <td><StatusBadge status={ws.lifecycleStatus} /></td>
                    <td>
                      {ws.trialEndsAt ? (
                        <div>
                          <div className="lc-trial-until">Ends {fmtDate(ws.trialEndsAt)}</div>
                          <div className={`lc-trial-remaining ${new Date(ws.trialEndsAt) < new Date() ? "lc-trial-remaining--expired" : ""}`}>
                            {daysUntil(ws.trialEndsAt)}
                          </div>
                          {ws.trialExtendedAt && (
                            <div className="admin-muted" style={{ fontSize: 11 }}>Extended {timeSince(ws.trialExtendedAt)}</div>
                          )}
                        </div>
                      ) : ws.archivedAt ? (
                        <span className="admin-muted">Archived {fmtDate(ws.archivedAt)}</span>
                      ) : ws.deletedAt ? (
                        <div>
                          <div className="admin-muted">Deleted {fmtDate(ws.deletedAt)}</div>
                          {ws.deletionScheduledAt && (
                            <div className="lc-sched-delete">Perm. deletion {fmtDate(ws.deletionScheduledAt)}</div>
                          )}
                        </div>
                      ) : (
                        <span className="admin-muted">—</span>
                      )}
                    </td>
                    <td>
                      <div>{ws.lastActivityAt ? timeSince(ws.lastActivityAt) : "No activity"}</div>
                      {ws.stockMovementCount > 0 && (
                        <div className="admin-muted">{ws.stockMovementCount.toLocaleString()} movements</div>
                      )}
                    </td>
                    <td>{ws.itemCount.toLocaleString()}</td>
                    <td>{ws.memberCount}</td>
                    <td className="admin-muted">{fmtDate(ws.createdAt)}</td>
                    <td>
                      <div className="lc-actions-cell">
                        <button
                          className="admin-action-btn"
                          onClick={() => setLogsWsId(ws.id)}
                          type="button"
                          title="View lifecycle history"
                        >
                          History
                        </button>
                        <ActionMenu ws={ws} isSuperAdmin={isSuperAdmin} onAction={setModal} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="admin-mobile-cards">
            {workspaces.map((ws) => (
              <div
                key={ws.id}
                className={`lc-mobile-card${ws.deletedAt ? " lc-mobile-card--deleted" : ws.archivedAt ? " lc-mobile-card--archived" : ""}`}
              >
                <div className="lc-mobile-card-top">
                  <div className="lc-mobile-card-avatar">{ws.name.slice(0, 2).toUpperCase()}</div>
                  <div className="lc-mobile-card-info">
                    <Link to={`/admin/workspaces/${ws.id}`} className="admin-link lc-mobile-card-name">{ws.name}</Link>
                    <div className="admin-muted">{ws.owner.email}</div>
                  </div>
                  <StatusBadge status={ws.lifecycleStatus} />
                </div>

                <div className="lc-mobile-card-row">
                  <span className="lc-mobile-label">Trial</span>
                  <span>{ws.trialEndsAt ? `${daysUntil(ws.trialEndsAt)} (${fmtDate(ws.trialEndsAt)})` : "—"}</span>
                </div>
                <div className="lc-mobile-card-row">
                  <span className="lc-mobile-label">Last activity</span>
                  <span>{ws.lastActivityAt ? timeSince(ws.lastActivityAt) : "None"}</span>
                </div>
                <div className="lc-mobile-card-row">
                  <span className="lc-mobile-label">Items / Members</span>
                  <span>{ws.itemCount} / {ws.memberCount}</span>
                </div>

                <div className="lc-mobile-card-actions">
                  <button className="admin-action-btn" onClick={() => setLogsWsId(ws.id)} type="button">History</button>
                  <ActionMenu ws={ws} isSuperAdmin={isSuperAdmin} onAction={setModal} />
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {pages > 1 && (
            <div className="admin-pagination">
              <button className="btn btn--ghost btn--sm" disabled={page <= 1} onClick={() => setParam("page", String(page - 1))}>
                ← Prev
              </button>
              <span className="admin-pagination-info">Page {page} of {pages}</span>
              <button className="btn btn--ghost btn--sm" disabled={page >= pages} onClick={() => setParam("page", String(page + 1))}>
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
