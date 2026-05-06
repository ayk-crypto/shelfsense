import { useEffect, useState } from "react";
import { createItem } from "../api/items";
import { getLocations, updateLocation } from "../api/locations";
import { completeOnboarding, saveOnboardingStep } from "../api/onboarding";
import { stockIn } from "../api/stock";
import { updateWorkspaceSettings } from "../api/workspace";
import type { Location, OnboardingStatus, WorkspaceSettings } from "../types";

// ─── Constants ────────────────────────────────────────────────────────────────

const BUSINESS_TYPES = [
  { value: "restaurant", label: "Restaurant",   icon: "🍽️", desc: "Food service & kitchen" },
  { value: "retail",     label: "Retail Store", icon: "🛍️", desc: "Shop & storefront" },
  { value: "pharmacy",   label: "Pharmacy",     icon: "💊", desc: "Medical & health supplies" },
  { value: "warehouse",  label: "Warehouse",    icon: "🏭", desc: "Storage & distribution" },
  { value: "other",      label: "Other",        icon: "📦", desc: "Any other business type" },
];

const DEFAULT_UNITS       = ["kg", "gram", "liter", "ml", "pcs", "carton", "packet", "bottle"];
const DEFAULT_CATEGORIES  = ["Meat", "Dairy", "Vegetables", "Beverages", "Dry Goods", "Packaging", "Cleaning"];

const CURRENCIES = ["PKR", "USD", "EUR", "GBP", "AED", "SAR", "INR", "BDT"];

const STEP_LABELS = [
  "Workspace",
  "Business Profile",
  "Units & Categories",
  "Add Items",
  "Opening Stock",
  "All Set!",
];

const MAX_OB_ITEMS = 5;

// ─── Local types ──────────────────────────────────────────────────────────────

interface ObItem {
  name: string;
  unit: string;
  category: string;
  minStockLevel: string;
  trackExpiry: boolean;
}

interface CreatedItem {
  id: string;
  name: string;
  trackExpiry: boolean;
  unit: string;
}

interface StockEntry {
  itemId: string;
  itemName: string;
  trackExpiry: boolean;
  quantity: string;
  unitCost: string;
  expiryDate: string;
  batchNo: string;
}

function makeNewItem(): ObItem {
  return { name: "", unit: "pcs", category: "", minStockLevel: "0", trackExpiry: false };
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface OnboardingPageProps {
  settings: WorkspaceSettings;
  status: OnboardingStatus;
  onComplete: () => void;
  onSettingsUpdated: (settings: WorkspaceSettings) => void;
}

// ─── Chip selector ────────────────────────────────────────────────────────────

interface ChipSelectorProps {
  label: string;
  all: string[];
  selected: string[];
  customInput: string;
  onToggle: (val: string) => void;
  onSetAll: (vals: string[]) => void;
  onCustomChange: (val: string) => void;
  onAddCustom: () => void;
  placeholder: string;
}

function ChipSelector({
  label, all, selected, customInput, onToggle, onSetAll, onCustomChange, onAddCustom, placeholder,
}: ChipSelectorProps) {
  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") { e.preventDefault(); onAddCustom(); }
  }

  return (
    <div className="ob-chip-section">
      <div className="ob-chip-section-head">
        <span className="ob-chip-section-label">{label}</span>
        <div className="ob-chip-section-actions">
          <button type="button" className="ob-chip-link" onClick={() => onSetAll(all)}>Select all</button>
          <span className="ob-chip-link-sep">·</span>
          <button type="button" className="ob-chip-link" onClick={() => onSetAll([])}>Clear</button>
        </div>
      </div>
      <div className="ob-chips-row">
        {all.map((val) => (
          <button
            key={val}
            type="button"
            className={`ob-chip${selected.includes(val) ? " ob-chip--active" : ""}`}
            onClick={() => onToggle(val)}
          >
            {val}
          </button>
        ))}
      </div>
      <div className="ob-add-custom">
        <input
          className="form-input ob-add-custom-input"
          value={customInput}
          onChange={(e) => onCustomChange(e.target.value)}
          onKeyDown={handleKey}
          placeholder={placeholder}
        />
        <button
          type="button"
          className="btn btn--ghost ob-add-custom-btn"
          onClick={onAddCustom}
          disabled={!customInput.trim()}
        >
          + Add
        </button>
      </div>
    </div>
  );
}

// ─── Toggle ───────────────────────────────────────────────────────────────────

function Toggle({ checked, onChange, id }: { checked: boolean; onChange: (v: boolean) => void; id: string }) {
  return (
    <label className="ob-toggle-label" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        className="ob-toggle-input"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="ob-toggle-track">
        <span className="ob-toggle-thumb" />
      </span>
    </label>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function OnboardingPage({
  settings,
  status,
  onComplete,
  onSettingsUpdated,
}: OnboardingPageProps) {
  const initialStep = Math.min(Math.max(status.currentStep ?? 0, 0), 5);

  const [step, setStep]       = useState(initialStep);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState<string | null>(null);

  // ── Step 0: Workspace Setup ──
  const [businessName, setBusinessName] = useState(settings.name);
  const [businessType, setBusinessType] = useState<string>(settings.businessType ?? "");

  // ── Step 1: Business Profile ──
  const [locations, setLocations]     = useState<Location[]>([]);
  const [locationId, setLocationId]   = useState<string | null>(null);
  const [locationName, setLocationName] = useState("Main Branch");
  const [currency, setCurrency]       = useState(settings.currency || "PKR");
  const [ownerPhone, setOwnerPhone]   = useState(settings.ownerPhone ?? "");
  const [customCurrency, setCustomCurrency] = useState(
    CURRENCIES.includes(settings.currency) ? "" : settings.currency,
  );

  // ── Step 2: Units & Categories ──
  const [allUnits, setAllUnits]               = useState<string[]>([...DEFAULT_UNITS]);
  const [selectedUnits, setSelectedUnits]     = useState<string[]>([...DEFAULT_UNITS]);
  const [customUnitInput, setCustomUnitInput] = useState("");

  const [allCategories, setAllCategories]             = useState<string[]>([...DEFAULT_CATEGORIES]);
  const [selectedCategories, setSelectedCategories]   = useState<string[]>([...DEFAULT_CATEGORIES]);
  const [customCatInput, setCustomCatInput]           = useState("");

  // ── Step 3: Add Items ──
  const [obItems, setObItems]         = useState<ObItem[]>([makeNewItem()]);
  const [createdItems, setCreatedItems] = useState<CreatedItem[]>([]);

  // ── Step 4: Opening Stock ──
  const [stockEntries, setStockEntries] = useState<StockEntry[]>([]);
  const [stockLocationId, setStockLocationId] = useState("");

  // ── Load locations once ──
  useEffect(() => {
    getLocations()
      .then((res) => {
        const active = res.locations.filter((l) => l.isActive);
        setLocations(active);
        if (active.length > 0) {
          setLocationId(active[0].id);
          setLocationName(active[0].name);
          setStockLocationId(active[0].id);
        }
      })
      .catch(() => {});
  }, []);

  // ── Sync stock entries when items are created ──
  useEffect(() => {
    if (createdItems.length > 0) {
      setStockEntries(
        createdItems.map((item) => ({
          itemId: item.id,
          itemName: item.name,
          trackExpiry: item.trackExpiry,
          quantity: "",
          unitCost: "",
          expiryDate: "",
          batchNo: "",
        })),
      );
    }
  }, [createdItems]);

  // ── Helpers ──
  const progress = Math.round(((step + 1) / STEP_LABELS.length) * 100);

  function persistStep(nextStep: number) {
    void saveOnboardingStep(nextStep).catch(() => {});
  }

  function goNext() {
    setError(null);
    setStep((s) => Math.min(s + 1, STEP_LABELS.length - 1));
  }

  function goBack() {
    setError(null);
    setStep((s) => Math.max(s - 1, 0));
  }

  // ── Chip toggle helpers ──
  function toggleUnit(val: string) {
    setSelectedUnits((prev) =>
      prev.includes(val) ? prev.filter((u) => u !== val) : [...prev, val],
    );
  }

  function addCustomUnit() {
    const v = customUnitInput.trim();
    if (!v) return;
    if (!allUnits.includes(v)) setAllUnits((prev) => [...prev, v]);
    if (!selectedUnits.includes(v)) setSelectedUnits((prev) => [...prev, v]);
    setCustomUnitInput("");
  }

  function toggleCategory(val: string) {
    setSelectedCategories((prev) =>
      prev.includes(val) ? prev.filter((c) => c !== val) : [...prev, val],
    );
  }

  function addCustomCategory() {
    const v = customCatInput.trim();
    if (!v) return;
    if (!allCategories.includes(v)) setAllCategories((prev) => [...prev, v]);
    if (!selectedCategories.includes(v)) setSelectedCategories((prev) => [...prev, v]);
    setCustomCatInput("");
  }

  // ── Item row helpers ──
  function updateObItem<K extends keyof ObItem>(index: number, key: K, value: ObItem[K]) {
    setObItems((prev) => prev.map((item, i) => (i === index ? { ...item, [key]: value } : item)));
  }

  function addObItem() {
    const units = selectedUnits.length > 0 ? selectedUnits[0] : "pcs";
    setObItems((prev) => [...prev, { ...makeNewItem(), unit: units }]);
  }

  function removeObItem(index: number) {
    setObItems((prev) => prev.filter((_, i) => i !== index));
  }

  // ── Stock entry helpers ──
  function updateStockEntry<K extends keyof StockEntry>(index: number, key: K, value: StockEntry[K]) {
    setStockEntries((prev) => prev.map((e, i) => (i === index ? { ...e, [key]: value } : e)));
  }

  // ── Step handlers ──

  async function handleStep0() {
    if (!businessName.trim()) { setError("Business name is required."); return; }
    if (!businessType) { setError("Please select a business type to continue."); return; }
    setSaving(true); setError(null);
    try {
      const res = await updateWorkspaceSettings({ name: businessName.trim(), businessType });
      onSettingsUpdated(res.settings);
      persistStep(1);
      goNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save workspace.");
    } finally {
      setSaving(false);
    }
  }

  async function handleStep1() {
    const finalCurrency = (currency === "__custom__" ? customCurrency.trim() : currency) || "PKR";
    setSaving(true); setError(null);
    try {
      const ops: Promise<unknown>[] = [
        updateWorkspaceSettings({
          currency: finalCurrency,
          ownerPhone: ownerPhone.trim() || null,
        }),
      ];
      const origName = locations.find((l) => l.id === locationId)?.name;
      const newName  = locationName.trim();
      if (locationId && newName && newName !== origName) {
        ops.push(updateLocation(locationId, { name: newName }));
      }
      const [settingsRes] = await Promise.all(ops);
      if (settingsRes && typeof settingsRes === "object" && "settings" in settingsRes) {
        onSettingsUpdated((settingsRes as { settings: WorkspaceSettings }).settings);
      }
      persistStep(2);
      goNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile.");
    } finally {
      setSaving(false);
    }
  }

  function handleStep2() {
    persistStep(3);
    goNext();
  }

  async function handleStep3() {
    const valid = obItems.filter((item) => item.name.trim());
    if (valid.length === 0) {
      persistStep(4);
      goNext();
      return;
    }
    setSaving(true); setError(null);
    try {
      const results: CreatedItem[] = [];
      for (const item of valid) {
        const res = await createItem({
          name: item.name.trim(),
          unit: item.unit.trim() || "pcs",
          category: item.category.trim() || undefined,
          minStockLevel: Math.max(0, Number(item.minStockLevel) || 0),
          trackExpiry: item.trackExpiry,
        });
        results.push({
          id: res.item.id,
          name: res.item.name,
          trackExpiry: res.item.trackExpiry,
          unit: res.item.unit,
        });
      }
      setCreatedItems(results);
      persistStep(4);
      goNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create items.");
    } finally {
      setSaving(false);
    }
  }

  async function handleStep4() {
    const valid = stockEntries.filter(
      (e) => e.quantity.trim() && Number.isFinite(Number(e.quantity)) && Number(e.quantity) > 0,
    );
    if (valid.length === 0) {
      persistStep(5);
      goNext();
      return;
    }
    setSaving(true); setError(null);
    try {
      await Promise.all(
        valid.map((entry) =>
          stockIn({
            itemId: entry.itemId,
            quantity: Number(entry.quantity),
            unitCost: entry.unitCost.trim() ? Number(entry.unitCost) : undefined,
            expiryDate: entry.expiryDate || undefined,
            batchNo: entry.batchNo.trim() || undefined,
            locationId: stockLocationId || undefined,
            note: "Opening stock — onboarding",
          }),
        ),
      );
      persistStep(5);
      goNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add stock.");
    } finally {
      setSaving(false);
    }
  }

  async function handleFinish() {
    setSaving(true); setError(null);
    try {
      if (selectedUnits.length > 0 || selectedCategories.length > 0) {
        await updateWorkspaceSettings({
          customUnits: selectedUnits,
          customCategories: selectedCategories,
        });
      }
      await completeOnboarding();
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete setup.");
    } finally {
      setSaving(false);
    }
  }

  // ── Derived ──
  const activeCurrency = currency === "__custom__" ? customCurrency : currency;
  const validObItems   = obItems.filter((i) => i.name.trim());

  return (
    <main className="onboarding-shell">
      <section className="onboarding-card">

        {/* Brand header */}
        <div className="onboarding-brand">
          <span className="onboarding-logo">SS</span>
          <div>
            <h1 className="onboarding-brand-title">ShelfSense setup</h1>
            <p className="onboarding-brand-sub">Let's get your workspace ready in a few quick steps.</p>
          </div>
        </div>

        {/* Progress */}
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
          <div className="alert alert--error onboarding-error" role="alert">{error}</div>
        )}

        {/* ── Step 0: Workspace Setup ── */}
        {step === 0 && (
          <div className="onboarding-step">
            <h2>Tell us about your business</h2>
            <p className="ob-step-subtitle">These details personalise your ShelfSense experience.</p>

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

        {/* ── Step 1: Business Profile ── */}
        {step === 1 && (
          <div className="onboarding-step">
            <h2>Set up your business profile</h2>
            <p className="ob-step-subtitle">Configure your main branch, currency, and contact info.</p>

            <div className="form-group">
              <label className="form-label" htmlFor="ob-loc-name">
                Main branch / location name
              </label>
              <input
                id="ob-loc-name"
                className="form-input"
                value={locationName}
                onChange={(e) => setLocationName(e.target.value)}
                placeholder="e.g. Main Branch, Warehouse A, Downtown Store"
                autoFocus
              />
              <p className="onboarding-hint">This is the name for your primary storage location.</p>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label" htmlFor="ob-currency">Currency</label>
                <select
                  id="ob-currency"
                  className="form-select"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                  <option value="__custom__">Other…</option>
                </select>
                {currency === "__custom__" && (
                  <input
                    className="form-input"
                    style={{ marginTop: 8 }}
                    value={customCurrency}
                    onChange={(e) => setCustomCurrency(e.target.value)}
                    placeholder="e.g. MYR, NGN"
                    maxLength={12}
                  />
                )}
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="ob-phone">
                  Business phone <span className="onboarding-optional">(optional)</span>
                </label>
                <input
                  id="ob-phone"
                  className="form-input"
                  type="tel"
                  value={ownerPhone}
                  onChange={(e) => setOwnerPhone(e.target.value)}
                  placeholder="+92 300 1234567"
                />
              </div>
            </div>
          </div>
        )}

        {/* ── Step 2: Units & Categories ── */}
        {step === 2 && (
          <div className="onboarding-step">
            <h2>Units &amp; categories</h2>
            <p className="ob-step-subtitle">
              Choose the units and categories you'll use. These will appear in item dropdowns.
              You can customise them further later.
            </p>

            <ChipSelector
              label="Units of measure"
              all={allUnits}
              selected={selectedUnits}
              customInput={customUnitInput}
              onToggle={toggleUnit}
              onSetAll={setSelectedUnits}
              onCustomChange={setCustomUnitInput}
              onAddCustom={addCustomUnit}
              placeholder="Add custom unit (e.g. dozen, crate)"
            />

            <ChipSelector
              label="Product categories"
              all={allCategories}
              selected={selectedCategories}
              customInput={customCatInput}
              onToggle={toggleCategory}
              onSetAll={setSelectedCategories}
              onCustomChange={setCustomCatInput}
              onAddCustom={addCustomCategory}
              placeholder="Add custom category (e.g. Spices, Frozen)"
            />

            <p className="onboarding-hint">
              You can skip this and manage units/categories from the Items page at any time.
            </p>
          </div>
        )}

        {/* ── Step 3: Add Items ── */}
        {step === 3 && (
          <div className="onboarding-step">
            <h2>Add your first items</h2>
            <p className="ob-step-subtitle">
              Add up to {MAX_OB_ITEMS} items to get started. Leave all names blank to skip.
            </p>

            <div className="ob-items-list">
              {obItems.map((item, idx) => (
                <div key={idx} className="ob-item-row">
                  <div className="ob-item-row-header">
                    <span className="ob-item-row-num">Item {idx + 1}</span>
                    {obItems.length > 1 && (
                      <button
                        type="button"
                        className="ob-item-row-remove"
                        onClick={() => removeObItem(idx)}
                        aria-label="Remove item"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  <div className="ob-item-row-grid">
                    <div className="form-group">
                      <label className="form-label">Item name</label>
                      <input
                        className="form-input"
                        value={item.name}
                        onChange={(e) => updateObItem(idx, "name", e.target.value)}
                        placeholder="e.g. Milk, Rice, Paracetamol"
                        autoFocus={idx === 0}
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label">Unit</label>
                      {selectedUnits.length > 0 ? (
                        <select
                          className="form-select"
                          value={item.unit}
                          onChange={(e) => updateObItem(idx, "unit", e.target.value)}
                        >
                          {selectedUnits.map((u) => (
                            <option key={u} value={u}>{u}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          className="form-input"
                          value={item.unit}
                          onChange={(e) => updateObItem(idx, "unit", e.target.value)}
                          placeholder="pcs, kg, liter…"
                        />
                      )}
                    </div>

                    <div className="form-group">
                      <label className="form-label">Category <span className="onboarding-optional">(optional)</span></label>
                      {selectedCategories.length > 0 ? (
                        <select
                          className="form-select"
                          value={item.category}
                          onChange={(e) => updateObItem(idx, "category", e.target.value)}
                        >
                          <option value="">— None —</option>
                          {selectedCategories.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          className="form-input"
                          value={item.category}
                          onChange={(e) => updateObItem(idx, "category", e.target.value)}
                          placeholder="e.g. Dairy, Dry Goods"
                        />
                      )}
                    </div>

                    <div className="form-group">
                      <label className="form-label">Min stock <span className="onboarding-optional">(optional)</span></label>
                      <input
                        className="form-input"
                        type="number"
                        min={0}
                        step="any"
                        value={item.minStockLevel}
                        onChange={(e) => updateObItem(idx, "minStockLevel", e.target.value)}
                        placeholder="0"
                      />
                    </div>

                    <div className="form-group ob-item-expiry">
                      <label className="form-label">Track expiry?</label>
                      <div className="ob-expiry-toggle-row">
                        <Toggle
                          id={`ob-expiry-${idx}`}
                          checked={item.trackExpiry}
                          onChange={(v) => updateObItem(idx, "trackExpiry", v)}
                        />
                        <span className="ob-expiry-val">{item.trackExpiry ? "Yes" : "No"}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {obItems.length < MAX_OB_ITEMS && (
              <button
                type="button"
                className="ob-add-item-btn"
                onClick={addObItem}
              >
                + Add another item
              </button>
            )}

            <p className="onboarding-hint">
              Leave all names blank to skip — you can add items from the Items page later.
            </p>
          </div>
        )}

        {/* ── Step 4: Opening Stock ── */}
        {step === 4 && (
          <div className="onboarding-step">
            <h2>Add opening stock</h2>
            {stockEntries.length === 0 ? (
              <div className="onboarding-skip-notice">
                <span className="onboarding-skip-icon">ℹ️</span>
                <div>
                  <strong>No items were added in the previous step.</strong>
                  <p>You can add opening stock from <strong>Items → Stock In</strong> after completing setup.</p>
                </div>
              </div>
            ) : (
              <>
                <p className="ob-step-subtitle">
                  Enter the current quantity for each item you added. Leave quantity blank to skip an item.
                </p>

                {locations.length > 1 && (
                  <div className="form-group" style={{ marginBottom: 20 }}>
                    <label className="form-label" htmlFor="ob-stock-loc">Location</label>
                    <select
                      id="ob-stock-loc"
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

                <div className="ob-stock-list">
                  {stockEntries.map((entry, idx) => (
                    <div key={entry.itemId} className="ob-stock-row">
                      <div className="ob-stock-row-header">
                        <span className="ob-stock-item-name">{entry.itemName}</span>
                      </div>
                      <div className="ob-stock-row-grid">
                        <div className="form-group">
                          <label className="form-label">Quantity</label>
                          <input
                            className="form-input"
                            type="number"
                            min={0}
                            step="any"
                            value={entry.quantity}
                            onChange={(e) => updateStockEntry(idx, "quantity", e.target.value)}
                            placeholder="0"
                          />
                        </div>
                        <div className="form-group">
                          <label className="form-label">Unit cost <span className="onboarding-optional">(optional)</span></label>
                          <input
                            className="form-input"
                            type="number"
                            min={0}
                            step="any"
                            value={entry.unitCost}
                            onChange={(e) => updateStockEntry(idx, "unitCost", e.target.value)}
                            placeholder={`e.g. 120 ${activeCurrency}`}
                          />
                        </div>
                        {entry.trackExpiry && (
                          <div className="form-group">
                            <label className="form-label">Expiry date <span className="onboarding-optional">(optional)</span></label>
                            <input
                              className="form-input"
                              type="date"
                              value={entry.expiryDate}
                              onChange={(e) => updateStockEntry(idx, "expiryDate", e.target.value)}
                            />
                          </div>
                        )}
                        <div className="form-group">
                          <label className="form-label">Batch # <span className="onboarding-optional">(optional)</span></label>
                          <input
                            className="form-input"
                            value={entry.batchNo}
                            onChange={(e) => updateStockEntry(idx, "batchNo", e.target.value)}
                            placeholder="e.g. LOT-001"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            <p className="onboarding-hint">Leave all quantities blank to skip this step.</p>
          </div>
        )}

        {/* ── Step 5: Completion ── */}
        {step === 5 && (
          <div className="onboarding-step onboarding-finish">
            <div className="onboarding-finish-icon" aria-hidden="true">🎉</div>
            <h2>You're all set!</h2>
            <p>Your ShelfSense workspace is ready. Here's a summary of what you've configured:</p>

            <ul className="onboarding-summary">
              <li className="onboarding-summary-row onboarding-summary-row--done">
                <span className="onboarding-check">✓</span>
                <span>
                  Workspace <strong>{businessName}</strong>
                  {businessType
                    ? ` · ${BUSINESS_TYPES.find((t) => t.value === businessType)?.label ?? businessType}`
                    : ""}
                </span>
              </li>
              <li className="onboarding-summary-row onboarding-summary-row--done">
                <span className="onboarding-check">✓</span>
                <span>
                  Location <strong>{locationName}</strong>
                  {activeCurrency ? ` · ${activeCurrency}` : ""}
                </span>
              </li>
              <li className={`onboarding-summary-row${createdItems.length > 0 ? " onboarding-summary-row--done" : ""}`}>
                <span className="onboarding-check">{createdItems.length > 0 ? "✓" : "–"}</span>
                <span>
                  {createdItems.length > 0
                    ? `${createdItems.length} item${createdItems.length > 1 ? "s" : ""} added`
                    : "No items added yet"}
                </span>
              </li>
              <li className={`onboarding-summary-row${stockEntries.some((e) => Number(e.quantity) > 0) ? " onboarding-summary-row--done" : ""}`}>
                <span className="onboarding-check">
                  {stockEntries.some((e) => Number(e.quantity) > 0) ? "✓" : "–"}
                </span>
                <span>
                  {stockEntries.some((e) => Number(e.quantity) > 0)
                    ? "Opening stock recorded"
                    : "Stock setup skipped"}
                </span>
              </li>
            </ul>
            <p className="onboarding-hint" style={{ marginTop: 16 }}>
              You can add more items, stock, suppliers, locations, and team members at any time.
            </p>
          </div>
        )}

        {/* Footer navigation */}
        <div className="onboarding-footer">
          {step > 0 && step < 5 && (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={goBack}
              disabled={saving}
            >
              ← Back
            </button>
          )}
          {step === 5 && <div />}

          <div className="onboarding-footer-right">
            {step === 0 && (
              <button
                type="button"
                className="btn btn--primary onboarding-cta"
                onClick={() => { void handleStep0(); }}
                disabled={saving}
              >
                {saving ? "Saving…" : "Continue →"}
              </button>
            )}
            {step === 1 && (
              <button
                type="button"
                className="btn btn--primary onboarding-cta"
                onClick={() => { void handleStep1(); }}
                disabled={saving}
              >
                {saving ? "Saving…" : "Save & Continue →"}
              </button>
            )}
            {step === 2 && (
              <button
                type="button"
                className="btn btn--primary onboarding-cta"
                onClick={handleStep2}
                disabled={saving}
              >
                {selectedUnits.length + selectedCategories.length > 0
                  ? "Save & Continue →"
                  : "Skip for now →"}
              </button>
            )}
            {step === 3 && (
              <button
                type="button"
                className="btn btn--primary onboarding-cta"
                onClick={() => { void handleStep3(); }}
                disabled={saving}
              >
                {saving
                  ? "Saving…"
                  : validObItems.length > 0
                    ? `Add ${validObItems.length} Item${validObItems.length > 1 ? "s" : ""} & Continue →`
                    : "Skip for now →"}
              </button>
            )}
            {step === 4 && (
              <button
                type="button"
                className="btn btn--primary onboarding-cta"
                onClick={() => { void handleStep4(); }}
                disabled={saving}
              >
                {saving
                  ? "Saving…"
                  : stockEntries.some((e) => Number(e.quantity) > 0)
                    ? "Add Stock & Continue →"
                    : "Skip for now →"}
              </button>
            )}
            {step === 5 && (
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
