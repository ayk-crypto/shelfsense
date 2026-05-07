import { useEffect, useMemo, useRef, useState } from "react";
import { ConfirmModal } from "../components/ConfirmModal";
import type { ConfirmOptions } from "../components/ConfirmModal";
import {
  createCustomRole,
  createTeamUser,
  deactivateTeamUser,
  deleteCustomRole,
  getCustomRoles,
  getTeam,
  reactivateTeamUser,
  updateCustomRole,
  updateTeamUser,
} from "../api/team";
import { usePlanFeatures } from "../context/PlanFeaturesContext";
import { PlanFeatureGate } from "../components/PlanFeatureGate";
import type { CreateCustomRoleInput, CreateTeamUserInput, CustomRole, Permission, TeamMember } from "../types";
import { MANAGER_PERMISSIONS, OPERATOR_PERMISSIONS, PERMISSION_DEFS } from "../types";

const ROLE_COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#ef4444",
  "#f97316", "#eab308", "#22c55e", "#06b6d4",
];

interface Toast { id: number; msg: string; type: "success" | "error" }
let toastSeq = 0;

type Tab = "members" | "roles";

export function TeamPage() {
  const features = usePlanFeatures();
  const [tab, setTab] = useState<Tab>("members");
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [customRoles, setCustomRoles] = useState<CustomRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [editingRole, setEditingRole] = useState<CustomRole | null>(null);
  const [creatingRole, setCreatingRole] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [confirmOpts, setConfirmOpts] = useState<ConfirmOptions | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const activeCount = useMemo(() => members.filter((m) => m.isActive).length, [members]);
  const inactiveCount = members.length - activeCount;
  const managerCount = members.filter((m) => m.role === "MANAGER" && m.isActive).length;
  const operatorCount = members.filter((m) => m.role === "OPERATOR" && m.isActive).length;

  function showToast(msg: string, type: "success" | "error") {
    const id = ++toastSeq;
    setToasts((prev) => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  }

  async function loadAll(nextShowInactive = showInactive) {
    try {
      const [teamRes, rolesRes] = await Promise.all([
        getTeam(nextShowInactive),
        getCustomRoles(),
      ]);
      setMembers(teamRes.members);
      setCustomRoles(rolesRes.customRoles);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load team");
    } finally {
      setLoading(false);
    }
  }

  function handleDeactivate(member: TeamMember) {
    setConfirmOpts({
      title: `Deactivate ${member.name}?`,
      message: "They will immediately lose access to this workspace. You can reactivate them at any time.",
      confirmLabel: "Deactivate",
      variant: "warning",
      onConfirm: async () => {
        setConfirmOpts(null);
        try {
          await deactivateTeamUser(member.userId);
          showToast(`Deactivated ${member.name}`, "success");
          await loadAll();
        } catch (err) {
          showToast(err instanceof Error ? err.message : "Failed to deactivate user", "error");
        }
      },
      onCancel: () => setConfirmOpts(null),
    });
  }

  async function handleReactivate(member: TeamMember) {
    try {
      await reactivateTeamUser(member.userId);
      showToast(`Reactivated ${member.name}`, "success");
      await loadAll(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to reactivate user", "error");
    }
  }

  function handleDeleteRole(role: CustomRole) {
    const message = role.memberCount > 0
      ? `${role.memberCount} member${role.memberCount === 1 ? "" : "s"} will revert to their base access level.`
      : "This action cannot be undone.";
    setConfirmOpts({
      title: `Delete role "${role.name}"?`,
      message,
      confirmLabel: "Delete",
      variant: "danger",
      onConfirm: async () => {
        setConfirmOpts(null);
        try {
          await deleteCustomRole(role.id);
          setCustomRoles((prev) => prev.filter((r) => r.id !== role.id));
          showToast(`Deleted role "${role.name}"`, "success");
          await loadAll();
        } catch (err) {
          showToast(err instanceof Error ? err.message : "Failed to delete role", "error");
        }
      },
      onCancel: () => setConfirmOpts(null),
    });
  }

  useEffect(() => { void loadAll(showInactive); }, [showInactive]);

  if (loading) {
    return (
      <div className="page-loading">
        <div className="spinner" />
        <p>Loading team...</p>
      </div>
    );
  }

  if (error) {
    return <div className="page-error"><div className="alert alert--error">{error}</div></div>;
  }

  return (
    <div className="team-page">
      <div className="page-header team-page-header">
        <div>
          <h1 className="page-title">Team</h1>
          <p className="page-subtitle">Manage workspace access, roles, and team lifecycle.</p>
        </div>
        <div className="page-header-actions">
          {tab === "members" && (
            <>
              <button className="btn btn--secondary" onClick={() => setShowInactive((v) => !v)}>
                {showInactive ? "Hide inactive" : "Show inactive"}
              </button>
              {features.enableTeamManagement && (
                <button className="btn btn--primary" onClick={() => setAddOpen(true)}>
                  + Add User
                </button>
              )}
              {!features.enableTeamManagement && !features.isLoading && (
                <button className="btn btn--primary" onClick={() => window.location.href = "/billing/checkout?plan=STARTER"}>
                  Upgrade to Add Users
                </button>
              )}
            </>
          )}
          {tab === "roles" && features.enableCustomRoles && (
            <button className="btn btn--primary" onClick={() => setCreatingRole(true)}>
              + Create Role
            </button>
          )}
        </div>
      </div>

      <div className="team-tabs">
        <button
          className={`team-tab${tab === "members" ? " team-tab--active" : ""}`}
          onClick={() => setTab("members")}
        >
          Members
          <span className="team-tab-count">{activeCount}</span>
        </button>
        <button
          className={`team-tab${tab === "roles" ? " team-tab--active" : ""}`}
          onClick={() => setTab("roles")}
        >
          Custom Roles
          <span className="team-tab-count">{customRoles.length}</span>
        </button>
      </div>

      {tab === "members" && (
        <>
          <div className="ops-metric-strip" aria-live="polite">
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
            <div className="empty-state"><p>No team members found.</p></div>
          ) : (
            <div className="team-list">
              {members.map((member) => (
                <MemberCard
                  key={member.userId}
                  member={member}
                  onEdit={() => setEditingMember(member)}
                  onDeactivate={() => { void handleDeactivate(member); }}
                  onReactivate={() => { void handleReactivate(member); }}
                />
              ))}
            </div>
          )}
        </>
      )}

      {tab === "roles" && !features.enableCustomRoles && (
        <PlanFeatureGate feature="enableCustomRoles" inline>{null}</PlanFeatureGate>
      )}

      {tab === "roles" && (features.enableCustomRoles || features.isLoading) && (
        <div className="roles-tab">
          {customRoles.length === 0 ? (
            <div className="roles-empty-state">
              <div className="roles-empty-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.745 3.745 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.745 3.745 0 013.296-1.043A3.745 3.745 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.745 3.745 0 013.296 1.043 3.745 3.745 0 011.043 3.296A3.745 3.745 0 0121 12z" />
                </svg>
              </div>
              <h3>No custom roles yet</h3>
              <p>Create named roles like "Chef" or "Cashier" and define exactly which features each one can access.</p>
              <button className="btn btn--primary" onClick={() => setCreatingRole(true)}>
                + Create your first role
              </button>
            </div>
          ) : (
            <div className="custom-roles-grid">
              {customRoles.map((role) => (
                <CustomRoleCard
                  key={role.id}
                  role={role}
                  onEdit={() => setEditingRole(role)}
                  onDelete={() => { void handleDeleteRole(role); }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {addOpen && (
        <AddTeamUserModal
          customRoles={customRoles}
          onClose={() => setAddOpen(false)}
          onSuccess={(member) => {
            setAddOpen(false);
            showToast(`Added ${member.name}`, "success");
            void loadAll();
          }}
          onError={(msg) => showToast(msg, "error")}
        />
      )}

      {editingMember && (
        <EditTeamUserModal
          member={editingMember}
          customRoles={customRoles}
          onClose={() => setEditingMember(null)}
          onSuccess={(member) => {
            setEditingMember(null);
            showToast(`Updated ${member.name}`, "success");
            void loadAll(showInactive);
          }}
          onError={(msg) => showToast(msg, "error")}
        />
      )}

      {creatingRole && (
        <RoleBuilderModal
          onClose={() => setCreatingRole(false)}
          onSuccess={(role) => {
            setCreatingRole(false);
            setCustomRoles((prev) => [...prev, role]);
            showToast(`Created role "${role.name}"`, "success");
          }}
          onError={(msg) => showToast(msg, "error")}
        />
      )}

      {editingRole && (
        <RoleBuilderModal
          role={editingRole}
          onClose={() => setEditingRole(null)}
          onSuccess={(role) => {
            setEditingRole(null);
            setCustomRoles((prev) => prev.map((r) => (r.id === role.id ? role : r)));
            showToast(`Updated role "${role.name}"`, "success");
          }}
          onError={(msg) => showToast(msg, "error")}
        />
      )}

      {confirmOpts && <ConfirmModal {...confirmOpts} />}

      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.type}`}>{t.msg}</div>
        ))}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════
   MEMBER CARD
════════════════════════════════════════════ */

function MemberCard({ member, onEdit, onDeactivate, onReactivate }: {
  member: TeamMember;
  onEdit: () => void;
  onDeactivate: () => void;
  onReactivate: () => void;
}) {
  const initials = member.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <article className={`team-member-card${!member.isActive ? " is-muted" : ""}`}>
      <div className="team-member-avatar" style={member.customRoleColor ? { background: member.customRoleColor + "22", color: member.customRoleColor } : {}}>
        {initials}
      </div>
      <div className="team-member-info">
        <h2 className="team-member-name">{member.name}</h2>
        <p className="team-member-email">{member.email}</p>
        <div className="team-member-badges">
          {member.customRoleName ? (
            <>
              <span
                className="badge team-custom-role-badge"
                style={{ background: (member.customRoleColor ?? "#6366f1") + "22", color: member.customRoleColor ?? "#6366f1", borderColor: (member.customRoleColor ?? "#6366f1") + "44" }}
              >
                <span className="role-dot" style={{ background: member.customRoleColor ?? "#6366f1" }} />
                {member.customRoleName}
              </span>
              <span className="badge badge--base-role">{member.role}</span>
            </>
          ) : (
            <span className={`badge team-role-badge team-role-badge--${member.role.toLowerCase()}`}>
              {member.role}
            </span>
          )}
          <span className={`badge ${member.isActive ? "badge--green" : "badge--gray"}`}>
            {member.isActive ? "Active" : "Inactive"}
          </span>
        </div>
      </div>
      <div className="team-member-side">
        <span className="team-member-date">Added {formatDate(member.createdAt)}</span>
        <div className="lifecycle-actions">
          {member.role !== "OWNER" ? (
            <>
              <button className="btn btn--sm btn--secondary" onClick={onEdit}>Edit</button>
              {member.isActive ? (
                <button className="btn btn--sm btn--danger" onClick={onDeactivate}>Deactivate</button>
              ) : (
                <button className="btn btn--sm btn--primary" onClick={onReactivate}>Reactivate</button>
              )}
            </>
          ) : (
            <span className="form-helper">Owner access is protected.</span>
          )}
        </div>
      </div>
    </article>
  );
}

/* ════════════════════════════════════════════
   CUSTOM ROLE CARD
════════════════════════════════════════════ */

function CustomRoleCard({ role, onEdit, onDelete }: { role: CustomRole; onEdit: () => void; onDelete: () => void }) {
  const groups = groupPermissions(role.permissions);

  return (
    <div className="custom-role-card" style={{ borderLeftColor: role.color }}>
      <div className="custom-role-card-header">
        <div className="custom-role-card-title">
          <span className="role-dot role-dot--lg" style={{ background: role.color }} />
          <h3>{role.name}</h3>
        </div>
        <div className="custom-role-card-actions">
          <button className="btn btn--sm btn--secondary" onClick={onEdit}>Edit</button>
          <button className="btn btn--sm btn--danger" onClick={onDelete}>Delete</button>
        </div>
      </div>
      <div className="custom-role-card-meta">
        <span className={`badge team-role-badge team-role-badge--${role.baseRole.toLowerCase()}`} style={{ fontSize: "0.7rem" }}>
          {role.baseRole} base
        </span>
        <span className="custom-role-member-count">
          {role.memberCount} {role.memberCount === 1 ? "member" : "members"}
        </span>
      </div>
      <div className="custom-role-permissions">
        {groups.map(({ group, items }) => (
          <div key={group} className="custom-role-perm-group">
            <span className="custom-role-perm-group-label">{group}</span>
            <div className="custom-role-perm-chips">
              {items.map((p) => (
                <span key={p.key} className="custom-role-perm-chip">{p.label}</span>
              ))}
            </div>
          </div>
        ))}
        {role.permissions.length === 0 && (
          <p className="custom-role-no-perms">No permissions assigned</p>
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════
   ROLE BUILDER MODAL
════════════════════════════════════════════ */

function RoleBuilderModal({ role, onClose, onSuccess, onError }: {
  role?: CustomRole;
  onClose: () => void;
  onSuccess: (role: CustomRole) => void;
  onError: (msg: string) => void;
}) {
  const isEdit = !!role;
  const [form, setForm] = useState<CreateCustomRoleInput>({
    name: role?.name ?? "",
    color: role?.color ?? ROLE_COLORS[0],
    baseRole: role?.baseRole ?? "OPERATOR",
    permissions: role?.permissions ?? [...OPERATOR_PERMISSIONS],
  });
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { nameRef.current?.focus(); }, []);

  const availablePerms = form.baseRole === "MANAGER" ? MANAGER_PERMISSIONS : OPERATOR_PERMISSIONS;

  function togglePerm(key: Permission) {
    setForm((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(key)
        ? prev.permissions.filter((p) => p !== key)
        : [...prev.permissions, key],
    }));
  }

  function handleBaseRoleChange(base: "MANAGER" | "OPERATOR") {
    const allowed = base === "MANAGER" ? MANAGER_PERMISSIONS : OPERATOR_PERMISSIONS;
    setForm((prev) => ({
      ...prev,
      baseRole: base,
      permissions: prev.permissions.filter((p) => allowed.includes(p)),
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (isEdit && role) {
        const res = await updateCustomRole(role.id, form);
        onSuccess({ ...res.customRole, memberCount: role.memberCount });
      } else {
        const res = await createCustomRole(form);
        onSuccess(res.customRole);
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to save role");
      setSaving(false);
    }
  }

  const groups = groupPermissionDefs();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{isEdit ? `Edit "${role!.name}"` : "Create Custom Role"}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="modal-body">
          <form onSubmit={(e) => { void handleSubmit(e); }}>
            <div className="role-builder-top">
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Role Name *</label>
                <input
                  ref={nameRef}
                  className="form-input"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Chef, Cashier, Warehouse Lead"
                  maxLength={60}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Color</label>
                <div className="role-color-picker">
                  {ROLE_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`role-color-swatch${form.color === c ? " role-color-swatch--selected" : ""}`}
                      style={{ background: c }}
                      onClick={() => setForm({ ...form, color: c })}
                      aria-label={c}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Base Access Level</label>
              <p className="form-helper" style={{ marginBottom: "0.5rem" }}>
                Sets the underlying system permissions for API security. Custom permissions below control which features are visible in the app.
              </p>
              <div className="base-role-options">
                {(["MANAGER", "OPERATOR"] as const).map((br) => (
                  <label key={br} className={`base-role-option${form.baseRole === br ? " base-role-option--selected" : ""}`}>
                    <input type="radio" name="baseRole" value={br} checked={form.baseRole === br} onChange={() => handleBaseRoleChange(br)} />
                    <div>
                      <strong>{br === "MANAGER" ? "Manager" : "Operator"}</strong>
                      <span>{br === "MANAGER" ? "Full inventory management access" : "Basic daily operations access"}</span>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Permissions</label>
              <p className="form-helper" style={{ marginBottom: "0.75rem" }}>
                Select which features this role can see. Grayed-out items require Manager-level access.
              </p>
              <div className="role-permissions-grid">
                {groups.map(({ group, items }) => (
                  <div key={group} className="role-perm-section">
                    <div className="role-perm-section-label">{group}</div>
                    {items.map((def) => {
                      const allowed = availablePerms.includes(def.key as Permission);
                      const checked = form.permissions.includes(def.key as Permission);
                      return (
                        <label
                          key={def.key}
                          className={`role-perm-row${!allowed ? " role-perm-row--disabled" : ""}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked && allowed}
                            disabled={!allowed}
                            onChange={() => togglePerm(def.key as Permission)}
                          />
                          <div className="role-perm-text">
                            <span className="role-perm-label">{def.label}</span>
                            <span className="role-perm-desc">{def.description}</span>
                          </div>
                          {!allowed && (
                            <span className="role-perm-lock" title="Requires Manager base role">
                              <svg viewBox="0 0 20 20" fill="currentColor" width="12" height="12">
                                <path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" />
                              </svg>
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>

            <div className="modal-footer">
              <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn--primary" disabled={saving || !form.name.trim()}>
                {saving ? <span className="btn-spinner" /> : null}
                {saving ? "Saving..." : isEdit ? "Save Role" : "Create Role"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════
   ADD / EDIT MEMBER MODALS
════════════════════════════════════════════ */

function AddTeamUserModal({ customRoles, onClose, onSuccess, onError }: {
  customRoles: CustomRole[];
  onClose: () => void;
  onSuccess: (member: TeamMember) => void;
  onError: (msg: string) => void;
}) {
  const [form, setForm] = useState<CreateTeamUserInput>({ name: "", email: "", password: "", role: "OPERATOR", customRoleId: null });
  const [saving, setSaving] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => { firstRef.current?.focus(); }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim() || !form.password.trim()) return;
    setSaving(true);
    try {
      const res = await createTeamUser({ ...form, name: form.name.trim(), email: form.email.trim() });
      onSuccess(res.user);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to add team member");
      setSaving(false);
    }
  }

  return (
    <TeamModal title="Add Team Member" onClose={onClose}>
      <form onSubmit={(e) => { void handleSubmit(e); }}>
        <div className="form-group">
          <label className="form-label">Name *</label>
          <input ref={firstRef} className="form-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </div>
        <div className="form-group">
          <label className="form-label">Email *</label>
          <input className="form-input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        </div>
        <div className="form-group">
          <label className="form-label">Password *</label>
          <input className="form-input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
        </div>
        <RoleAssignPicker
          role={form.role}
          customRoleId={form.customRoleId ?? null}
          customRoles={customRoles}
          onChange={(role, customRoleId) => setForm({ ...form, role, customRoleId })}
        />
        <ModalActions onClose={onClose} saving={saving} disabled={!form.name.trim() || !form.email.trim() || !form.password.trim()} label="Add User" savingLabel="Adding..." />
      </form>
    </TeamModal>
  );
}

function EditTeamUserModal({ member, customRoles, onClose, onSuccess, onError }: {
  member: TeamMember;
  customRoles: CustomRole[];
  onClose: () => void;
  onSuccess: (member: TeamMember) => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState(member.name);
  const [role, setRole] = useState<"MANAGER" | "OPERATOR">(member.role as "MANAGER" | "OPERATOR");
  const [customRoleId, setCustomRoleId] = useState<string | null>(member.customRoleId);
  const [saving, setSaving] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => { firstRef.current?.focus(); }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await updateTeamUser(member.userId, { name: name.trim(), role, customRoleId });
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
          <input ref={firstRef} className="form-input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <RoleAssignPicker
          role={role}
          customRoleId={customRoleId}
          customRoles={customRoles}
          onChange={(r, cid) => { setRole(r); setCustomRoleId(cid); }}
        />
        <ModalActions onClose={onClose} saving={saving} disabled={!name.trim()} label="Save changes" savingLabel="Saving..." />
      </form>
    </TeamModal>
  );
}

/* ════════════════════════════════════════════
   ROLE ASSIGN PICKER (used in add/edit modals)
════════════════════════════════════════════ */

function RoleAssignPicker({ role, customRoleId, customRoles, onChange }: {
  role: "MANAGER" | "OPERATOR";
  customRoleId: string | null;
  customRoles: CustomRole[];
  onChange: (role: "MANAGER" | "OPERATOR", customRoleId: string | null) => void;
}) {
  const managerCustomRoles = customRoles.filter((r) => r.baseRole === "MANAGER");
  const operatorCustomRoles = customRoles.filter((r) => r.baseRole === "OPERATOR");

  function selectSystem(r: "MANAGER" | "OPERATOR") {
    onChange(r, null);
  }

  function selectCustomRole(cr: CustomRole) {
    onChange(cr.baseRole, cr.id);
  }

  const isSystemSelected = customRoleId === null;

  return (
    <div className="form-group">
      <label className="form-label">Role</label>
      <div className="role-assign-picker">
        <div className="role-assign-section-label">System Roles</div>
        <div className="role-assign-options">
          {(["MANAGER", "OPERATOR"] as const).map((r) => (
            <button
              key={r}
              type="button"
              className={`role-assign-option${isSystemSelected && role === r ? " role-assign-option--selected" : ""}`}
              onClick={() => selectSystem(r)}
            >
              <span className={`role-dot role-dot--sm role-dot--${r.toLowerCase()}`} />
              {r}
            </button>
          ))}
        </div>

        {customRoles.length > 0 && (
          <>
            <div className="role-assign-section-label" style={{ marginTop: "0.75rem" }}>Custom Roles</div>
            <div className="role-assign-options">
              {managerCustomRoles.length > 0 && (
                <div className="role-assign-group">
                  <span className="role-assign-group-label">Manager-based</span>
                  {managerCustomRoles.map((cr) => (
                    <button
                      key={cr.id}
                      type="button"
                      className={`role-assign-option${customRoleId === cr.id ? " role-assign-option--selected" : ""}`}
                      onClick={() => selectCustomRole(cr)}
                    >
                      <span className="role-dot role-dot--sm" style={{ background: cr.color }} />
                      {cr.name}
                    </button>
                  ))}
                </div>
              )}
              {operatorCustomRoles.length > 0 && (
                <div className="role-assign-group">
                  <span className="role-assign-group-label">Operator-based</span>
                  {operatorCustomRoles.map((cr) => (
                    <button
                      key={cr.id}
                      type="button"
                      className={`role-assign-option${customRoleId === cr.id ? " role-assign-option--selected" : ""}`}
                      onClick={() => selectCustomRole(cr)}
                    >
                      <span className="role-dot role-dot--sm" style={{ background: cr.color }} />
                      {cr.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════
   SHARED MODAL PRIMITIVES
════════════════════════════════════════════ */

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

/* ════════════════════════════════════════════
   UTILITIES
════════════════════════════════════════════ */

function groupPermissions(perms: Permission[]) {
  const groups: { group: string; items: { key: Permission; label: string }[] }[] = [];
  for (const def of PERMISSION_DEFS) {
    if (!perms.includes(def.key as Permission)) continue;
    const existing = groups.find((g) => g.group === def.group);
    if (existing) {
      existing.items.push({ key: def.key as Permission, label: def.label });
    } else {
      groups.push({ group: def.group, items: [{ key: def.key as Permission, label: def.label }] });
    }
  }
  return groups;
}

function groupPermissionDefs() {
  const groups: { group: string; items: typeof PERMISSION_DEFS[number][] }[] = [];
  for (const def of PERMISSION_DEFS) {
    const existing = groups.find((g) => g.group === def.group);
    if (existing) {
      existing.items.push(def);
    } else {
      groups.push({ group: def.group, items: [def] });
    }
  }
  return groups;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}
