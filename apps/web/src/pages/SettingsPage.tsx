import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { updateWorkspaceSettings } from "../api/workspace";
import { useWorkspaceSettings } from "../context/WorkspaceSettingsContext";
import { DEFAULT_CATEGORY_OPTIONS, DEFAULT_UNIT_OPTIONS } from "../utils/inventoryDefaults";
import type { WorkspaceSettings } from "../types";

interface Toast {
  id: number;
  msg: string;
  type: "success" | "error";
}

interface SettingsForm {
  name: string;
  currency: string;
  lowStockMultiplier: string;
  expiryAlertDays: string;
  ownerPhone: string;
  notifyLowStock: boolean;
  notifyExpiringSoon: boolean;
  notifyExpired: boolean;
  whatsappAlertsEnabled: boolean;
  emailAlertsEnabled: boolean;
  pushAlertsEnabled: boolean;
  emailLowStock: boolean;
  emailExpiringSoon: boolean;
  emailExpired: boolean;
  dailyDigestEnabled: boolean;
}

let toastSeq = 0;

const CURRENCY_OPTIONS = [
  { value: "PKR", label: "PKR — Pakistani Rupee" },
  { value: "USD", label: "USD — US Dollar" },
  { value: "EUR", label: "EUR — Euro" },
  { value: "GBP", label: "GBP — British Pound" },
  { value: "AED", label: "AED — UAE Dirham" },
  { value: "SAR", label: "SAR — Saudi Riyal" },
  { value: "INR", label: "INR — Indian Rupee" },
];

const PHONE_PATTERN = /^[+\d\s-]{7,24}$/;

export function SettingsPage() {
  const { settings, loading, error, setSettings } = useWorkspaceSettings();
  const [form, setForm] = useState<SettingsForm>(toForm(settings));
  const [savedForm, setSavedForm] = useState<SettingsForm>(toForm(settings));
  const [saving, setSaving] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const saveBarRef = useRef<HTMLDivElement>(null);

  const effectiveUnits = (u: string[]) => (u.length > 0 ? u : DEFAULT_UNIT_OPTIONS);
  const effectiveCategories = (c: string[]) => (c.length > 0 ? c : DEFAULT_CATEGORY_OPTIONS);

  const [ucUnits, setUcUnits] = useState<string[]>(() => effectiveUnits(settings.customUnits));
  const [ucCategories, setUcCategories] = useState<string[]>(() => effectiveCategories(settings.customCategories));
  const [newUnit, setNewUnit] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [ucSaving, setUcSaving] = useState(false);

  useEffect(() => {
    const f = toForm(settings);
    setForm(f);
    setSavedForm(f);
    setUcUnits(effectiveUnits(settings.customUnits));
    setUcCategories(effectiveCategories(settings.customCategories));
  }, [settings]);

  const isDirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(savedForm),
    [form, savedForm],
  );

  function showToast(msg: string, type: "success" | "error") {
    const id = ++toastSeq;
    setToasts((prev) => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  }

  function handleDiscard() {
    setForm(savedForm);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const lowStockMultiplier = Number(form.lowStockMultiplier);
    const expiryAlertDays = Number(form.expiryAlertDays);

    if (!form.name.trim()) {
      showToast("Business name is required", "error");
      return;
    }
    if (!Number.isFinite(lowStockMultiplier) || lowStockMultiplier <= 0) {
      showToast("Reorder quantity multiplier must be greater than zero", "error");
      return;
    }
    if (!Number.isInteger(expiryAlertDays) || expiryAlertDays < 0) {
      showToast("Expiry alert days cannot be negative", "error");
      return;
    }
    const ownerPhone = form.ownerPhone.trim();
    if (ownerPhone && !isValidPhone(ownerPhone)) {
      showToast("Phone can include only +, digits, spaces, and hyphens", "error");
      return;
    }

    setSaving(true);
    try {
      const res = await updateWorkspaceSettings({
        name: form.name.trim(),
        currency: form.currency,
        lowStockMultiplier,
        expiryAlertDays,
        ownerPhone: ownerPhone || null,
        notifyLowStock: form.notifyLowStock,
        notifyExpiringSoon: form.notifyExpiringSoon,
        notifyExpired: form.notifyExpired,
        whatsappAlertsEnabled: form.whatsappAlertsEnabled,
        emailAlertsEnabled: form.emailAlertsEnabled,
        pushAlertsEnabled: form.pushAlertsEnabled,
        emailLowStock: form.emailLowStock,
        emailExpiringSoon: form.emailExpiringSoon,
        emailExpired: form.emailExpired,
        dailyDigestEnabled: form.dailyDigestEnabled,
      });
      setSettings(res.settings);
      setSavedForm(toForm(res.settings));
      showToast("Settings saved", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to save settings", "error");
    } finally {
      setSaving(false);
    }
  }

  async function saveUnitsCategories() {
    setUcSaving(true);
    try {
      const res = await updateWorkspaceSettings({
        customUnits: ucUnits,
        customCategories: ucCategories,
      });
      setSettings(res.settings);
      showToast("Units & categories saved", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to save", "error");
    } finally {
      setUcSaving(false);
    }
  }

  function addUnit() {
    const v = newUnit.trim();
    if (!v || ucUnits.includes(v)) return;
    setUcUnits((prev) => [...prev, v]);
    setNewUnit("");
  }

  function removeUnit(u: string) {
    setUcUnits((prev) => prev.filter((x) => x !== u));
  }

  function addCategory() {
    const v = newCategory.trim();
    if (!v || ucCategories.includes(v)) return;
    setUcCategories((prev) => [...prev, v]);
    setNewCategory("");
  }

  function removeCategory(c: string) {
    setUcCategories((prev) => prev.filter((x) => x !== c));
  }

  if (loading) {
    return (
      <div className="page-loading">
        <div className="spinner" />
        <p>Loading settings...</p>
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

  const expiryDaysNum = Number(form.expiryAlertDays);

  return (
    <div className="settings-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Configure your workspace, inventory rules, and notification preferences.</p>
        </div>
      </div>

      <Link to="/settings/billing" className="settings-billing-link-card">
        <div>
          <div className="settings-billing-link-title">Billing & Subscription</div>
          <div className="settings-billing-link-desc">View your plan, subscription status, and payment history</div>
        </div>
        <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 18, height: 18, color: "#6366f1", flexShrink: 0 }} aria-hidden="true">
          <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
        </svg>
      </Link>

      <form onSubmit={(e) => { void handleSubmit(e); }}>

        {/* ── Workspace ── */}
        <div className="stg-card">
          <div className="stg-card-header">
            <div className="stg-card-icon stg-card-icon--indigo">
              <svg viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4 4a2 2 0 012-2h8a2 2 0 012 2v12a1 1 0 110 2h-3a1 1 0 01-1-1v-2a1 1 0 00-1-1H9a1 1 0 00-1 1v2a1 1 0 01-1 1H4a1 1 0 110-2V4zm3 1h2v2H7V5zm2 4H7v2h2V9zm2-4h2v2h-2V5zm2 4h-2v2h2V9z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="stg-card-title">
              <h2>Workspace</h2>
              <p>Business details that appear across reports, alerts, and the app.</p>
            </div>
          </div>
          <div className="stg-card-body">
            <div className="stg-field">
              <label className="stg-label" htmlFor="ws-name">Business Name</label>
              <input
                id="ws-name"
                className="form-input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="My Business"
                required
              />
            </div>
            <div className="stg-row">
              <div className="stg-field">
                <label className="stg-label" htmlFor="ws-currency">Currency</label>
                <select
                  id="ws-currency"
                  className="form-select"
                  value={form.currency}
                  onChange={(e) => setForm({ ...form, currency: e.target.value })}
                >
                  {CURRENCY_OPTIONS.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
                <span className="stg-hint">Used in cost calculations and reports</span>
              </div>
              <div className="stg-field">
                <label className="stg-label" htmlFor="ws-phone">Owner Phone</label>
                <input
                  id="ws-phone"
                  className="form-input"
                  type="tel"
                  value={form.ownerPhone}
                  onChange={(e) => setForm({ ...form, ownerPhone: e.target.value })}
                  placeholder="+92 300 0000000"
                />
                <span className="stg-hint">Used for future WhatsApp alert delivery</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Inventory Rules ── */}
        <div className="stg-card">
          <div className="stg-card-header">
            <div className="stg-card-icon stg-card-icon--orange">
              <svg viewBox="0 0 20 20" fill="currentColor">
                <path d="M4 3a2 2 0 100 4h12a2 2 0 100-4H4z" />
                <path fillRule="evenodd" d="M3 8h14v7a2 2 0 01-2 2H5a2 2 0 01-2-2V8zm5 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="stg-card-title">
              <h2>Inventory Rules</h2>
              <p>Thresholds that control when stock health warnings appear.</p>
            </div>
          </div>
          <div className="stg-card-body stg-rules-body">
            <div className="stg-rule-row">
              <div className="stg-rule-info">
                <div className="stg-rule-name">Reorder Quantity Multiplier</div>
                <div className="stg-rule-desc">
                  When a reorder is suggested, the recommended order quantity is{" "}
                  <strong>{form.lowStockMultiplier || "?"}× the item's alert threshold</strong>.
                  Each item's threshold is set individually when the item is created.
                </div>
              </div>
              <div className="stg-rule-control">
                <input
                  className="stg-number-input"
                  type="number"
                  min={0.01}
                  step="any"
                  value={form.lowStockMultiplier}
                  onChange={(e) => setForm({ ...form, lowStockMultiplier: e.target.value })}
                  required
                />
                <span className="stg-number-unit">×</span>
              </div>
            </div>
            <div className="stg-rule-divider" />
            <div className="stg-rule-row">
              <div className="stg-rule-info">
                <div className="stg-rule-name">Expiry Alert Window</div>
                <div className="stg-rule-desc">
                  Batches expiring within{" "}
                  <strong>{Number.isFinite(expiryDaysNum) && expiryDaysNum >= 0 ? expiryDaysNum : "?"} {expiryDaysNum === 1 ? "day" : "days"}</strong>{" "}
                  are flagged as "expiring soon" in alerts and on the dashboard.
                </div>
              </div>
              <div className="stg-rule-control">
                <input
                  className="stg-number-input"
                  type="number"
                  min={0}
                  step={1}
                  value={form.expiryAlertDays}
                  onChange={(e) => setForm({ ...form, expiryAlertDays: e.target.value })}
                  required
                />
                <span className="stg-number-unit">days</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Alert Preferences ── */}
        <div className="stg-card">
          <div className="stg-card-header">
            <div className="stg-card-icon stg-card-icon--amber">
              <svg viewBox="0 0 20 20" fill="currentColor">
                <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
              </svg>
            </div>
            <div className="stg-card-title">
              <h2>Alert Preferences</h2>
              <p>Choose which inventory events generate in-app alerts and email notifications.</p>
            </div>
          </div>
          <div className="stg-card-body">
            <div className="stg-alert-header-row">
              <span className="stg-alert-header-label">Alert type</span>
              <span className="stg-alert-header-channels">
                <span className="stg-channel-label">In-app</span>
                <span className="stg-channel-label">Email</span>
              </span>
            </div>
            <AlertRow
              color="#ef4444"
              icon={
                <svg viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              }
              label="Low stock alerts"
              desc="Triggered when an item's available quantity drops below its configured threshold."
              checked={form.notifyLowStock}
              onChange={(v) => setForm({ ...form, notifyLowStock: v })}
              emailChecked={form.emailLowStock}
              onEmailChange={(v) => setForm({ ...form, emailLowStock: v })}
            />
            <AlertRow
              color="#f59e0b"
              icon={
                <svg viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                </svg>
              }
              label="Expiring soon alerts"
              desc={`Triggered when a stock batch will expire within ${Number.isFinite(expiryDaysNum) && expiryDaysNum >= 0 ? expiryDaysNum : "?"} ${expiryDaysNum === 1 ? "day" : "days"} (your current alert window).`}
              checked={form.notifyExpiringSoon}
              onChange={(v) => setForm({ ...form, notifyExpiringSoon: v })}
              emailChecked={form.emailExpiringSoon}
              onEmailChange={(v) => setForm({ ...form, emailExpiringSoon: v })}
            />
            <AlertRow
              color="#6b7280"
              icon={
                <svg viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M13.477 14.89A6 6 0 015.11 6.524l8.367 8.368zm1.414-1.414L6.524 5.11a6 6 0 018.367 8.367zM18 10a8 8 0 11-16 0 8 8 0 0116 0z" clipRule="evenodd" />
                </svg>
              }
              label="Expired stock alerts"
              desc="Triggered when a batch's expiry date has passed and it is still tracked in inventory."
              checked={form.notifyExpired}
              onChange={(v) => setForm({ ...form, notifyExpired: v })}
              emailChecked={form.emailExpired}
              onEmailChange={(v) => setForm({ ...form, emailExpired: v })}
            />
            <div className="stg-alert-row stg-alert-row--dual">
              <span className="stg-alert-icon" style={{ background: "#6366f118", color: "#6366f1" }}>
                <svg viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
                </svg>
              </span>
              <span className="stg-alert-copy">
                <span className="stg-alert-label">Daily summary email</span>
                <span className="stg-alert-desc">Sent once per day at 8:00 AM — a combined summary of all active low stock, expiring, and expired stock.</span>
              </span>
              <span className="stg-dual-toggles">
                <span style={{ width: "44px", display: "inline-block" }} />
                <label className="stg-toggle-wrap" title="Daily summary email">
                  <input
                    type="checkbox"
                    className="stg-toggle-input"
                    checked={form.dailyDigestEnabled}
                    onChange={(e) => setForm({ ...form, dailyDigestEnabled: e.target.checked })}
                  />
                  <span className="stg-toggle-track" aria-hidden="true" />
                </label>
              </span>
            </div>
            <p className="stg-email-hint">
              Email alerts are delivered to the workspace owner's registered address when SMTP is configured.
            </p>
          </div>
        </div>

        {/* ── Notification Channels ── */}
        <div className="stg-card stg-card--muted">
          <div className="stg-card-header">
            <div className="stg-card-icon stg-card-icon--violet">
              <svg viewBox="0 0 20 20" fill="currentColor">
                <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
              </svg>
            </div>
            <div className="stg-card-title">
              <h2>
                Additional Channels
                <span className="stg-coming-soon-badge">Coming soon</span>
              </h2>
              <p>Save preferences now — they'll activate automatically when each channel goes live.</p>
            </div>
          </div>
          <div className="stg-card-body stg-alerts-body">
            <AlertRow
              color="#25d366"
              icon={
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                </svg>
              }
              label="WhatsApp"
              desc="Send alert messages to the owner phone number via WhatsApp."
              checked={form.whatsappAlertsEnabled}
              onChange={(v) => setForm({ ...form, whatsappAlertsEnabled: v })}
              comingSoon
            />
            <AlertRow
              color="#0ea5e9"
              icon={
                <svg viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
                </svg>
              }
              label="Push notifications"
              desc="Browser and mobile push notifications for urgent stock events."
              checked={form.pushAlertsEnabled}
              onChange={(v) => setForm({ ...form, pushAlertsEnabled: v })}
              comingSoon
            />
          </div>
        </div>

        {/* ── Fallback save button (always visible) ── */}
        <div className="stg-footer-actions">
          <button
            type="submit"
            className="btn btn--primary"
            disabled={saving || !form.name.trim()}
          >
            {saving ? <span className="btn-spinner" /> : null}
            {saving ? "Saving…" : "Save Settings"}
          </button>
        </div>
      </form>

      {/* ── Units & Categories ── */}
      <div className="stg-card">
        <div className="stg-card-header">
          <div className="stg-card-icon stg-card-icon--teal">
            <svg viewBox="0 0 20 20" fill="currentColor">
              <path d="M7 3a1 1 0 000 2h6a1 1 0 100-2H7zM4 7a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1zM2 11a2 2 0 012-2h12a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4z" />
            </svg>
          </div>
          <div className="stg-card-title">
            <h2>Units &amp; Categories</h2>
            <p>Customize the units of measurement and item categories used when adding or editing inventory.</p>
          </div>
        </div>
        <div className="stg-card-body">
          <div className="uc-section">
            <div className="uc-section-header">
              <div className="uc-section-label">Units of Measurement</div>
              <button
                type="button"
                className="uc-reset-link"
                onClick={() => setUcUnits(DEFAULT_UNIT_OPTIONS)}
                disabled={JSON.stringify(ucUnits) === JSON.stringify(DEFAULT_UNIT_OPTIONS)}
              >
                Reset to defaults
              </button>
            </div>
            <div className="uc-chips">
              {ucUnits.length === 0 && (
                <span className="uc-empty">All units removed — saving will restore defaults on next load.</span>
              )}
              {ucUnits.map((u) => (
                <span key={u} className="uc-chip">
                  {u}
                  <button
                    type="button"
                    className="uc-chip-remove"
                    onClick={() => removeUnit(u)}
                    aria-label={`Remove ${u}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="uc-add-row">
              <input
                className="form-input uc-add-input"
                value={newUnit}
                onChange={(e) => setNewUnit(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addUnit(); } }}
                placeholder="e.g. carton, tray…"
                maxLength={32}
              />
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                onClick={addUnit}
                disabled={!newUnit.trim() || ucUnits.includes(newUnit.trim())}
              >
                Add
              </button>
            </div>
          </div>

          <div className="uc-section">
            <div className="uc-section-header">
              <div className="uc-section-label">Item Categories</div>
              <button
                type="button"
                className="uc-reset-link"
                onClick={() => setUcCategories(DEFAULT_CATEGORY_OPTIONS)}
                disabled={JSON.stringify(ucCategories) === JSON.stringify(DEFAULT_CATEGORY_OPTIONS)}
              >
                Reset to defaults
              </button>
            </div>
            <div className="uc-chips">
              {ucCategories.length === 0 && (
                <span className="uc-empty">All categories removed — saving will restore defaults on next load.</span>
              )}
              {ucCategories.map((c) => (
                <span key={c} className="uc-chip">
                  {c}
                  <button
                    type="button"
                    className="uc-chip-remove"
                    onClick={() => removeCategory(c)}
                    aria-label={`Remove ${c}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="uc-add-row">
              <input
                className="form-input uc-add-input"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCategory(); } }}
                placeholder="e.g. Dairy, Produce…"
                maxLength={48}
              />
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                onClick={addCategory}
                disabled={!newCategory.trim() || ucCategories.includes(newCategory.trim())}
              >
                Add
              </button>
            </div>
          </div>
        </div>
        <div className="stg-footer-actions stg-footer-actions--card">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => { void saveUnitsCategories(); }}
            disabled={ucSaving}
          >
            {ucSaving ? <span className="btn-spinner" /> : null}
            {ucSaving ? "Saving…" : "Save Units & Categories"}
          </button>
        </div>
      </div>

      {/* ── Sticky unsaved-changes bar ── */}
      {isDirty && (
        <div className="stg-save-bar" ref={saveBarRef}>
          <div className="stg-save-bar-inner">
            <div className="stg-save-bar-msg">
              <span className="stg-save-bar-dot" />
              You have unsaved changes
            </div>
            <div className="stg-save-bar-actions">
              <button
                type="button"
                className="btn btn--ghost stg-save-bar-discard"
                onClick={handleDiscard}
                disabled={saving}
              >
                Discard
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={saving || !form.name.trim()}
                onClick={(e) => { void handleSubmit(e as unknown as React.FormEvent); }}
              >
                {saving ? <span className="btn-spinner" /> : null}
                {saving ? "Saving…" : "Save Settings"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.type}`}>{t.msg}</div>
        ))}
      </div>
    </div>
  );
}

/* ── Alert row ── */

function AlertRow({
  color,
  icon,
  label,
  desc,
  checked,
  onChange,
  emailChecked,
  onEmailChange,
  comingSoon,
}: {
  color: string;
  icon: React.ReactNode;
  label: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  emailChecked?: boolean;
  onEmailChange?: (v: boolean) => void;
  comingSoon?: boolean;
}) {
  const hasDualToggle = emailChecked !== undefined && onEmailChange !== undefined;

  if (hasDualToggle) {
    return (
      <div className={`stg-alert-row stg-alert-row--dual${comingSoon ? " stg-alert-row--muted" : ""}`}>
        <span className="stg-alert-icon" style={{ background: color + "18", color }}>
          {icon}
        </span>
        <span className="stg-alert-copy">
          <span className="stg-alert-label">{label}</span>
          <span className="stg-alert-desc">{desc}</span>
        </span>
        <span className="stg-dual-toggles">
          <label className="stg-toggle-wrap" title="In-app notifications">
            <input
              type="checkbox"
              className="stg-toggle-input"
              checked={checked}
              onChange={(e) => onChange(e.target.checked)}
            />
            <span className="stg-toggle-track" aria-hidden="true" />
          </label>
          <label className="stg-toggle-wrap" title="Email notifications">
            <input
              type="checkbox"
              className="stg-toggle-input"
              checked={emailChecked}
              onChange={(e) => onEmailChange(e.target.checked)}
            />
            <span className="stg-toggle-track" aria-hidden="true" />
          </label>
        </span>
      </div>
    );
  }

  return (
    <label className={`stg-alert-row${comingSoon ? " stg-alert-row--muted" : ""}`}>
      <span className="stg-alert-icon" style={{ background: color + "18", color }}>
        {icon}
      </span>
      <span className="stg-alert-copy">
        <span className="stg-alert-label">
          {label}
          {comingSoon && <span className="stg-inline-soon">soon</span>}
        </span>
        <span className="stg-alert-desc">{desc}</span>
      </span>
      <input
        type="checkbox"
        className="stg-toggle-input"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="stg-toggle-track" aria-hidden="true" />
    </label>
  );
}

/* ── Utilities ── */

function toForm(settings: WorkspaceSettings): SettingsForm {
  return {
    name: settings.name,
    currency: settings.currency,
    lowStockMultiplier: String(settings.lowStockMultiplier),
    expiryAlertDays: String(settings.expiryAlertDays),
    ownerPhone: settings.ownerPhone ?? "",
    notifyLowStock: settings.notifyLowStock,
    notifyExpiringSoon: settings.notifyExpiringSoon,
    notifyExpired: settings.notifyExpired,
    whatsappAlertsEnabled: settings.whatsappAlertsEnabled,
    emailAlertsEnabled: settings.emailAlertsEnabled,
    pushAlertsEnabled: settings.pushAlertsEnabled,
    emailLowStock: settings.emailLowStock,
    emailExpiringSoon: settings.emailExpiringSoon,
    emailExpired: settings.emailExpired,
    dailyDigestEnabled: settings.dailyDigestEnabled,
  };
}

function isValidPhone(value: string) {
  return PHONE_PATTERN.test(value) && /\d{7,}/.test(value.replace(/\D/g, ""));
}
