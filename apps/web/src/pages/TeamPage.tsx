import { useEffect, useMemo, useRef, useState } from "react";
import {
  createTeamUser,
  deactivateTeamUser,
  getTeam,
  reactivateTeamUser,
  updateTeamUser,
} from "../api/team";
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
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const activeCount = useMemo(
    () => members.filter((member) => member.isActive).length,
    [members],
  );
  const inactiveCount = members.length - activeCount;
  const managerCount = members.filter((member) => member.role === "MANAGER" && member.isActive).length;
  const operatorCount = members.filter((member) => member.role === "OPERATOR" && member.isActive).length;

  function showToast(msg: string, type: "success" | "error") {
    const id = ++toastSeq;
    setToasts((prev) => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((toast) => toast.id !== id)), 3500);
  }

  async function loadTeam(nextShowInactive = showInactive) {
    try {
      const res = await getTeam(nextShowInactive);
      setMembers(res.members);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load team");
    } finally {
      setLoading(false);
    }
  }

  async function handleDeactivate(member: TeamMember) {
    if (!window.confirm(`Deactivate access for ${member.name}?`)) return;

    try {
      await deactivateTeamUser(member.userId);
      showToast(`Deactivated ${member.name}`, "success");
      await loadTeam();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to deactivate user", "error");
    }
  }

  async function handleReactivate(member: TeamMember) {
    try {
      await reactivateTeamUser(member.userId);
      showToast(`Reactivated ${member.name}`, "success");
      await loadTeam(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to reactivate user", "error");
    }
  }

  useEffect(() => { void loadTeam(showInactive); }, [showInactive]);

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
          <p className="page-subtitle">Manage workspace access, roles, and team lifecycle.</p>
        </div>
        <div className="page-header-actions">
          <button
            className="btn btn--secondary"
            onClick={() => setShowInactive((value) => !value)}
          >
            {showInactive ? "Hide inactive" : "Show inactive"}
          </button>
          <button className="btn btn--primary" onClick={() => setAddOpen(true)}>
            + Add User
          </button>
        </div>
      </div>

      <div className="ops-metric-strip" aria-live="polite" aria-label="Team summary">
        <div className="ops-metric">
          <span className="ops-metric-label">Active users</span>
          <strong className="ops-metric-value">{activeCount}</strong>
        </div>
        <div className="ops-metric">
          <span className="ops-metric-label">Managers</span>
          <strong className="ops-metric-value">{managerCount}</strong>
        </div>
        <div className="ops-metric">
          <span className="ops-metric-label">Operators</span>
          <strong className="ops-metric-value">{operatorCount}</strong>
        </div>
        <div className="ops-metric">
          <span className="ops-metric-label">Inactive</span>
          <strong className="ops-metric-value">{inactiveCount}</strong>
        </div>
      </div>

      {members.length === 0 ? (
        <div className="empty-state">
          <p>No team members found.</p>
        </div>
      ) : (
        <div className="team-list">
          {members.map((member) => (
            <article key={member.userId} className={`team-member-card ${!member.isActive ? "is-muted" : ""}`}>
              <div>
                <h2 className="team-member-name">{member.name}</h2>
                <p className="team-member-email">{member.email}</p>
              </div>
              <div className="team-member-meta">
                <span className={`badge team-role-badge team-role-badge--${member.role.toLowerCase()}`}>
                  {member.role}
                </span>
                <span className={`badge ${member.isActive ? "badge--green" : "badge--gray"}`}>
                  {member.isActive ? "Active" : "Inactive"}
                </span>
                <span className="team-member-date">
                  Added {formatDate(member.createdAt)}
                </span>
              </div>
              <div className="lifecycle-actions">
                {member.role !== "OWNER" ? (
                  <>
                    <button className="btn btn--sm btn--secondary" onClick={() => setEditingMember(member)}>
                      Edit
                    </button>
                    {member.isActive ? (
                      <button className="btn btn--sm btn--danger" onClick={() => { void handleDeactivate(member); }}>
                        Deactivate
                      </button>
                    ) : (
                      <button className="btn btn--sm btn--primary" onClick={() => { void handleReactivate(member); }}>
                        Reactivate
                      </button>
                    )}
                  </>
                ) : (
                  <span className="form-helper">Owner access is protected.</span>
                )}
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

      {editingMember && (
        <EditTeamUserModal
          member={editingMember}
          onClose={() => setEditingMember(null)}
          onSuccess={(member) => {
            setEditingMember(null);
            showToast(`Updated ${member.name}`, "success");
            void loadTeam(showInactive);
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
    <TeamModal title="Add User" onClose={onClose}>
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
        <RoleSelect value={form.role} onChange={(role) => setForm({ ...form, role })} />
        <ModalActions onClose={onClose} saving={saving} disabled={!form.name.trim() || !form.email.trim() || !form.password.trim()} label="Add User" savingLabel="Adding..." />
      </form>
    </TeamModal>
  );
}

function EditTeamUserModal({
  member,
  onClose,
  onSuccess,
  onError,
}: {
  member: TeamMember;
  onClose: () => void;
  onSuccess: (member: TeamMember) => void;
  onError: (msg: string) => void;
}) {
  const [form, setForm] = useState({ name: member.name, role: member.role as CreateTeamUserInput["role"] });
  const [saving, setSaving] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => { firstRef.current?.focus(); }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;

    setSaving(true);
    try {
      const res = await updateTeamUser(member.userId, {
        name: form.name.trim(),
        role: form.role,
      });
      onSuccess(res.user);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to update team member");
      setSaving(false);
    }
  }

  return (
    <TeamModal title="Edit Team Member" onClose={onClose}>
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
        <RoleSelect value={form.role} onChange={(role) => setForm({ ...form, role })} />
        <ModalActions onClose={onClose} saving={saving} disabled={!form.name.trim()} label="Save changes" savingLabel="Saving..." />
      </form>
    </TeamModal>
  );
}

function TeamModal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function RoleSelect({ value, onChange }: { value: CreateTeamUserInput["role"]; onChange: (role: CreateTeamUserInput["role"]) => void }) {
  return (
    <div className="form-group">
      <label className="form-label">Role</label>
      <select className="form-select" value={value} onChange={(e) => onChange(e.target.value as CreateTeamUserInput["role"])}>
        <option value="MANAGER">MANAGER</option>
        <option value="OPERATOR">OPERATOR</option>
      </select>
    </div>
  );
}

function ModalActions({ onClose, saving, disabled, label, savingLabel }: { onClose: () => void; saving: boolean; disabled: boolean; label: string; savingLabel: string }) {
  return (
    <div className="modal-footer">
      <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
      <button type="submit" className="btn btn--primary" disabled={saving || disabled}>
        {saving ? <span className="btn-spinner" /> : null}
        {saving ? savingLabel : label}
      </button>
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
