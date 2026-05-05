import { useEffect, useState } from "react";
import { getAdminTeam, updateUserPlatformRole, getAdminUsers } from "../../api/admin";
import { useAuth } from "../../context/AuthContext";
import type { AdminUser } from "../../types";

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  SUPPORT_ADMIN: "Support Admin",
};

export function AdminTeamPage() {
  const { user: currentUser } = useAuth();
  const isSuperAdmin = currentUser?.platformRole === "SUPER_ADMIN";
  const [members, setMembers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [showPromoteModal, setShowPromoteModal] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  function load() {
    setLoading(true);
    getAdminTeam()
      .then((r) => setMembers(r.members))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load team"))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  function showToast(type: "success" | "error", text: string) {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3500);
  }

  async function handleRoleChange(
    member: AdminUser,
    newRole: "SUPER_ADMIN" | "SUPPORT_ADMIN" | "USER",
  ) {
    if (!isSuperAdmin) return;
    const actionLabel =
      newRole === "USER"
        ? `remove admin access from ${member.name}`
        : `change ${member.name}'s role to ${ROLE_LABELS[newRole]}`;
    if (!window.confirm(`Are you sure you want to ${actionLabel}?`)) return;
    setActionLoading(member.id);
    try {
      await updateUserPlatformRole(member.id, newRole);
      showToast("success", "Role updated successfully.");
      load();
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : "Failed to update role");
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Admin Team</h1>
          <p className="admin-page-subtitle">
            Manage platform administrators and their access levels
          </p>
        </div>
        {isSuperAdmin && (
          <button className="btn btn--primary" onClick={() => setShowPromoteModal(true)}>
            + Add Admin Member
          </button>
        )}
      </div>

      {toast && (
        <div
          className={`alert alert--${toast.type === "success" ? "success" : "error"}`}
          style={{ marginBottom: 16 }}
        >
          {toast.text}
        </div>
      )}

      <div className="admin-team-info-bar">
        <div className="admin-team-role-pill admin-team-role-pill--super">
          <strong>Super Admin</strong> — Full platform access: billing, plans, system settings,
          and admin team management.
        </div>
        <div className="admin-team-role-pill admin-team-role-pill--support">
          <strong>Support Admin</strong> — View workspaces and users, manage support tickets and
          communications.
        </div>
      </div>

      {loading ? (
        <div className="admin-loading">
          <div className="spinner" />
        </div>
      ) : error ? (
        <div className="alert alert--error">{error}</div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Member Since</th>
                {isSuperAdmin && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className={m.isDisabled ? "admin-row--suspended" : ""}>
                  <td>
                    <strong>{m.name}</strong>
                    {m.id === currentUser?.id && (
                      <span className="admin-team-you-badge"> (you)</span>
                    )}
                  </td>
                  <td>{m.email}</td>
                  <td>
                    <span
                      className={`admin-status-badge ${
                        m.platformRole === "SUPER_ADMIN"
                          ? "admin-status-badge--active"
                          : "admin-status-badge--pending"
                      }`}
                    >
                      {ROLE_LABELS[m.platformRole] ?? m.platformRole}
                    </span>
                  </td>
                  <td>
                    {m.isDisabled ? (
                      <span className="admin-status-badge admin-status-badge--suspended">
                        Disabled
                      </span>
                    ) : (
                      <span className="admin-status-badge admin-status-badge--active">
                        Active
                      </span>
                    )}
                  </td>
                  <td className="admin-muted">
                    {new Date(m.createdAt).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </td>
                  {isSuperAdmin && (
                    <td>
                      {m.id !== currentUser?.id ? (
                        <div className="admin-actions">
                          {m.platformRole === "SUPPORT_ADMIN" && (
                            <button
                              className="admin-action-btn"
                              disabled={actionLoading === m.id}
                              onClick={() => handleRoleChange(m, "SUPER_ADMIN")}
                            >
                              Promote to Super Admin
                            </button>
                          )}
                          {m.platformRole === "SUPER_ADMIN" && (
                            <button
                              className="admin-action-btn"
                              disabled={actionLoading === m.id}
                              onClick={() => handleRoleChange(m, "SUPPORT_ADMIN")}
                            >
                              Downgrade to Support
                            </button>
                          )}
                          <button
                            className="admin-action-btn admin-action-btn--danger"
                            disabled={actionLoading === m.id}
                            onClick={() => handleRoleChange(m, "USER")}
                          >
                            {actionLoading === m.id ? "…" : "Remove Admin Access"}
                          </button>
                        </div>
                      ) : (
                        <span className="admin-muted" style={{ fontSize: 12 }}>
                          Your account
                        </span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
              {members.length === 0 && (
                <tr>
                  <td colSpan={isSuperAdmin ? 6 : 5} style={{ textAlign: "center", padding: "32px 0", color: "#94a3b8" }}>
                    No admin team members found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showPromoteModal && isSuperAdmin && (
        <PromoteModal
          onClose={() => setShowPromoteModal(false)}
          onSaved={() => {
            setShowPromoteModal(false);
            load();
            showToast("success", "User successfully promoted to admin.");
          }}
        />
      )}
    </div>
  );
}

function PromoteModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"SUPER_ADMIN" | "SUPPORT_ADMIN">("SUPPORT_ADMIN");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!email.trim()) {
      setError("Email address is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await getAdminUsers({ search: email.trim() });
      const found = res.users.find(
        (u) => u.email.toLowerCase() === email.trim().toLowerCase(),
      );
      if (!found) {
        setError(
          "No account found with that email address. The user must already have a ShelfSense account.",
        );
        setSaving(false);
        return;
      }
      if (found.platformRole !== "USER") {
        setError(
          "This user already has an admin role. Use the role actions in the team table to change their existing role.",
        );
        setSaving(false);
        return;
      }
      await updateUserPlatformRole(found.id, role);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to promote user");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title">Add Admin Member</h2>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: 13, color: "#64748b", marginBottom: 16 }}>
            Promote an existing ShelfSense user to a platform admin role by entering their
            registered email address.
          </p>
          {error && (
            <div className="alert alert--error" style={{ marginBottom: 12 }}>
              {error}
            </div>
          )}
          <div className="form-group">
            <label className="form-label">User Email *</label>
            <input
              className="form-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@example.com"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && !saving && handleSave()}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Admin Role *</label>
            <select
              className="form-input"
              value={role}
              onChange={(e) =>
                setRole(e.target.value as "SUPER_ADMIN" | "SUPPORT_ADMIN")
              }
            >
              <option value="SUPPORT_ADMIN">
                Support Admin — View workspaces, users, and manage support tickets
              </option>
              <option value="SUPER_ADMIN">
                Super Admin — Full platform access including billing and system settings
              </option>
            </select>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn--ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn--primary" onClick={handleSave} disabled={saving}>
            {saving ? "Promoting…" : "Promote to Admin"}
          </button>
        </div>
      </div>
    </div>
  );
}
