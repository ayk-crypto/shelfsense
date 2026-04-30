import { useEffect, useRef, useState } from "react";
import { createSupplier, getSuppliers } from "../api/suppliers";
import type { CreateSupplierInput, Supplier } from "../types";

interface Toast {
  id: number;
  msg: string;
  type: "success" | "error";
}

let toastSeq = 0;

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
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

  if (loading) {
    return (
      <div className="page-loading">
        <div className="spinner" />
        <p>Loading suppliers…</p>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="page-error">
        <div className="alert alert--error">{fetchError}</div>
      </div>
    );
  }

  return (
    <div className="suppliers-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Suppliers</h1>
          <p className="page-subtitle">Manage your supplier contacts</p>
        </div>
        <button className="btn btn--primary" onClick={() => setAddOpen(true)}>
          + Add Supplier
        </button>
      </div>

      {suppliers.length === 0 ? (
        <div className="empty-state">
          <p>No suppliers yet. Add your first supplier to get started.</p>
        </div>
      ) : (
        <>
          {/* ── Desktop table ── */}
          <div className="table-wrap suppliers-table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Notes</th>
                  <th>Added</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((s) => (
                  <tr key={s.id}>
                    <td className="td-name">{s.name}</td>
                    <td className="td-unit">
                      {s.phone
                        ? <a href={`tel:${s.phone}`} className="supplier-phone-link">{s.phone}</a>
                        : <span className="text-muted">—</span>}
                    </td>
                    <td className="supplier-notes-cell">
                      {s.notes
                        ? <span className="supplier-notes">{s.notes}</span>
                        : <span className="text-muted">—</span>}
                    </td>
                    <td className="td-expiry">{formatDate(s.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Mobile cards ── */}
          <div className="supplier-cards">
            {suppliers.map((s) => (
              <div key={s.id} className="supplier-card">
                <div className="supplier-card-name">{s.name}</div>
                {s.phone && (
                  <a href={`tel:${s.phone}`} className="supplier-card-phone supplier-phone-link">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="supplier-card-icon">
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.61 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.6a16 16 0 0 0 6.07 6.07l.95-.95a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
                    </svg>
                    {s.phone}
                  </a>
                )}
                {s.notes && (
                  <p className="supplier-card-notes">{s.notes}</p>
                )}
                <span className="supplier-card-date">{formatDate(s.createdAt)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {addOpen && (
        <AddSupplierModal
          onClose={() => setAddOpen(false)}
          onSuccess={(supplier) => {
            setSuppliers((prev) => [supplier, ...prev].sort((a, b) => a.name.localeCompare(b.name)));
            setAddOpen(false);
            showToast(`"${supplier.name}" added successfully`, "success");
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

function AddSupplierModal({
  onClose,
  onSuccess,
  onError,
}: {
  onClose: () => void;
  onSuccess: (supplier: Supplier) => void;
  onError: (msg: string) => void;
}) {
  const [form, setForm] = useState<CreateSupplierInput>({ name: "", phone: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => { firstRef.current?.focus(); }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const res = await createSupplier({
        name: form.name.trim(),
        phone: form.phone?.trim() || undefined,
        notes: form.notes?.trim() || undefined,
      });
      onSuccess(res.supplier);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to add supplier");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Add Supplier" onClose={onClose}>
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
            placeholder="Delivery days, minimum order, etc."
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
            {saving ? "Adding…" : "Add Supplier"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

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
