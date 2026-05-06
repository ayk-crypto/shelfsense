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
                {plan.priceDisplayMode === "CUSTOM" ? (
                  <span className="admin-plan-price admin-plan-price--custom">Custom pricing</span>
                ) : (
                  <>
                    <span className="admin-plan-price">$ {plan.monthlyPrice.toLocaleString()}<span className="admin-plan-period">/mo</span></span>
                    {plan.annualPrice > 0 && (
                      <span className="admin-plan-price-alt">$ {plan.annualPrice.toLocaleString()}/yr</span>
                    )}
                  </>
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
                  ["Inventory Reports", plan.enableReports],
                  ["Advanced Reports", plan.enableAdvancedReports],
                  ["Purchase Orders", plan.enablePurchases],
                  ["Supplier Management", plan.enableSuppliers],
                  ["Team Management", plan.enableTeamManagement],
                  ["Custom Roles", plan.enableCustomRoles],
                  ["Email Alerts", plan.enableEmailAlerts],
                  ["Daily Ops Digest", plan.enableDailyOps],
                ].map(([label, enabled]) => (
                  <span key={String(label)} className={`admin-plan-feature ${enabled ? "admin-plan-feature--on" : "admin-plan-feature--off"}`}>
                    {enabled ? "✓" : "✗"} {label}
                  </span>
                ))}
              </div>
              {plan.ctaText && (
                <div style={{ marginTop: 8 }}>
                  <span className="admin-badge admin-badge--gray" style={{ fontWeight: 500 }}>
                    CTA: {plan.ctaText}
                  </span>
                </div>
              )}
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

/* ── Feature toggle definitions ─────────────────────────────────────────── */
const FEATURE_TOGGLES: [string, string, string][] = [
  ["enableExpiryTracking",  "Expiry Tracking",      "Track best-before and expiry dates on stock items."],
  ["enableBarcodeScanning", "Barcode Scanning",      "Scan barcodes to look up and receive items quickly."],
  ["enableReports",         "Inventory Reports",     "Access standard inventory and stock movement reports."],
  ["enableAdvancedReports", "Advanced Analytics",    "Unlock advanced analytics, trend charts, and valuation reports."],
  ["enablePurchases",       "Purchase Orders",       "Create and manage purchase orders with full lifecycle tracking."],
  ["enableSuppliers",       "Supplier Management",   "Manage supplier contacts, pricing history, and lead times."],
  ["enableTeamManagement",  "Team Management",       "Invite team members and assign workspace roles."],
  ["enableCustomRoles",     "Custom Roles",          "Build custom permission sets beyond the standard role presets."],
  ["enableEmailAlerts",     "Email Alerts",          "Send low-stock, expiry, and digest email alerts to the team."],
  ["enableDailyOps",        "Daily Ops Digest",      "Daily summary email covering key inventory events and actions."],
];

/* ── PricingCard mini-preview ────────────────────────────────────────────── */
function PlanCardPreview({ form }: { form: ReturnType<typeof buildForm> }) {
  const isCustom = form.priceDisplayMode === "CUSTOM";
  const isFree = !isCustom && form.monthlyPrice === 0;
  const ctaLabel = form.ctaText.trim()
    || (isCustom ? "Contact Sales" : isFree ? "Start Free" : `Choose ${form.name || "Plan"}`);

  const enabledFeatures = FEATURE_TOGGLES.filter(([key]) => form[key as keyof typeof form] === true);
  const disabledFeatures = FEATURE_TOGGLES.filter(([key]) => form[key as keyof typeof form] !== true);

  return (
    <div className="plan-preview-card">
      <div className="plan-preview-tier">{form.name || "Plan name"}</div>

      {isCustom ? (
        <div className="plan-preview-price plan-preview-price--custom">
          <span className="plan-preview-custom-label">Custom pricing</span>
          <span className="plan-preview-custom-sub">Tailored for larger teams</span>
        </div>
      ) : (
        <div className="plan-preview-price">
          <span className="plan-preview-currency">$</span>
          <span className="plan-preview-amount">{isFree ? "0" : form.monthlyPrice}</span>
          <span className="plan-preview-period">{isFree ? "forever" : "/ mo"}</span>
        </div>
      )}

      {form.description && (
        <p className="plan-preview-desc">{form.description}</p>
      )}

      <div className="plan-preview-limits">
        {[
          form.maxUsers !== "" ? `${form.maxUsers} users` : "Unlimited users",
          form.maxLocations !== "" ? `${form.maxLocations} locations` : "Unlimited locations",
          form.maxItems !== "" ? `${form.maxItems} items` : "Unlimited items",
        ].map((l) => <span key={l} className="plan-preview-limit-chip">{l}</span>)}
      </div>

      <ul className="plan-preview-features">
        {enabledFeatures.map(([, label]) => (
          <li key={label} className="plan-preview-feature plan-preview-feature--on">
            <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12">
              <path fillRule="evenodd" d="M13.707 4.293a1 1 0 010 1.414l-7 7a1 1 0 01-1.414 0l-3-3a1 1 0 011.414-1.414L6 10.586l6.293-6.293a1 1 0 011.414 0z"/>
            </svg>
            {label}
          </li>
        ))}
        {disabledFeatures.map(([, label]) => (
          <li key={label} className="plan-preview-feature plan-preview-feature--off">
            <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12">
              <path d="M4.293 4.293a1 1 0 011.414 0L8 6.586l2.293-2.293a1 1 0 111.414 1.414L9.414 8l2.293 2.293a1 1 0 01-1.414 1.414L8 9.414l-2.293 2.293a1 1 0 01-1.414-1.414L6.586 8 4.293 5.707a1 1 0 010-1.414z"/>
            </svg>
            {label}
          </li>
        ))}
      </ul>

      <button className="plan-preview-cta">{ctaLabel}</button>
    </div>
  );
}

/* ── Form state factory ──────────────────────────────────────────────────── */
function buildForm(plan: AdminPlan | null) {
  return {
    name: plan?.name ?? "",
    code: plan?.code ?? "",
    description: plan?.description ?? "",
    monthlyPrice: plan?.monthlyPrice ?? 0,
    annualPrice: plan?.annualPrice ?? 0,
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
    ctaText: plan?.ctaText ?? "",
    priceDisplayMode: (plan?.priceDisplayMode ?? "FIXED") as "FIXED" | "CUSTOM",
    isPublic: plan?.isPublic ?? true,
    sortOrder: plan?.sortOrder ?? 0,
  };
}

/* ── PlanModal ───────────────────────────────────────────────────────────── */
function PlanModal({ plan, onClose, onSaved }: { plan: AdminPlan | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState(() => buildForm(plan));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(k: string, v: unknown) { setForm((f) => ({ ...f, [k]: v })); }

  function handlePriceDisplayChange(mode: "FIXED" | "CUSTOM") {
    set("priceDisplayMode", mode);
    if (mode === "CUSTOM" && !form.ctaText.trim()) {
      set("ctaText", "Contact Sales");
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        ...form,
        ctaText: form.ctaText.trim() || null,
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

  const isCustom = form.priceDisplayMode === "CUSTOM";

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal plan-modal-wide">
        <div className="modal-header">
          <div>
            <h2 className="modal-title">{plan ? "Edit Plan" : "New Plan"}</h2>
            <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>
              Changes take effect immediately for new subscribers. Existing subscriptions are unaffected.
            </p>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="plan-modal-body">
          {/* ── Left column: form ── */}
          <div className="plan-modal-form">
            {error && <div className="alert alert--error" style={{ marginBottom: 12 }}>{error}</div>}

            {/* Identity */}
            <section className="plan-form-section">
              <h4 className="plan-form-section-title">Identity</h4>
              <div className="form-grid-2">
                <div className="form-group">
                  <label className="form-label">Plan Name <span className="form-required">*</span></label>
                  <input className="form-input" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Pro" />
                </div>
                <div className="form-group">
                  <label className="form-label">Code <span className="form-required">*</span></label>
                  <input
                    className="form-input"
                    value={form.code}
                    onChange={(e) => set("code", e.target.value.toUpperCase())}
                    placeholder="e.g. PRO"
                    disabled={!!plan}
                    title={plan ? "Plan code cannot be changed after creation." : undefined}
                  />
                  {plan && <p className="plan-form-hint">Plan code is locked after creation.</p>}
                </div>
                <div className="form-group form-group--full">
                  <label className="form-label">Description</label>
                  <input className="form-input" value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Short marketing copy for the pricing card" />
                </div>
              </div>
            </section>

            {/* Pricing */}
            <section className="plan-form-section">
              <h4 className="plan-form-section-title">Pricing</h4>

              <div className="plan-form-price-mode">
                <label className={`plan-price-mode-option ${form.priceDisplayMode === "FIXED" ? "plan-price-mode-option--active" : ""}`}>
                  <input type="radio" name="priceDisplayMode" checked={form.priceDisplayMode === "FIXED"} onChange={() => handlePriceDisplayChange("FIXED")} />
                  <div>
                    <span className="plan-price-mode-label">Fixed price</span>
                    <span className="plan-price-mode-sub">Show a numeric price on the public pricing page</span>
                  </div>
                </label>
                <label className={`plan-price-mode-option ${form.priceDisplayMode === "CUSTOM" ? "plan-price-mode-option--active" : ""}`}>
                  <input type="radio" name="priceDisplayMode" checked={form.priceDisplayMode === "CUSTOM"} onChange={() => handlePriceDisplayChange("CUSTOM")} />
                  <div>
                    <span className="plan-price-mode-label">Custom / Contact sales</span>
                    <span className="plan-price-mode-sub">Hide numeric pricing; show a "Contact Sales" button</span>
                  </div>
                </label>
              </div>

              {isCustom && (
                <div className="plan-form-custom-notice">
                  <svg viewBox="0 0 20 20" fill="currentColor" width="15" height="15" style={{ flexShrink: 0, color: "#f59e0b" }}>
                    <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd"/>
                  </svg>
                  <span>Numeric pricing is hidden on the public pricing page for custom pricing plans. The monthly/annual price fields below are for internal reference only and will not be displayed to users.</span>
                </div>
              )}

              <div className="form-grid-2" style={{ marginTop: 12 }}>
                <div className="form-group">
                  <label className={`form-label ${isCustom ? "form-label--muted" : ""}`}>Monthly Price</label>
                  <div className="plan-price-input-wrap">
                    <span className="plan-price-input-prefix">$</span>
                    <input
                      className="form-input plan-price-input"
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.monthlyPrice}
                      onChange={(e) => set("monthlyPrice", parseFloat(e.target.value) || 0)}
                      disabled={isCustom}
                    />
                  </div>
                  {!isCustom && <p className="plan-form-hint">USD · shown as the primary price on the pricing card</p>}
                </div>
                <div className="form-group">
                  <label className={`form-label ${isCustom ? "form-label--muted" : ""}`}>Annual Price</label>
                  <div className="plan-price-input-wrap">
                    <span className="plan-price-input-prefix">$</span>
                    <input
                      className="form-input plan-price-input"
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.annualPrice}
                      onChange={(e) => set("annualPrice", parseFloat(e.target.value) || 0)}
                      disabled={isCustom}
                    />
                  </div>
                  {!isCustom && <p className="plan-form-hint">USD · billed annually; leave 0 if annual billing is not offered</p>}
                </div>
              </div>

              <div className="plan-form-currency-note">
                <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14" style={{ flexShrink: 0, color: "#6366f1" }}>
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd"/>
                </svg>
                <div>
                  <strong>Billing currency: USD</strong>
                  <span> — ShelfSense subscription billing is always in USD. Workspace display currency is managed separately within each workspace.</span>
                </div>
              </div>

              <div className="form-group" style={{ marginTop: 12 }}>
                <label className="form-label">Trial Days</label>
                <input className="form-input" type="number" min="0" value={form.trialDays} onChange={(e) => set("trialDays", parseInt(e.target.value) || 0)} style={{ width: 120 }} />
                <p className="plan-form-hint">Days of free access before billing starts. Set to 0 for no trial.</p>
              </div>
            </section>

            {/* CTA */}
            <section className="plan-form-section">
              <h4 className="plan-form-section-title">Call-to-Action Button</h4>
              <div className="form-group">
                <label className="form-label">Button Text</label>
                <input
                  className="form-input"
                  value={form.ctaText}
                  onChange={(e) => set("ctaText", e.target.value)}
                  placeholder={isCustom ? "Contact Sales" : form.monthlyPrice === 0 ? "Start Free" : `Choose ${form.name || "Plan"}`}
                  maxLength={40}
                />
                <p className="plan-form-hint">
                  Shown on the public pricing card button. Leave blank to auto-generate.
                  {" "}Suggested: {isCustom ? '"Contact Sales"' : form.monthlyPrice === 0 ? '"Start Free"' : `"Choose ${form.name || "Plan"}"`}
                </p>
              </div>
            </section>

            {/* Limits */}
            <section className="plan-form-section">
              <h4 className="plan-form-section-title">Usage Limits <span className="plan-form-section-note">Leave blank for unlimited</span></h4>
              <div className="form-grid-2">
                {[
                  ["Max Users",      "maxUsers"],
                  ["Max Locations",  "maxLocations"],
                  ["Max Items",      "maxItems"],
                  ["Max Suppliers",  "maxSuppliers"],
                ].map(([label, key]) => (
                  <div key={key} className="form-group">
                    <label className="form-label">{label}</label>
                    <input
                      className="form-input"
                      type="number"
                      min="1"
                      value={form[key as keyof typeof form] as string}
                      onChange={(e) => set(key, e.target.value)}
                      placeholder="Unlimited"
                    />
                  </div>
                ))}
              </div>
            </section>

            {/* Features */}
            <section className="plan-form-section">
              <h4 className="plan-form-section-title">Features</h4>
              <div className="plan-feature-grid">
                {FEATURE_TOGGLES.map(([key, label, hint]) => (
                  <label key={key} className="plan-feature-row">
                    <div className="plan-feature-toggle-wrap">
                      <input
                        type="checkbox"
                        className="plan-feature-checkbox"
                        checked={form[key as keyof typeof form] as boolean}
                        onChange={(e) => set(key, e.target.checked)}
                      />
                      <span className="plan-feature-label">{label}</span>
                    </div>
                    <span className="plan-feature-hint">{hint}</span>
                  </label>
                ))}
              </div>
            </section>

            {/* Visibility & Ordering */}
            <section className="plan-form-section">
              <h4 className="plan-form-section-title">Visibility & Ordering</h4>
              <div className="form-grid-2">
                <div className="form-group">
                  <label className="plan-feature-row" style={{ cursor: "pointer" }}>
                    <div className="plan-feature-toggle-wrap">
                      <input
                        type="checkbox"
                        className="plan-feature-checkbox"
                        checked={form.isPublic}
                        onChange={(e) => set("isPublic", e.target.checked)}
                      />
                      <span className="form-label" style={{ margin: 0 }}>Publicly Visible</span>
                    </div>
                  </label>
                  <p className="plan-form-hint" style={{ marginTop: 6 }}>When enabled, this plan appears on the public pricing page.</p>
                </div>
                <div className="form-group">
                  <label className="form-label">Sort Order</label>
                  <input
                    className="form-input"
                    type="number"
                    value={form.sortOrder}
                    onChange={(e) => set("sortOrder", parseInt(e.target.value) || 0)}
                    style={{ width: 100 }}
                  />
                  <p className="plan-form-hint">Lower numbers appear first on the pricing page.</p>
                </div>
              </div>
            </section>
          </div>

          {/* ── Right column: live preview ── */}
          <div className="plan-modal-preview">
            <div className="plan-preview-header">
              <span className="plan-preview-header-label">Live Preview</span>
              <span className="plan-preview-header-sub">Public pricing card</span>
            </div>
            <PlanCardPreview form={form} />
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
