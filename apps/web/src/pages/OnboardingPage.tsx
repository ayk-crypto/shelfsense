import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createItem } from "../api/items";
import { createLocation } from "../api/locations";
import { completeOnboarding } from "../api/onboarding";
import { createTeamUser } from "../api/team";
import { updateWorkspaceSettings } from "../api/workspace";
import type { OnboardingStatus, Role, WorkspaceSettings } from "../types";

interface OnboardingPageProps {
  settings: WorkspaceSettings;
  status: OnboardingStatus;
  onComplete: () => void;
  onSettingsUpdated: (settings: WorkspaceSettings) => void;
}

const CURRENCY_OPTIONS = ["PKR"];
const STEPS = ["Business Setup", "Branch Setup", "Add Items", "Invite Team", "Finish"];

export function OnboardingPage({
  settings,
  status,
  onComplete,
  onSettingsUpdated,
}: OnboardingPageProps) {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [businessForm, setBusinessForm] = useState({
    name: settings.name,
    currency: settings.currency,
    expiryAlertDays: String(settings.expiryAlertDays),
  });
  const [branchName, setBranchName] = useState("");
  const [branchDone, setBranchDone] = useState(status.hasLocations);
  const [itemForm, setItemForm] = useState({
    name: "",
    unit: "pcs",
    category: "",
    minStockLevel: "0",
    trackExpiry: false,
  });
  const [itemDone, setItemDone] = useState(status.hasItems);
  const [teamForm, setTeamForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "OPERATOR" as Exclude<Role, "OWNER">,
  });
  const [teamDone, setTeamDone] = useState(false);

  const progress = Math.round(((step + 1) / STEPS.length) * 100);

  function next() {
    setError(null);
    setStep((current) => Math.min(current + 1, STEPS.length - 1));
  }

  function back() {
    setError(null);
    setStep((current) => Math.max(current - 1, 0));
  }

  async function saveBusinessAndContinue() {
    const expiryAlertDays = Number(businessForm.expiryAlertDays);

    if (!businessForm.name.trim()) {
      setError("Business name is required.");
      return;
    }

    if (!Number.isInteger(expiryAlertDays) || expiryAlertDays < 0) {
      setError("Expiry alert days cannot be negative.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await updateWorkspaceSettings({
        name: businessForm.name.trim(),
        currency: businessForm.currency,
        expiryAlertDays,
      });
      onSettingsUpdated(res.settings);
      next();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save business setup.");
    } finally {
      setSaving(false);
    }
  }

  async function addBranchAndContinue() {
    if (!branchName.trim()) {
      next();
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await createLocation({ name: branchName.trim() });
      setBranchDone(true);
      next();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add branch.");
    } finally {
      setSaving(false);
    }
  }

  async function addItemAndContinue() {
    if (!itemForm.name.trim()) {
      next();
      return;
    }

    const minStockLevel = Number(itemForm.minStockLevel);
    if (!itemForm.unit.trim()) {
      setError("Item unit is required.");
      return;
    }

    if (!Number.isFinite(minStockLevel) || minStockLevel < 0) {
      setError("Minimum stock level cannot be negative.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await createItem({
        name: itemForm.name.trim(),
        unit: itemForm.unit.trim(),
        category: itemForm.category.trim() || undefined,
        minStockLevel,
        trackExpiry: itemForm.trackExpiry,
      });
      setItemDone(true);
      next();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add item.");
    } finally {
      setSaving(false);
    }
  }

  async function inviteUserAndContinue() {
    const anyTeamField = teamForm.name.trim() || teamForm.email.trim() || teamForm.password.trim();
    if (!anyTeamField) {
      next();
      return;
    }

    if (!teamForm.name.trim() || !teamForm.email.trim() || !teamForm.password.trim()) {
      setError("Name, email, and password are required to invite a team member.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await createTeamUser({
        name: teamForm.name.trim(),
        email: teamForm.email.trim(),
        password: teamForm.password,
        role: teamForm.role,
      });
      setTeamDone(true);
      next();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to invite team member.");
    } finally {
      setSaving(false);
    }
  }

  async function finish() {
    setSaving(true);
    setError(null);
    try {
      await completeOnboarding();
      onComplete();
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to finish onboarding.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="onboarding-shell">
      <section className="onboarding-card">
        <div className="onboarding-brand">
          <span className="onboarding-logo">SS</span>
          <div>
            <h1>ShelfSense setup</h1>
            <p>Let's get your workspace ready in a few small steps.</p>
          </div>
        </div>

        <div className="onboarding-progress" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
          <div className="onboarding-progress-head">
            <span>{STEPS[step]}</span>
            <strong>{step + 1}/{STEPS.length}</strong>
          </div>
          <div className="onboarding-progress-track">
            <span style={{ width: `${progress}%` }} />
          </div>
        </div>

        {error && <div className="alert alert--error onboarding-error">{error}</div>}

        {step === 0 && (
          <div className="onboarding-step">
            <h2>Business Setup</h2>
            <p>These basics appear across reports, alerts, and workspace settings.</p>
            <div className="form-group">
              <label className="form-label">Business name</label>
              <input
                className="form-input"
                value={businessForm.name}
                onChange={(event) => setBusinessForm({ ...businessForm, name: event.target.value })}
              />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Currency</label>
                <select
                  className="form-select"
                  value={businessForm.currency}
                  onChange={(event) => setBusinessForm({ ...businessForm, currency: event.target.value })}
                >
                  {CURRENCY_OPTIONS.map((currency) => (
                    <option key={currency} value={currency}>{currency}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Expiry alert days</label>
                <input
                  className="form-input"
                  type="number"
                  min={0}
                  step={1}
                  value={businessForm.expiryAlertDays}
                  onChange={(event) => setBusinessForm({ ...businessForm, expiryAlertDays: event.target.value })}
                />
              </div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="onboarding-step">
            <h2>Branch Setup</h2>
            <p>Your workspace already has <strong>Main Branch</strong>. Add another branch now, or skip and do it later.</p>
            {branchDone && <span className="onboarding-pill">Branch setup started</span>}
            <div className="form-group">
              <label className="form-label">Another branch name</label>
              <input
                className="form-input"
                value={branchName}
                onChange={(event) => setBranchName(event.target.value)}
                placeholder="e.g. Gulberg Branch"
              />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="onboarding-step">
            <h2>Add Items</h2>
            <p>Add one starter item now, import from the Items page after setup, or skip for now.</p>
            {itemDone && <span className="onboarding-pill">Inventory has at least one item</span>}
            <div className="onboarding-action-grid">
              <div className="onboarding-option onboarding-option--active">
                <h3>Add item manually</h3>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Item name</label>
                    <input
                      className="form-input"
                      value={itemForm.name}
                      onChange={(event) => setItemForm({ ...itemForm, name: event.target.value })}
                      placeholder="e.g. Milk"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Unit</label>
                    <input
                      className="form-input"
                      value={itemForm.unit}
                      onChange={(event) => setItemForm({ ...itemForm, unit: event.target.value })}
                      placeholder="pcs, kg, ltr"
                    />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Category</label>
                    <input
                      className="form-input"
                      value={itemForm.category}
                      onChange={(event) => setItemForm({ ...itemForm, category: event.target.value })}
                      placeholder="Optional"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Min stock level</label>
                    <input
                      className="form-input"
                      type="number"
                      min={0}
                      step="any"
                      value={itemForm.minStockLevel}
                      onChange={(event) => setItemForm({ ...itemForm, minStockLevel: event.target.value })}
                    />
                  </div>
                </div>
                <label className="form-group form-group--inline">
                  <input
                    type="checkbox"
                    checked={itemForm.trackExpiry}
                    onChange={(event) => setItemForm({ ...itemForm, trackExpiry: event.target.checked })}
                  />
                  <span className="form-label form-label--check">Track expiry for this item</span>
                </label>
              </div>
              <div className="onboarding-option">
                <h3>Import items via CSV/Excel</h3>
                <p>Skip setup, then use <strong>Items / Import Items</strong> for bulk upload.</p>
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="onboarding-step">
            <h2>Invite Team</h2>
            <p>Add a manager/operator now, or skip and invite people later from Team.</p>
            {teamDone && <span className="onboarding-pill">Team member invited</span>}
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Name</label>
                <input
                  className="form-input"
                  value={teamForm.name}
                  onChange={(event) => setTeamForm({ ...teamForm, name: event.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input
                  className="form-input"
                  type="email"
                  value={teamForm.email}
                  onChange={(event) => setTeamForm({ ...teamForm, email: event.target.value })}
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Temporary password</label>
                <input
                  className="form-input"
                  type="password"
                  value={teamForm.password}
                  onChange={(event) => setTeamForm({ ...teamForm, password: event.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Role</label>
                <select
                  className="form-select"
                  value={teamForm.role}
                  onChange={(event) => setTeamForm({ ...teamForm, role: event.target.value as Exclude<Role, "OWNER"> })}
                >
                  <option value="MANAGER">Manager</option>
                  <option value="OPERATOR">Operator</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="onboarding-step onboarding-finish">
            <h2>You're ready to run ShelfSense</h2>
            <p>You can add more inventory, suppliers, team members, and alert preferences anytime from the main app.</p>
            <div className="onboarding-summary">
              <span>Business setup saved</span>
              <span>{branchDone ? "Branch setup started" : "Branch skipped"}</span>
              <span>{itemDone ? "Item added" : "Items skipped"}</span>
              <span>{teamDone ? "Team invited" : "Team skipped"}</span>
            </div>
          </div>
        )}

        <div className="onboarding-footer">
          <button type="button" className="btn btn--ghost" onClick={back} disabled={step === 0 || saving}>
            Back
          </button>
          {step === 0 && (
            <button type="button" className="btn btn--primary" onClick={() => { void saveBusinessAndContinue(); }} disabled={saving}>
              {saving ? "Saving..." : "Continue"}
            </button>
          )}
          {step === 1 && (
            <button type="button" className="btn btn--primary" onClick={() => { void addBranchAndContinue(); }} disabled={saving}>
              {saving ? "Saving..." : branchName.trim() ? "Add branch" : "Skip for now"}
            </button>
          )}
          {step === 2 && (
            <button type="button" className="btn btn--primary" onClick={() => { void addItemAndContinue(); }} disabled={saving}>
              {saving ? "Saving..." : itemForm.name.trim() ? "Add item" : "Skip for now"}
            </button>
          )}
          {step === 3 && (
            <button type="button" className="btn btn--primary" onClick={() => { void inviteUserAndContinue(); }} disabled={saving}>
              {saving ? "Saving..." : teamForm.name.trim() || teamForm.email.trim() || teamForm.password.trim() ? "Invite user" : "Skip for now"}
            </button>
          )}
          {step === 4 && (
            <button type="button" className="btn btn--primary" onClick={() => { void finish(); }} disabled={saving}>
              {saving ? "Finishing..." : "Go to Dashboard"}
            </button>
          )}
        </div>
      </section>
    </main>
  );
}
