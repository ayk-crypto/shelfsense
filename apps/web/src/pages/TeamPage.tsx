import { useEffect, useRef, useState } from "react";
import { createTeamUser, getTeam } from "../api/team";
import type { CreateTeamUserInput, TeamMember } from "../types";

interface Toast {
  id: number;
  msg: string;
  type: "success" | "error";
}

let toastSeq = 0;

export function TeamPage() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  function showToast(msg: string, type: "success" | "error") {
    const id = ++toastSeq;
    setToasts((prev) => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((toast) => toast.id !== id)), 3500);
  }

  async function loadTeam() {
    try {
      const res = await getTeam();
      setMembers(res.members);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load team");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadTeam(); }, []);

  if (loading) {
    return (
      <div className="page-loading">
        <div className="spinner" />
        <p>Loading team...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-error">
        <div className="alert alert--error">{error}</div>
      </div>
    );
  }

  return (
    <div className="team-page">
      <div className="page-header team-page-header">
        <div>
          <h1 className="page-title">Team</h1>
          <p className="page-subtitle">Manage workspace access</p>
        </div>
        <button className="btn btn--primary" onClick={() => setAddOpen(true)}>
          + Add User
        </button>
      </div>

      {members.length === 0 ? (
        <div className="empty-state">
          <p>No team members found.</p>
        </div>
      ) : (
        <div className="team-list">
          {members.map((member) => (
            <article key={member.userId} className="team-member-card">
              <div>
                <h2 className="team-member-name">{member.name}</h2>
                <p className="team-member-email">{member.email}</p>
              </div>
              <div className="team-member-meta">
                <span className={`badge team-role-badge team-role-badge--${member.role.toLowerCase()}`}>
                  {member.role}
                </span>
                <span className="team-member-date">
                  Added {formatDate(member.createdAt)}
                </span>
              </div>
            </article>
          ))}
        </div>
      )}

      {addOpen && (
        <AddTeamUserModal
          onClose={() => setAddOpen(false)}
          onSuccess={(member) => {
            setAddOpen(false);
            setMembers((prev) => [...prev, member]);
            showToast(`Added ${member.name}`, "success");
            void loadTeam();
          }}
          onError={(msg) => showToast(msg, "error")}
        />
      )}

      <div className="toast-stack">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast--${toast.type}`}>
            {toast.msg}
          </div>
        ))}
      </div>
    </div>
  );
}

function AddTeamUserModal({
  onClose,
  onSuccess,
  onError,
}: {
  onClose: () => void;
  onSuccess: (member: TeamMember) => void;
  onError: (msg: string) => void;
}) {
  const [form, setForm] = useState<CreateTeamUserInput>({
    name: "",
    email: "",
    password: "",
    role: "OPERATOR",
  });
  const [saving, setSaving] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => { firstRef.current?.focus(); }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim() || !form.password.trim()) return;

    setSaving(true);
    try {
      const res = await createTeamUser({
        ...form,
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
      });
      onSuccess(res.user);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to add team member");
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Add User</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="modal-body">
          <form onSubmit={(e) => { void handleSubmit(e); }}>
            <div className="form-group">
              <label className="form-label">Name *</label>
              <input
                ref={firstRef}
                className="form-input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Email *</label>
              <input
                className="form-input"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Password *</label>
              <input
                className="form-input"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Role</label>
              <select
                className="form-select"
                value={form.role}
                onChange={(e) =>
                  setForm({ ...form, role: e.target.value as CreateTeamUserInput["role"] })
                }
              >
                <option value="MANAGER">MANAGER</option>
                <option value="OPERATOR">OPERATOR</option>
              </select>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn--ghost" onClick={onClose}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn--primary"
                disabled={saving || !form.name.trim() || !form.email.trim() || !form.password.trim()}
              >
                {saving ? <span className="btn-spinner" /> : null}
                {saving ? "Adding..." : "Add User"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}
