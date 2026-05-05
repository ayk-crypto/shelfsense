import { useEffect, useState } from "react";
import { getAdminPlans, createAdminPlan, updateAdminPlan, updateAdminPlanStatus } from "../../api/admin";
import type { AdminPlan } from "../../types";

export function AdminPlansPage() {
  const [plans, setPlans] = useState<AdminPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState<AdminPlan | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);

  function load() {
    setLoading(true);
    getAdminPlans()
      .then((r) => setPlans(r.plans))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load plans"))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  function showToast(type: "success" | "error", text: string) {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3500);
  }

  async function handleToggleStatus(plan: AdminPlan) {
    setActionLoading(plan.id);
    try {
      await updateAdminPlanStatus(plan.id, !plan.isActive);
      showToast("success", plan.isActive ? "Plan archived." : "Plan activated.");
      load();
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : "Action failed");
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Plans & Packages</h1>
          <p className="admin-page-subtitle">Define subscription plans, pricing tiers, and feature entitlements for all tenants</p>
        </div>
        <button className="btn btn--primary" onClick={() => { setEditingPlan(null); setShowModal(true); }}>
          + New Plan
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
      ) : (
        <div className="admin-plans-grid">
          {plans.map((plan) => (
            <div key={plan.id} className={`admin-plan-card ${!plan.isActive ? "admin-plan-card--inactive" : ""}`}>
              <div className="admin-plan-card-header">
                <div>
                  <span className="admin-plan-card-name">{plan.name}</span>
                  <span className="admin-plan-code-badge">{plan.code}</span>
                </div>
                <div className="admin-plan-card-badges">
                  {!plan.isPublic && <span className="admin-badge admin-badge--gray">Private</span>}
                  {plan.isActive
                    ? <span className="admin-badge admin-badge--green">Active</span>
                    : <span className="admin-badge admin-badge--red">Archived</span>}
                </div>
              </div>
              {plan.description && <p className="admin-plan-card-desc">{plan.description}</p>}
              <div className="admin-plan-pricing">
                <span className="admin-plan-price">{plan.currency} {plan.monthlyPrice.toLocaleString()}<span className="admin-plan-period">/mo</span></span>
                {plan.annualPrice > 0 && (
                  <span className="admin-plan-price-alt">{plan.currency} {plan.annualPrice.toLocaleString()}/yr</span>
                )}
              </div>
              <div className="admin-plan-limits">
                <span>{plan.maxUsers != null ? `${plan.maxUsers} users` : "Unlimited users"}</span>
                <span>{plan.maxLocations != null ? `${plan.maxLocations} locations` : "Unlimited locations"}</span>
                <span>{plan.maxItems != null ? `${plan.maxItems} items` : "Unlimited items"}</span>
              </div>
              <div className="admin-plan-features">
                {[
                  ["Expiry Tracking", plan.enableExpiryTracking],
                  ["Barcode Scanning", plan.enableBarcodeScanning],
                  ["Reports", plan.enableReports],
                  ["Advanced Reports", plan.enableAdvancedReports],
                  ["Purchases", plan.enablePurchases],
                  ["Suppliers", plan.enableSuppliers],
                  ["Team Management", plan.enableTeamManagement],
                  ["Custom Roles", plan.enableCustomRoles],
                  ["Email Alerts", plan.enableEmailAlerts],
                  ["Daily Ops", plan.enableDailyOps],
                ].map(([label, enabled]) => (
                  <span key={String(label)} className={`admin-plan-feature ${enabled ? "admin-plan-feature--on" : "admin-plan-feature--off"}`}>
                    {enabled ? "✓" : "✗"} {label}
                  </span>
                ))}
              </div>
              <div className="admin-plan-card-footer">
                <span className="admin-muted">{plan.subscriptionCount} subscription{plan.subscriptionCount !== 1 ? "s" : ""}</span>
                <div className="admin-actions">
                  <button className="admin-action-btn" onClick={() => { setEditingPlan(plan); setShowModal(true); }}>Edit</button>
                  <button
                    className={`admin-action-btn admin-action-btn--${plan.isActive ? "danger" : "success"}`}
                    disabled={actionLoading === plan.id}
                    onClick={() => handleToggleStatus(plan)}
                  >
                    {plan.isActive ? "Archive" : "Activate"}
                  </button>
                </div>
              </div>
            </div>
          ))}
          {plans.length === 0 && <p className="admin-empty">No plans yet. Create your first plan.</p>}
        </div>
      )}

      {showModal && (
        <PlanModal
          plan={editingPlan}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); load(); showToast("success", editingPlan ? "Plan updated." : "Plan created."); }}
        />
      )}
    </div>
  );
}

function PlanModal({ plan, onClose, onSaved }: { plan: AdminPlan | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: plan?.name ?? "",
    code: plan?.code ?? "",
    description: plan?.description ?? "",
    monthlyPrice: plan?.monthlyPrice ?? 0,
    annualPrice: plan?.annualPrice ?? 0,
    currency: plan?.currency ?? "PKR",
    trialDays: plan?.trialDays ?? 0,
    maxUsers: plan?.maxUsers != null ? String(plan.maxUsers) : "",
    maxLocations: plan?.maxLocations != null ? String(plan.maxLocations) : "",
    maxItems: plan?.maxItems != null ? String(plan.maxItems) : "",
    maxSuppliers: plan?.maxSuppliers != null ? String(plan.maxSuppliers) : "",
    enableExpiryTracking: plan?.enableExpiryTracking ?? true,
    enableBarcodeScanning: plan?.enableBarcodeScanning ?? true,
    enableReports: plan?.enableReports ?? true,
    enableAdvancedReports: plan?.enableAdvancedReports ?? false,
    enablePurchases: plan?.enablePurchases ?? true,
    enableSuppliers: plan?.enableSuppliers ?? true,
    enableTeamManagement: plan?.enableTeamManagement ?? true,
    enableCustomRoles: plan?.enableCustomRoles ?? false,
    enableEmailAlerts: plan?.enableEmailAlerts ?? true,
    enableDailyOps: plan?.enableDailyOps ?? true,
    isPublic: plan?.isPublic ?? true,
    sortOrder: plan?.sortOrder ?? 0,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(k: string, v: unknown) { setForm((f) => ({ ...f, [k]: v })); }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        ...form,
        maxUsers: form.maxUsers !== "" ? parseInt(form.maxUsers, 10) : null,
        maxLocations: form.maxLocations !== "" ? parseInt(form.maxLocations, 10) : null,
        maxItems: form.maxItems !== "" ? parseInt(form.maxItems, 10) : null,
        maxSuppliers: form.maxSuppliers !== "" ? parseInt(form.maxSuppliers, 10) : null,
      };
      if (plan) {
        await updateAdminPlan(plan.id, payload);
      } else {
        await createAdminPlan(payload);
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
      <div className="modal modal--lg">
        <div className="modal-header">
          <h2 className="modal-title">{plan ? "Edit Plan" : "New Plan"}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {error && <div className="alert alert--error" style={{ marginBottom: 12 }}>{error}</div>}

          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Plan Name *</label>
              <input className="form-input" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Pro" />
            </div>
            <div className="form-group">
              <label className="form-label">Code *</label>
              <input className="form-input" value={form.code} onChange={(e) => set("code", e.target.value.toUpperCase())} placeholder="PRO" disabled={!!plan} />
            </div>
            <div className="form-group form-group--full">
              <label className="form-label">Description</label>
              <input className="form-input" value={form.description} onChange={(e) => set("description", e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Monthly Price</label>
              <input className="form-input" type="number" value={form.monthlyPrice} onChange={(e) => set("monthlyPrice", parseFloat(e.target.value) || 0)} />
            </div>
            <div className="form-group">
              <label className="form-label">Annual Price</label>
              <input className="form-input" type="number" value={form.annualPrice} onChange={(e) => set("annualPrice", parseFloat(e.target.value) || 0)} />
            </div>
            <div className="form-group">
              <label className="form-label">Currency</label>
              <input className="form-input" value={form.currency} onChange={(e) => set("currency", e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Trial Days</label>
              <input className="form-input" type="number" value={form.trialDays} onChange={(e) => set("trialDays", parseInt(e.target.value) || 0)} />
            </div>
          </div>

          <h4 className="admin-modal-section-title">Limits (leave blank for unlimited)</h4>
          <div className="form-grid-2">
            {[
              ["Max Users", "maxUsers"],
              ["Max Locations", "maxLocations"],
              ["Max Items", "maxItems"],
              ["Max Suppliers", "maxSuppliers"],
            ].map(([label, key]) => (
              <div key={key} className="form-group">
                <label className="form-label">{label}</label>
                <input className="form-input" type="number" value={form[key as keyof typeof form] as string} onChange={(e) => set(key, e.target.value)} placeholder="Unlimited" />
              </div>
            ))}
          </div>

          <h4 className="admin-modal-section-title">Features</h4>
          <div className="admin-plan-toggles">
            {[
              ["enableExpiryTracking", "Expiry Tracking"],
              ["enableBarcodeScanning", "Barcode Scanning"],
              ["enableReports", "Reports"],
              ["enableAdvancedReports", "Advanced Reports"],
              ["enablePurchases", "Purchases"],
              ["enableSuppliers", "Suppliers"],
              ["enableTeamManagement", "Team Management"],
              ["enableCustomRoles", "Custom Roles"],
              ["enableEmailAlerts", "Email Alerts"],
              ["enableDailyOps", "Daily Ops"],
              ["isPublic", "Publicly Visible"],
            ].map(([key, label]) => (
              <label key={key} className="admin-toggle-row">
                <input type="checkbox" checked={form[key as keyof typeof form] as boolean} onChange={(e) => set(key, e.target.checked)} />
                {label}
              </label>
            ))}
          </div>

          <div className="form-group" style={{ marginTop: 12 }}>
            <label className="form-label">Sort Order</label>
            <input className="form-input" type="number" value={form.sortOrder} onChange={(e) => set("sortOrder", parseInt(e.target.value) || 0)} style={{ width: 100 }} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn--ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn--primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : plan ? "Save Changes" : "Create Plan"}
          </button>
        </div>
      </div>
    </div>
  );
}
