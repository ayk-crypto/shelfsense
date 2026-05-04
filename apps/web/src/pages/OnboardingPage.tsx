import { useEffect, useState } from "react";
import { createItem } from "../api/items";
import { getLocations } from "../api/locations";
import { completeOnboarding } from "../api/onboarding";
import { stockIn } from "../api/stock";
import { createSupplier } from "../api/suppliers";
import { updateWorkspaceSettings } from "../api/workspace";
import type { Location, OnboardingStatus, WorkspaceSettings } from "../types";

interface OnboardingPageProps {
  settings: WorkspaceSettings;
  status: OnboardingStatus;
  onComplete: () => void;
  onSettingsUpdated: (settings: WorkspaceSettings) => void;
}

const BUSINESS_TYPES = [
  { value: "restaurant", label: "Restaurant", icon: "🍽️", desc: "Food service & kitchen" },
  { value: "retail", label: "Retail Store", icon: "🛍️", desc: "Shop & storefront" },
  { value: "pharmacy", label: "Pharmacy", icon: "💊", desc: "Medical & health supplies" },
  { value: "other", label: "Other", icon: "📦", desc: "Any other business type" },
];

const STEP_LABELS = ["Workspace", "Add Item", "Add Stock", "Add Supplier", "All Set!"];

export function OnboardingPage({
  settings,
  status,
  onComplete,
  onSettingsUpdated,
}: OnboardingPageProps) {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [businessName, setBusinessName] = useState(settings.name);
  const [businessType, setBusinessType] = useState<string>(settings.businessType ?? "");

  const [itemName, setItemName] = useState("");
  const [itemUnit, setItemUnit] = useState("pcs");
  const [createdItemId, setCreatedItemId] = useState<string | null>(null);
  const [itemAdded, setItemAdded] = useState(status.hasItems);

  const [stockQty, setStockQty] = useState("");
  const [stockCost, setStockCost] = useState("");
  const [stockLocationId, setStockLocationId] = useState("");
  const [locations, setLocations] = useState<Location[]>([]);
  const [stockAdded, setStockAdded] = useState(false);

  const [supplierName, setSupplierName] = useState("");
  const [supplierPhone, setSupplierPhone] = useState("");
  const [supplierAdded, setSupplierAdded] = useState(status.hasSuppliers);

  const [workspaceSaved, setWorkspaceSaved] = useState(false);

  const progress = Math.round(((step + 1) / STEP_LABELS.length) * 100);

  useEffect(() => {
    if (step === 2 && createdItemId) {
      getLocations()
        .then((res) => {
          const active = res.locations.filter((l) => l.isActive);
          setLocations(active);
          if (active.length > 0 && !stockLocationId) {
            setStockLocationId(active[0].id);
          }
        })
        .catch(() => {});
    }
  }, [step, createdItemId]);

  function goNext() {
    setError(null);
    setStep((s) => Math.min(s + 1, STEP_LABELS.length - 1));
  }

  function goBack() {
    setError(null);
    setStep((s) => Math.max(s - 1, 0));
  }

  async function handleWorkspaceSetup() {
    if (!businessName.trim()) {
      setError("Business name is required.");
      return;
    }
    if (!businessType) {
      setError("Please select a business type to continue.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await updateWorkspaceSettings({
        name: businessName.trim(),
        businessType,
      });
      onSettingsUpdated(res.settings);
      setWorkspaceSaved(true);
      goNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save workspace settings.");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddItem() {
    if (!itemName.trim()) {
      goNext();
      return;
    }
    if (!itemUnit.trim()) {
      setError("Unit is required when adding an item.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await createItem({
        name: itemName.trim(),
        unit: itemUnit.trim(),
        minStockLevel: 0,
        trackExpiry: false,
      });
      setCreatedItemId(res.item.id);
      setItemAdded(true);
      goNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add item.");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddStock() {
    if (!createdItemId || !stockQty.trim()) {
      goNext();
      return;
    }
    const qty = Number(stockQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError("Quantity must be a positive number.");
      return;
    }
    const cost = stockCost.trim() ? Number(stockCost) : undefined;
    if (cost !== undefined && (!Number.isFinite(cost) || cost < 0)) {
      setError("Unit cost must be a valid non-negative number.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await stockIn({
        itemId: createdItemId,
        quantity: qty,
        unitCost: cost,
        ...(stockLocationId ? { locationId: stockLocationId } : {}),
        note: "Opening stock — onboarding",
      });
      setStockAdded(true);
      goNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add stock.");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddSupplier() {
    if (!supplierName.trim()) {
      goNext();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createSupplier({
        name: supplierName.trim(),
        phone: supplierPhone.trim() || undefined,
      });
      setSupplierAdded(true);
      goNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add supplier.");
    } finally {
      setSaving(false);
    }
  }

  async function handleFinish() {
    setSaving(true);
    setError(null);
    try {
      await completeOnboarding();
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete setup.");
    } finally {
      setSaving(false);
    }
  }

  const businessTypeLabel =
    BUSINESS_TYPES.find((t) => t.value === businessType)?.label ?? businessType;

  return (
    <main className="onboarding-shell">
      <section className="onboarding-card">
        <div className="onboarding-brand">
          <span className="onboarding-logo">SS</span>
          <div>
            <h1 className="onboarding-brand-title">ShelfSense setup</h1>
            <p className="onboarding-brand-sub">Let's get your workspace ready in a few quick steps.</p>
          </div>
        </div>

        <div className="onboarding-progress" aria-label={`Step ${step + 1} of ${STEP_LABELS.length}`}>
          <div className="onboarding-progress-head">
            <span className="onboarding-step-label">{STEP_LABELS[step]}</span>
            <strong className="onboarding-step-count">{step + 1} / {STEP_LABELS.length}</strong>
          </div>
          <div className="onboarding-progress-track">
            <span style={{ width: `${progress}%` }} />
          </div>
          <div className="onboarding-dots">
            {STEP_LABELS.map((_, i) => (
              <span
                key={i}
                className={
                  "onboarding-dot" +
                  (i < step ? " onboarding-dot--done" : i === step ? " onboarding-dot--active" : "")
                }
              />
            ))}
          </div>
        </div>

        {error && (
          <div className="alert alert--error onboarding-error" role="alert">
            {error}
          </div>
        )}

        {step === 0 && (
          <div className="onboarding-step">
            <h2>Tell us about your business</h2>
            <p>These details personalise your ShelfSense experience.</p>

            <div className="form-group">
              <label className="form-label" htmlFor="ob-biz-name">
                Business name <span className="onboarding-required">*</span>
              </label>
              <input
                id="ob-biz-name"
                className="form-input"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="e.g. FreshMart, City Pharmacy, Al-Fatah"
                autoFocus
              />
            </div>

            <div className="form-group">
              <label className="form-label">
                Business type <span className="onboarding-required">*</span>
              </label>
              <div className="onboarding-type-grid">
                {BUSINESS_TYPES.map((bt) => (
                  <button
                    key={bt.value}
                    type="button"
                    className={
                      "onboarding-type-card" +
                      (businessType === bt.value ? " onboarding-type-card--active" : "")
                    }
                    onClick={() => setBusinessType(bt.value)}
                  >
                    <span className="onboarding-type-icon">{bt.icon}</span>
                    <span className="onboarding-type-name">{bt.label}</span>
                    <span className="onboarding-type-desc">{bt.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="onboarding-step">
            <h2>Add your first inventory item</h2>
            <p>Start with one item — you can bulk-import more from the Items page later.</p>
            {itemAdded && (
              <div className="onboarding-pill onboarding-pill--success">
                ✓ Item already in inventory
              </div>
            )}
            <div className="form-row">
              <div className="form-group">
                <label className="form-label" htmlFor="ob-item-name">Item name</label>
                <input
                  id="ob-item-name"
                  className="form-input"
                  value={itemName}
                  onChange={(e) => setItemName(e.target.value)}
                  placeholder="e.g. Milk, Paracetamol, Rice Bags"
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="ob-item-unit">Unit</label>
                <input
                  id="ob-item-unit"
                  className="form-input"
                  value={itemUnit}
                  onChange={(e) => setItemUnit(e.target.value)}
                  placeholder="pcs, kg, ltr, box"
                />
              </div>
            </div>
            <p className="onboarding-hint">Leave blank to skip — you can add items later.</p>
          </div>
        )}

        {step === 2 && (
          <div className="onboarding-step">
            <h2>Add opening stock</h2>
            {!createdItemId ? (
              <div className="onboarding-skip-notice">
                <span className="onboarding-skip-icon">ℹ️</span>
                <div>
                  <strong>No item was added in the previous step.</strong>
                  <p>You can add stock from <strong>Items → Stock In</strong> after completing setup.</p>
                </div>
              </div>
            ) : (
              <>
                <p>
                  How much <strong>{itemName}</strong> do you currently have?
                </p>
                {stockAdded && (
                  <div className="onboarding-pill onboarding-pill--success">✓ Opening stock recorded</div>
                )}
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label" htmlFor="ob-stock-qty">Opening quantity</label>
                    <input
                      id="ob-stock-qty"
                      className="form-input"
                      type="number"
                      min={0}
                      step="any"
                      value={stockQty}
                      onChange={(e) => setStockQty(e.target.value)}
                      placeholder="e.g. 50"
                      autoFocus
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="ob-stock-cost">Unit cost <span className="onboarding-optional">(optional)</span></label>
                    <input
                      id="ob-stock-cost"
                      className="form-input"
                      type="number"
                      min={0}
                      step="any"
                      value={stockCost}
                      onChange={(e) => setStockCost(e.target.value)}
                      placeholder="e.g. 120"
                    />
                  </div>
                </div>
                {locations.length > 1 && (
                  <div className="form-group">
                    <label className="form-label" htmlFor="ob-location">Location</label>
                    <select
                      id="ob-location"
                      className="form-select"
                      value={stockLocationId}
                      onChange={(e) => setStockLocationId(e.target.value)}
                    >
                      {locations.map((loc) => (
                        <option key={loc.id} value={loc.id}>{loc.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                <p className="onboarding-hint">Leave quantity blank to skip.</p>
              </>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="onboarding-step">
            <h2>Add a supplier</h2>
            <p>Track where your stock comes from. You can skip this and add suppliers from the Suppliers page later.</p>
            {supplierAdded && (
              <div className="onboarding-pill onboarding-pill--success">✓ Supplier already added</div>
            )}
            <div className="form-row">
              <div className="form-group">
                <label className="form-label" htmlFor="ob-sup-name">Supplier name</label>
                <input
                  id="ob-sup-name"
                  className="form-input"
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                  placeholder="e.g. Metro, Ahmed Traders, Al-Fatah"
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="ob-sup-phone">
                  Phone <span className="onboarding-optional">(optional)</span>
                </label>
                <input
                  id="ob-sup-phone"
                  className="form-input"
                  type="tel"
                  value={supplierPhone}
                  onChange={(e) => setSupplierPhone(e.target.value)}
                  placeholder="+92 300 1234567"
                />
              </div>
            </div>
            <p className="onboarding-hint">Leave blank to skip.</p>
          </div>
        )}

        {step === 4 && (
          <div className="onboarding-step onboarding-finish">
            <div className="onboarding-finish-icon" aria-hidden="true">🎉</div>
            <h2>You're all set!</h2>
            <p>Your ShelfSense workspace is ready. Here's a summary of what you've configured:</p>
            <ul className="onboarding-summary">
              <li className="onboarding-summary-row onboarding-summary-row--done">
                <span className="onboarding-check">✓</span>
                <span>
                  Workspace <strong>{businessName}</strong>
                  {businessTypeLabel ? ` · ${businessTypeLabel}` : ""}
                </span>
              </li>
              <li className={`onboarding-summary-row${itemAdded ? " onboarding-summary-row--done" : ""}`}>
                <span className="onboarding-check">{itemAdded ? "✓" : "–"}</span>
                <span>{itemAdded ? `Item "${itemName || "added"}" created` : "No items added yet"}</span>
              </li>
              <li className={`onboarding-summary-row${stockAdded ? " onboarding-summary-row--done" : ""}`}>
                <span className="onboarding-check">{stockAdded ? "✓" : "–"}</span>
                <span>{stockAdded ? "Opening stock recorded" : "Stock setup skipped"}</span>
              </li>
              <li className={`onboarding-summary-row${supplierAdded ? " onboarding-summary-row--done" : ""}`}>
                <span className="onboarding-check">{supplierAdded ? "✓" : "–"}</span>
                <span>
                  {supplierAdded
                    ? `Supplier "${supplierName || "added"}" saved`
                    : "No suppliers added yet"}
                </span>
              </li>
            </ul>
            <p className="onboarding-hint">You can add more items, stock, suppliers, and team members at any time.</p>
          </div>
        )}

        <div className="onboarding-footer">
          {step > 0 && (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={goBack}
              disabled={saving}
            >
              ← Back
            </button>
          )}

          <div className="onboarding-footer-right">
            {step === 0 && (
              <button
                type="button"
                className="btn btn--primary onboarding-cta"
                onClick={() => { void handleWorkspaceSetup(); }}
                disabled={saving}
              >
                {saving ? "Saving…" : "Continue →"}
              </button>
            )}
            {step === 1 && (
              <button
                type="button"
                className="btn btn--primary onboarding-cta"
                onClick={() => { void handleAddItem(); }}
                disabled={saving}
              >
                {saving ? "Saving…" : itemName.trim() ? "Add Item & Continue →" : "Skip for now →"}
              </button>
            )}
            {step === 2 && (
              <button
                type="button"
                className="btn btn--primary onboarding-cta"
                onClick={() => { void handleAddStock(); }}
                disabled={saving}
              >
                {saving
                  ? "Saving…"
                  : createdItemId && stockQty.trim()
                    ? "Add Stock & Continue →"
                    : "Skip for now →"}
              </button>
            )}
            {step === 3 && (
              <button
                type="button"
                className="btn btn--primary onboarding-cta"
                onClick={() => { void handleAddSupplier(); }}
                disabled={saving}
              >
                {saving ? "Saving…" : supplierName.trim() ? "Add Supplier & Continue →" : "Skip for now →"}
              </button>
            )}
            {step === 4 && (
              <button
                type="button"
                className="btn btn--primary onboarding-cta"
                onClick={() => { void handleFinish(); }}
                disabled={saving}
              >
                {saving ? "Opening dashboard…" : "Go to Dashboard →"}
              </button>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
