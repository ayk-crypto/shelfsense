import { useEffect, useRef, useState } from "react";
import { createSupplier, deleteSupplier, getSuppliers, updateSupplier } from "../api/suppliers";
import { useAuth } from "../context/AuthContext";
import { hasPermission } from "../utils/permissions";
import { PlanFeatureGate } from "../components/PlanFeatureGate";
import { usePlanFeatures } from "../context/PlanFeaturesContext";
import type { CreateSupplierInput, Supplier } from "../types";

interface Toast {
  id: number;
  msg: string;
  type: "success" | "error";
}

let toastSeq = 0;

const AVATAR_COLORS = [
  { bg: "#e0f2fe", text: "#0369a1" },
  { bg: "#dcfce7", text: "#16a34a" },
  { bg: "#fef9c3", text: "#a16207" },
  { bg: "#fce7f3", text: "#be185d" },
  { bg: "#ede9fe", text: "#6d28d9" },
  { bg: "#ffedd5", text: "#c2410c" },
  { bg: "#e0e7ff", text: "#4338ca" },
  { bg: "#f0fdf4", text: "#15803d" },
];

function getAvatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function SuppliersPage() {
  const planFeatures = usePlanFeatures();
  const { user } = useAuth();
  const canManage = hasPermission(user, "suppliers");

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  function showToast(msg: string, type: "success" | "error") {
    const id = ++toastSeq;
    setToasts((prev) => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  }

  async function load() {
    try {
      const res = await getSuppliers();
      setSuppliers(res.suppliers);
      setFetchError(null);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Failed to load suppliers");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const filtered = suppliers.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.phone ?? "").includes(search) ||
    (s.notes ?? "").toLowerCase().includes(search.toLowerCase())
  );

  async function handleDelete(id: string) {
    setDeletingBusy(true);
    try {
      await deleteSupplier(id);
      setSuppliers((prev) => prev.filter((s) => s.id !== id));
      setDeletingId(null);
      showToast("Supplier removed", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to delete supplier", "error");
    } finally {
      setDeletingBusy(false);
    }
  }

  if (planFeatures.isLoading || loading) {
    return (
      <div className="page-loading">
        <div className="spinner" />
        <p>Loading suppliers…</p>
      </div>
    );
  }

  if (!planFeatures.enableSuppliers) {
    return <PlanFeatureGate feature="enableSuppliers">{null}</PlanFeatureGate>;
  }

  if (fetchError) {
    return (
      <div className="page-error">
        <div className="alert alert--error">{fetchError}</div>
      </div>
    );
  }

  return (
    <div className="sup-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Suppliers</h1>
          <p className="page-subtitle">
            {suppliers.length === 0
              ? "No suppliers yet"
              : `${suppliers.length} supplier${suppliers.length === 1 ? "" : "s"}`}
          </p>
        </div>
        {canManage && (
          <button className="btn btn--primary" onClick={() => setAddOpen(true)}>
            <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 16, height: 16 }}>
              <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
            </svg>
            Add Supplier
          </button>
        )}
      </div>

      {suppliers.length > 0 && (
        <div className="sup-toolbar">
          <div className="sup-search-wrap">
            <svg className="sup-search-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="8.5" cy="8.5" r="5.5" />
              <path d="M15 15l-3-3" strokeLinecap="round" />
            </svg>
            <input
              className="sup-search-input"
              type="search"
              placeholder="Search suppliers…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {search && (
            <span className="sup-result-count">
              {filtered.length} of {suppliers.length}
            </span>
          )}
        </div>
      )}

      {suppliers.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="4" y="14" width="40" height="28" rx="3" />
              <path d="M16 14V10a8 8 0 0116 0v4" strokeLinecap="round" />
              <circle cx="24" cy="28" r="4" />
              <path d="M24 32v4" strokeLinecap="round" />
            </svg>
          </div>
          <h3>No suppliers yet</h3>
          <p>Add your first supplier to start linking them to stock batches and purchases.</p>
          {canManage && (
            <button className="btn btn--primary" onClick={() => setAddOpen(true)}>
              Add your first supplier
            </button>
          )}
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state empty-state--compact">
          <p>No suppliers match "{search}".</p>
          <button className="btn btn--ghost btn--sm" onClick={() => setSearch("")}>Clear search</button>
        </div>
      ) : (
        <div className="sup-grid">
          {filtered.map((s) => {
            const color = getAvatarColor(s.name);
            const initials = getInitials(s.name);
            const isConfirmingDelete = deletingId === s.id;

            return (
              <div key={s.id} className={`sup-card${isConfirmingDelete ? " sup-card--deleting" : ""}`}>
                {isConfirmingDelete ? (
                  <div className="sup-delete-confirm">
                    <p className="sup-delete-msg">
                      Remove <strong>{s.name}</strong>? This cannot be undone.
                    </p>
                    <div className="sup-delete-actions">
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={() => setDeletingId(null)}
                        disabled={deletingBusy}
                      >
                        Cancel
                      </button>
                      <button
                        className="btn btn--danger btn--sm"
                        onClick={() => { void handleDelete(s.id); }}
                        disabled={deletingBusy}
                      >
                        {deletingBusy ? <span className="btn-spinner" /> : null}
                        {deletingBusy ? "Removing…" : "Remove"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="sup-card-header">
                      <div
                        className="sup-avatar"
                        style={{ background: color.bg, color: color.text }}
                      >
                        {initials}
                      </div>
                      <div className="sup-card-title-wrap">
                        <span className="sup-card-name">{s.name}</span>
                        <span className="sup-card-since">Added {formatDate(s.createdAt)}</span>
                      </div>
                      {canManage && (
                        <div className="sup-card-actions">
                          <button
                            className="sup-action-btn"
                            title="Edit supplier"
                            onClick={() => setEditingSupplier(s)}
                          >
                            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
                              <path d="M13.586 3.586a2 2 0 112.828 2.828L7.5 15.328l-4 1 1-4 9.086-8.742z" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </button>
                          <button
                            className="sup-action-btn sup-action-btn--danger"
                            title="Remove supplier"
                            onClick={() => setDeletingId(s.id)}
                          >
                            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
                              <path d="M9 2h2a1 1 0 011 1H8a1 1 0 011-1zM4 5h12M6 5v11a1 1 0 001 1h6a1 1 0 001-1V5" strokeLinecap="round" strokeLinejoin="round" />
                              <path d="M8 9v5M12 9v5" strokeLinecap="round" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </div>

                    {(s.phone || s.notes) && (
                      <div className="sup-card-body">
                        {s.phone && (
                          <a href={`tel:${s.phone}`} className="sup-phone-row">
                            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" className="sup-phone-icon">
                              <path d="M2 3.5A1.5 1.5 0 013.5 2h1.148a1.5 1.5 0 011.465 1.175l.716 3.223a1.5 1.5 0 01-1.052 1.767l-.933.267c-.41.117-.643.555-.48.95a11.542 11.542 0 006.254 6.254c.395.163.833-.07.95-.48l.267-.933a1.5 1.5 0 011.767-1.052l3.223.716A1.5 1.5 0 0118 15.352V16.5a1.5 1.5 0 01-1.5 1.5H15c-1.149 0-2.263-.15-3.326-.43A13.022 13.022 0 012.43 8.326 13.019 13.019 0 012 5V3.5z" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            {s.phone}
                          </a>
                        )}
                        {s.notes && (
                          <p className="sup-notes">{s.notes}</p>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {addOpen && (
        <SupplierModal
          title="Add Supplier"
          onClose={() => setAddOpen(false)}
          onSuccess={(supplier) => {
            setSuppliers((prev) => [...prev, supplier].sort((a, b) => a.name.localeCompare(b.name)));
            setAddOpen(false);
            showToast(`"${supplier.name}" added`, "success");
          }}
          onError={(msg) => showToast(msg, "error")}
        />
      )}

      {editingSupplier && (
        <SupplierModal
          title="Edit Supplier"
          initial={editingSupplier}
          onClose={() => setEditingSupplier(null)}
          onSuccess={(updated) => {
            setSuppliers((prev) =>
              prev.map((s) => (s.id === updated.id ? updated : s))
                  .sort((a, b) => a.name.localeCompare(b.name))
            );
            setEditingSupplier(null);
            showToast(`"${updated.name}" updated`, "success");
          }}
          onError={(msg) => showToast(msg, "error")}
        />
      )}

      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.type}`}>
            {t.type === "success" ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            )}
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}

function SupplierModal({
  title,
  initial,
  onClose,
  onSuccess,
  onError,
}: {
  title: string;
  initial?: Supplier;
  onClose: () => void;
  onSuccess: (supplier: Supplier) => void;
  onError: (msg: string) => void;
}) {
  const [form, setForm] = useState<CreateSupplierInput>({
    name: initial?.name ?? "",
    phone: initial?.phone ?? "",
    notes: initial?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => { firstRef.current?.focus(); }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const data: CreateSupplierInput = {
        name: form.name.trim(),
        phone: form.phone?.trim() || undefined,
        notes: form.notes?.trim() || undefined,
      };
      let res: { supplier: Supplier };
      if (initial) {
        res = await updateSupplier(initial.id, data);
      } else {
        res = await createSupplier(data);
      }
      onSuccess(res.supplier);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to save supplier");
    } finally {
      setSaving(false);
    }
  }

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
        <div className="modal-body">
          <form onSubmit={(e) => { void handleSubmit(e); }}>
            <div className="form-group">
              <label className="form-label">Name *</label>
              <input
                ref={firstRef}
                className="form-input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Fresh Farms Ltd"
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Phone</label>
              <input
                className="form-input"
                type="tel"
                value={form.phone ?? ""}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="+92 300 0000000"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Notes</label>
              <textarea
                className="form-input form-textarea"
                value={form.notes ?? ""}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Delivery days, minimum order, payment terms…"
                rows={3}
              />
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn--ghost" onClick={onClose}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn--primary"
                disabled={saving || !form.name.trim()}
              >
                {saving ? <span className="btn-spinner" /> : null}
                {saving ? "Saving…" : initial ? "Save Changes" : "Add Supplier"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
