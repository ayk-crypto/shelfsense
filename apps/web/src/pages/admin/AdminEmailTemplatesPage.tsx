import { useEffect, useState } from "react";
import { getAdminEmailTemplates, getAdminEmailTemplate, updateAdminEmailTemplate, resetAdminEmailTemplate, testAdminEmailTemplate } from "../../api/admin";
import type { AdminEmailTemplate } from "../../types";

export function AdminEmailTemplatesPage() {
  const [templates, setTemplates] = useState<AdminEmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);

  function load() {
    setLoading(true);
    getAdminEmailTemplates()
      .then((r) => setTemplates(r.templates))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  function showToast(type: "success" | "error", text: string) {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3500);
  }

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Email Templates</h1>
          <p className="admin-page-subtitle">Manage and customize transactional email templates delivered to workspace users</p>
        </div>
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
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Template</th>
                <th>Key</th>
                <th>Subject</th>
                <th>Status</th>
                <th>Last Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.key}>
                  <td>{t.name}</td>
                  <td><code className="admin-code">{t.key}</code></td>
                  <td className="admin-muted" style={{ maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.subject}</td>
                  <td>
                    {t.isDefault
                      ? <span className="admin-badge admin-badge--gray">Default</span>
                      : t.enabled
                        ? <span className="admin-badge admin-badge--green">Enabled</span>
                        : <span className="admin-badge admin-badge--red">Disabled</span>}
                  </td>
                  <td className="admin-muted">
                    {t.updatedAt ? new Date(t.updatedAt).toLocaleDateString() : "Never customized"}
                  </td>
                  <td>
                    <div className="admin-actions">
                      <button className="admin-action-btn" onClick={() => setEditingKey(t.key)}>Edit</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editingKey && (
        <TemplateModal
          templateKey={editingKey}
          onClose={() => setEditingKey(null)}
          onSaved={() => { setEditingKey(null); load(); showToast("success", "Template updated."); }}
          onReset={() => { setEditingKey(null); load(); showToast("success", "Template reset to default."); }}
          onTestSent={(to) => showToast("success", `Test email sent to ${to}`)}
        />
      )}
    </div>
  );
}

function TemplateModal({
  templateKey, onClose, onSaved, onReset, onTestSent
}: {
  templateKey: string;
  onClose: () => void;
  onSaved: () => void;
  onReset: () => void;
  onTestSent: (to: string) => void;
}) {
  const [template, setTemplate] = useState<AdminEmailTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testEmail, setTestEmail] = useState("");
  const [testLoading, setTestLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"html" | "text">("html");

  useEffect(() => {
    setLoading(true);
    getAdminEmailTemplate(templateKey)
      .then((r) => setTemplate(r.template))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [templateKey]);

  function set(k: keyof AdminEmailTemplate, v: unknown) {
    setTemplate((t) => t ? { ...t, [k]: v } : t);
  }

  async function handleSave() {
    if (!template) return;
    setSaving(true);
    setError(null);
    try {
      await updateAdminEmailTemplate(templateKey, {
        name: template.name,
        subject: template.subject,
        htmlBody: template.htmlBody,
        textBody: template.textBody,
        enabled: template.enabled,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (!window.confirm("Reset this template to the default? Your changes will be lost.")) return;
    setSaving(true);
    try {
      await resetAdminEmailTemplate(templateKey);
      onReset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTestLoading(true);
    try {
      await testAdminEmailTemplate(templateKey, testEmail || undefined);
      onTestSent(testEmail || "your email");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Test failed");
    } finally {
      setTestLoading(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--xl">
        <div className="modal-header">
          <h2 className="modal-title">Edit: {template?.name ?? templateKey}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {loading ? (
            <div className="admin-loading"><div className="spinner" /></div>
          ) : error ? (
            <div className="alert alert--error">{error}</div>
          ) : template ? (
            <>
              <div className="form-group">
                <label className="form-label">Subject</label>
                <input className="form-input" value={template.subject} onChange={(e) => set("subject", e.target.value)} />
              </div>

              {template.variables && Array.isArray(template.variables) && template.variables.length > 0 && (
                <div className="admin-template-vars">
                  <span className="admin-muted" style={{ fontSize: 12 }}>Available variables: </span>
                  {(template.variables as string[]).map((v) => (
                    <code key={v} className="admin-code">{v}</code>
                  ))}
                </div>
              )}

              <div className="admin-tabs" style={{ marginTop: 12 }}>
                <button className={`admin-tab ${activeTab === "html" ? "admin-tab--active" : ""}`} onClick={() => setActiveTab("html")}>HTML Body</button>
                <button className={`admin-tab ${activeTab === "text" ? "admin-tab--active" : ""}`} onClick={() => setActiveTab("text")}>Plain Text</button>
              </div>

              {activeTab === "html" ? (
                <textarea
                  className="form-input admin-template-editor"
                  value={template.htmlBody}
                  onChange={(e) => set("htmlBody", e.target.value)}
                  rows={14}
                />
              ) : (
                <textarea
                  className="form-input admin-template-editor"
                  value={template.textBody}
                  onChange={(e) => set("textBody", e.target.value)}
                  rows={14}
                />
              )}

              <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
                <label className="admin-toggle-row">
                  <input type="checkbox" checked={template.enabled} onChange={(e) => set("enabled", e.target.checked)} />
                  Template enabled
                </label>
              </div>

              <div className="admin-template-test" style={{ marginTop: 16 }}>
                <h4 className="admin-modal-section-title">Send Test Email</h4>
                <div style={{ display: "flex", gap: 8 }}>
                  <input className="form-input" placeholder="test@example.com (leave blank for your account)" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} style={{ flex: 1 }} />
                  <button className="btn btn--ghost btn--sm" onClick={handleTest} disabled={testLoading}>
                    {testLoading ? "Sending…" : "Send Test"}
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </div>
        <div className="modal-footer" style={{ justifyContent: "space-between" }}>
          <button className="btn btn--ghost" onClick={handleReset} disabled={saving}>Reset to Default</button>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn--ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="btn btn--primary" onClick={handleSave} disabled={saving || loading}>
              {saving ? "Saving…" : "Save Template"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
