import { useEffect, useState } from "react";
import { updateWorkspaceSettings } from "../api/workspace";
import { useWorkspaceSettings } from "../context/WorkspaceSettingsContext";
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
}

let toastSeq = 0;

const CURRENCY_OPTIONS = ["PKR"];
const PHONE_PATTERN = /^[+\d\s-]{7,24}$/;

export function SettingsPage() {
  const { settings, loading, error, setSettings } = useWorkspaceSettings();
  const [form, setForm] = useState<SettingsForm>(toForm(settings));
  const [saving, setSaving] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    setForm(toForm(settings));
  }, [settings]);

  function showToast(msg: string, type: "success" | "error") {
    const id = ++toastSeq;
    setToasts((prev) => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((toast) => toast.id !== id)), 3500);
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
      showToast("Low stock multiplier must be greater than zero", "error");
      return;
    }

    if (!Number.isInteger(expiryAlertDays) || expiryAlertDays < 0) {
      showToast("Expiry alert days cannot be negative", "error");
      return;
    }

    const ownerPhone = form.ownerPhone.trim();
    if (ownerPhone && !isValidPhone(ownerPhone)) {
      showToast("Owner phone can include only +, digits, spaces, and hyphen", "error");
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
      });
      setSettings(res.settings);
      showToast("Settings saved", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to save settings", "error");
    } finally {
      setSaving(false);
    }
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

  return (
    <div className="settings-page">
      <div className="page-header">
        <h1 className="page-title">Workspace settings</h1>
        <p className="page-subtitle">Configure business defaults, inventory rules, and notification preferences.</p>
      </div>

      <form className="settings-panel" onSubmit={(e) => { void handleSubmit(e); }}>
        <section className="settings-section">
          <div className="settings-section-heading">
            <h2>Workspace</h2>
            <p>Basic business details used across ShelfSense.</p>
          </div>

          <div className="form-group">
            <label className="form-label">Business Name</label>
            <input
              className="form-input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Currency</label>
            <select
              className="form-select"
              value={form.currency}
              onChange={(e) => setForm({ ...form, currency: e.target.value })}
            >
              {CURRENCY_OPTIONS.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-heading">
            <h2>Inventory Rules</h2>
            <p>Thresholds used for stock health and expiry warnings.</p>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Low Stock Multiplier</label>
              <input
                className="form-input"
                type="number"
                min={0.01}
                step="any"
                value={form.lowStockMultiplier}
                onChange={(e) => setForm({ ...form, lowStockMultiplier: e.target.value })}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Expiry Alert Days</label>
              <input
                className="form-input"
                type="number"
                min={0}
                step={1}
                value={form.expiryAlertDays}
                onChange={(e) => setForm({ ...form, expiryAlertDays: e.target.value })}
                required
              />
            </div>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-heading">
            <h2>Notification Preferences</h2>
            <p>Choose which inventory risks create in-app notifications now and save future channel preferences.</p>
          </div>

          <div className="form-group">
            <label className="form-label">Owner phone number</label>
            <input
              className="form-input"
              type="tel"
              value={form.ownerPhone}
              onChange={(e) => setForm({ ...form, ownerPhone: e.target.value })}
              placeholder="+92 300 0000000"
            />
          </div>

          <div className="settings-toggle-list">
            <SettingsToggle
              label="Low stock alerts"
              checked={form.notifyLowStock}
              onChange={(checked) => setForm({ ...form, notifyLowStock: checked })}
            />
            <SettingsToggle
              label="Expiring soon alerts"
              checked={form.notifyExpiringSoon}
              onChange={(checked) => setForm({ ...form, notifyExpiringSoon: checked })}
            />
            <SettingsToggle
              label="Expired stock alerts"
              checked={form.notifyExpired}
              onChange={(checked) => setForm({ ...form, notifyExpired: checked })}
            />
            <SettingsToggle
              label="WhatsApp alerts"
              helper="Coming soon — preference saved for future alerts."
              checked={form.whatsappAlertsEnabled}
              onChange={(checked) => setForm({ ...form, whatsappAlertsEnabled: checked })}
            />
            <SettingsToggle
              label="Email alerts"
              helper="Coming soon — preference saved for future alerts."
              checked={form.emailAlertsEnabled}
              onChange={(checked) => setForm({ ...form, emailAlertsEnabled: checked })}
            />
            <SettingsToggle
              label="Push alerts"
              helper="Coming soon — preference saved for future alerts."
              checked={form.pushAlertsEnabled}
              onChange={(checked) => setForm({ ...form, pushAlertsEnabled: checked })}
            />
          </div>
        </section>

        <div className="settings-actions">
          <button
            type="submit"
            className="btn btn--primary"
            disabled={saving || !form.name.trim()}
          >
            {saving ? <span className="btn-spinner" /> : null}
            {saving ? "Saving..." : "Save Settings"}
          </button>
        </div>
      </form>

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

function SettingsToggle({
  label,
  helper,
  checked,
  onChange,
}: {
  label: string;
  helper?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="settings-toggle">
      <span className="settings-toggle-copy">
        <span className="settings-toggle-label">{label}</span>
        {helper ? <span className="settings-toggle-helper">{helper}</span> : null}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="settings-toggle-track" aria-hidden="true" />
    </label>
  );
}

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
  };
}

function isValidPhone(value: string) {
  return PHONE_PATTERN.test(value) && /\d{7,}/.test(value.replace(/\D/g, ""));
}
