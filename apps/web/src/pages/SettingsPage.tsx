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
}

let toastSeq = 0;

const CURRENCY_OPTIONS = ["PKR"];

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

    setSaving(true);
    try {
      const res = await updateWorkspaceSettings({
        name: form.name.trim(),
        currency: form.currency,
        lowStockMultiplier,
        expiryAlertDays,
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
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Manage workspace defaults</p>
      </div>

      <form className="settings-panel" onSubmit={(e) => { void handleSubmit(e); }}>
        <div className="form-group">
          <label className="form-label">Business Name</label>
          <input
            className="form-input"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </div>

        <div className="form-row">
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

function toForm(settings: WorkspaceSettings): SettingsForm {
  return {
    name: settings.name,
    currency: settings.currency,
    lowStockMultiplier: String(settings.lowStockMultiplier),
    expiryAlertDays: String(settings.expiryAlertDays),
  };
}
