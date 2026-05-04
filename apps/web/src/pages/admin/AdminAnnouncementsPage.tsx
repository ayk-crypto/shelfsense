import { useEffect, useState } from "react";
import { getAdminAnnouncements, createAdminAnnouncement, updateAdminAnnouncement, updateAdminAnnouncementStatus } from "../../api/admin";
import type { AdminAnnouncement } from "../../types";

const SEVERITY_COLORS: Record<string, string> = {
  INFO: "blue",
  SUCCESS: "active",
  WARNING: "yellow",
  CRITICAL: "suspended",
};

export function AdminAnnouncementsPage() {
  const [announcements, setAnnouncements] = useState<AdminAnnouncement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<AdminAnnouncement | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);

  function load() {
    setLoading(true);
    getAdminAnnouncements()
      .then((r) => setAnnouncements(r.announcements))
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

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Announcements</h1>
          <p className="admin-page-subtitle">In-app notices and banners for users</p>
        </div>
        <button className="btn btn--primary" onClick={() => { setEditing(null); setShowModal(true); }}>
          + New Announcement
        </button>
      </div>

      {toast && (
        <div className={`alert alert--${toast.type === "success" ? "success" : "error"}`} style={{ marginBottom: 16 }}>
          {toast.text}
        </div>
      )}

      {loading ? (
        <div className="admin-loading"><div className="spinner" /></div>
      ) : error ? (
        <div className="alert alert--error">{error}</div>
      ) : announcements.length === 0 ? (
        <p className="admin-empty">No announcements yet.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Severity</th>
                <th>Target</th>
                <th>Period</th>
                <th>Dismissible</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {announcements.map((a) => (
                <tr key={a.id}>
                  <td>
                    <div>{a.title}</div>
                    <div className="admin-muted" style={{ fontSize: 12 }}>{a.message.slice(0, 60)}{a.message.length > 60 ? "…" : ""}</div>
                  </td>
                  <td>
                    <span className={`admin-status-badge admin-status-badge--${SEVERITY_COLORS[a.severity] ?? "gray"}`}>
                      {a.severity}
                    </span>
                  </td>
                  <td className="admin-muted">{a.targetType}</td>
                  <td className="admin-muted">
                    {a.startsAt ? new Date(a.startsAt).toLocaleDateString() : "Now"}
                    {" → "}
                    {a.endsAt ? new Date(a.endsAt).toLocaleDateString() : "∞"}
                  </td>
                  <td className="admin-muted">{a.dismissible ? "Yes" : "No"}</td>
                  <td>
                    {a.isActive
                      ? <span className="admin-status-badge admin-status-badge--active">Active</span>
                      : <span className="admin-status-badge admin-status-badge--suspended">Disabled</span>}
                  </td>
                  <td>
                    <div className="admin-actions">
                      <button className="admin-action-btn" onClick={() => { setEditing(a); setShowModal(true); }}>Edit</button>
                      <button
                        className={`admin-action-btn admin-action-btn--${a.isActive ? "danger" : "success"}`}
                        disabled={actionLoading === a.id}
                        onClick={() => handleToggle(a)}
                      >
                        {a.isActive ? "Disable" : "Enable"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <AnnouncementModal
          announcement={editing}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); load(); showToast("success", editing ? "Announcement updated." : "Announcement created."); }}
        />
      )}
    </div>
  );
}

function AnnouncementModal({ announcement, onClose, onSaved }: {
  announcement: AdminAnnouncement | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setFormState] = useState({
    title: announcement?.title ?? "",
    message: announcement?.message ?? "",
    severity: announcement?.severity ?? "INFO",
    targetType: announcement?.targetType ?? "ALL",
    startsAt: announcement?.startsAt ? announcement.startsAt.slice(0, 16) : "",
    endsAt: announcement?.endsAt ? announcement.endsAt.slice(0, 16) : "",
    dismissible: announcement?.dismissible ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(k: string, v: unknown) { setFormState((f) => ({ ...f, [k]: v })); }

  async function handleSave() {
    if (!form.title.trim() || !form.message.trim()) {
      setError("Title and message are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        ...form,
        startsAt: form.startsAt || null,
        endsAt: form.endsAt || null,
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
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title">{announcement ? "Edit Announcement" : "New Announcement"}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {error && <div className="alert alert--error" style={{ marginBottom: 12 }}>{error}</div>}
          <div className="form-group">
            <label className="form-label">Title *</label>
            <input className="form-input" value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Scheduled maintenance on May 10" />
          </div>
          <div className="form-group">
            <label className="form-label">Message *</label>
            <textarea className="form-input" value={form.message} onChange={(e) => set("message", e.target.value)} rows={3} placeholder="We will be performing maintenance…" />
          </div>
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Severity</label>
              <select className="form-input" value={form.severity} onChange={(e) => set("severity", e.target.value)}>
                <option value="INFO">Info</option>
                <option value="SUCCESS">Success</option>
                <option value="WARNING">Warning</option>
                <option value="CRITICAL">Critical</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Target</label>
              <select className="form-input" value={form.targetType} onChange={(e) => set("targetType", e.target.value)}>
                <option value="ALL">All Users</option>
                <option value="WORKSPACE">Specific Workspace</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Starts At</label>
              <input className="form-input" type="datetime-local" value={form.startsAt} onChange={(e) => set("startsAt", e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Ends At</label>
              <input className="form-input" type="datetime-local" value={form.endsAt} onChange={(e) => set("endsAt", e.target.value)} />
            </div>
          </div>
          <label className="admin-toggle-row" style={{ marginTop: 8 }}>
            <input type="checkbox" checked={form.dismissible} onChange={(e) => set("dismissible", e.target.checked)} />
            Dismissible by users
          </label>
        </div>
        <div className="modal-footer">
          <button className="btn btn--ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn--primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : announcement ? "Save Changes" : "Create Announcement"}
          </button>
        </div>
      </div>
    </div>
  );
}
