import { useEffect, useState } from "react";
import { getAdminCoupons, createAdminCoupon, updateAdminCoupon, updateAdminCouponStatus } from "../../api/admin";
import type { AdminCoupon } from "../../types";

export function AdminCouponsPage() {
  const [coupons, setCoupons] = useState<AdminCoupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingCoupon, setEditingCoupon] = useState<AdminCoupon | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [filterActive, setFilterActive] = useState("");

  function load() {
    setLoading(true);
    getAdminCoupons({ active: filterActive || undefined })
      .then((r) => setCoupons(r.coupons))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [filterActive]);

  function showToast(type: "success" | "error", text: string) {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3500);
  }

  async function handleToggle(c: AdminCoupon) {
    setActionLoading(c.id);
    try {
      await updateAdminCouponStatus(c.id, !c.isActive);
      showToast("success", c.isActive ? "Coupon disabled." : "Coupon enabled.");
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
          <h1 className="admin-page-title">Coupons & Promotions</h1>
          <p className="admin-page-subtitle">Create and manage promotional discount codes for subscription plans</p>
        </div>
        <button className="btn btn--primary" onClick={() => { setEditingCoupon(null); setShowModal(true); }}>
          + New Coupon
        </button>
      </div>

      {toast && (
        <div className={`alert alert--${toast.type === "success" ? "success" : "error"}`} style={{ marginBottom: 16 }}>
          {toast.text}
        </div>
      )}

      <div className="admin-filters">
        <select className="admin-filter-select" value={filterActive} onChange={(e) => setFilterActive(e.target.value)}>
          <option value="">All coupons</option>
          <option value="true">Active</option>
          <option value="false">Disabled</option>
        </select>
      </div>

      {loading ? (
        <div className="admin-loading"><div className="spinner" /></div>
      ) : error ? (
        <div className="alert alert--error">{error}</div>
      ) : coupons.length === 0 ? (
        <p className="admin-empty">No coupons found.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Discount</th>
                <th>Valid Until</th>
                <th>Redemptions</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {coupons.map((c) => (
                <tr key={c.id}>
                  <td><code className="admin-code">{c.code}</code></td>
                  <td>{c.name}</td>
                  <td>
                    {c.discountType === "PERCENTAGE"
                      ? `${c.discountValue}%`
                      : `${c.currency} ${c.discountValue.toLocaleString()}`}
                    <div className="admin-muted" style={{ fontSize: 11 }}>{c.durationType.toLowerCase()}</div>
                  </td>
                  <td className="admin-muted">{c.validUntil ? new Date(c.validUntil).toLocaleDateString() : "No expiry"}</td>
                  <td>
                    {c.redemptionsUsed}
                    {c.maxRedemptions != null ? ` / ${c.maxRedemptions}` : " / ∞"}
                  </td>
                  <td>
                    {c.isActive
                      ? <span className="admin-status-badge admin-status-badge--active">Active</span>
                      : <span className="admin-status-badge admin-status-badge--suspended">Disabled</span>}
                  </td>
                  <td>
                    <div className="admin-actions">
                      <button className="admin-action-btn" onClick={() => { setEditingCoupon(c); setShowModal(true); }}>Edit</button>
                      <button
                        className={`admin-action-btn admin-action-btn--${c.isActive ? "danger" : "success"}`}
                        disabled={actionLoading === c.id}
                        onClick={() => handleToggle(c)}
                      >
                        {c.isActive ? "Disable" : "Enable"}
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
        <CouponModal
          coupon={editingCoupon}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); load(); showToast("success", editingCoupon ? "Coupon updated." : "Coupon created."); }}
        />
      )}
    </div>
  );
}

function CouponModal({ coupon, onClose, onSaved }: { coupon: AdminCoupon | null; onClose: () => void; onSaved: () => void }) {
  const [form, setFormState] = useState({
    code: coupon?.code ?? "",
    name: coupon?.name ?? "",
    description: coupon?.description ?? "",
    discountType: coupon?.discountType ?? "PERCENTAGE",
    discountValue: coupon?.discountValue ?? 10,
    currency: coupon?.currency ?? "USD",
    validFrom: coupon?.validFrom ? coupon.validFrom.slice(0, 10) : "",
    validUntil: coupon?.validUntil ? coupon.validUntil.slice(0, 10) : "",
    maxRedemptions: coupon?.maxRedemptions != null ? String(coupon.maxRedemptions) : "",
    billingCycleRestriction: coupon?.billingCycleRestriction ?? "ANY",
    durationType: coupon?.durationType ?? "ONCE",
    durationMonths: coupon?.durationMonths != null ? String(coupon.durationMonths) : "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(k: string, v: unknown) { setFormState((f) => ({ ...f, [k]: v })); }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        ...form,
        maxRedemptions: form.maxRedemptions !== "" ? parseInt(form.maxRedemptions, 10) : null,
        durationMonths: form.durationMonths !== "" ? parseInt(form.durationMonths, 10) : null,
        validFrom: form.validFrom || null,
        validUntil: form.validUntil || null,
      };
      if (coupon) {
        await updateAdminCoupon(coupon.id, payload);
      } else {
        await createAdminCoupon(payload);
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
          <h2 className="modal-title">{coupon ? "Edit Coupon" : "New Coupon"}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {error && <div className="alert alert--error" style={{ marginBottom: 12 }}>{error}</div>}
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Code *</label>
              <input className="form-input" value={form.code} onChange={(e) => set("code", e.target.value.toUpperCase())} placeholder="SUMMER20" disabled={!!coupon} />
            </div>
            <div className="form-group">
              <label className="form-label">Name *</label>
              <input className="form-input" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Summer 20% off" />
            </div>
            <div className="form-group form-group--full">
              <label className="form-label">Description</label>
              <input className="form-input" value={form.description} onChange={(e) => set("description", e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Discount Type</label>
              <select className="form-input" value={form.discountType} onChange={(e) => set("discountType", e.target.value)}>
                <option value="PERCENTAGE">Percentage (%)</option>
                <option value="FIXED_AMOUNT">Fixed Amount</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Discount Value *</label>
              <input className="form-input" type="number" value={form.discountValue} onChange={(e) => set("discountValue", parseFloat(e.target.value) || 0)} />
            </div>
            {form.discountType === "FIXED_AMOUNT" && (
              <div className="form-group">
                <label className="form-label">Currency</label>
                <input className="form-input" value={form.currency} onChange={(e) => set("currency", e.target.value)} />
              </div>
            )}
            <div className="form-group">
              <label className="form-label">Valid From</label>
              <input className="form-input" type="date" value={form.validFrom} onChange={(e) => set("validFrom", e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Valid Until</label>
              <input className="form-input" type="date" value={form.validUntil} onChange={(e) => set("validUntil", e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Max Redemptions</label>
              <input className="form-input" type="number" value={form.maxRedemptions} onChange={(e) => set("maxRedemptions", e.target.value)} placeholder="Unlimited" />
            </div>
            <div className="form-group">
              <label className="form-label">Billing Cycle</label>
              <select className="form-input" value={form.billingCycleRestriction} onChange={(e) => set("billingCycleRestriction", e.target.value)}>
                <option value="ANY">Any</option>
                <option value="MONTHLY">Monthly only</option>
                <option value="ANNUAL">Annual only</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Duration</label>
              <select className="form-input" value={form.durationType} onChange={(e) => set("durationType", e.target.value)}>
                <option value="ONCE">Once</option>
                <option value="REPEATING">Repeating</option>
                <option value="FOREVER">Forever</option>
              </select>
            </div>
            {form.durationType === "REPEATING" && (
              <div className="form-group">
                <label className="form-label">Duration Months</label>
                <input className="form-input" type="number" value={form.durationMonths} onChange={(e) => set("durationMonths", e.target.value)} />
              </div>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn--ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn--primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : coupon ? "Save Changes" : "Create Coupon"}
          </button>
        </div>
      </div>
    </div>
  );
}
