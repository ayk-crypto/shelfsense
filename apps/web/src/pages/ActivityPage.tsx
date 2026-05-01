import { useEffect, useState } from "react";
import { getAuditLogs } from "../api/auditLogs";
import type { AuditLog, AuditLogFilters } from "../types";

const ACTION_OPTIONS = [
  "CREATE_ITEM",
  "STOCK_IN",
  "STOCK_OUT",
  "TRANSFER",
  "CREATE_PURCHASE",
  "CREATE_SUPPLIER",
];

export function ActivityPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [filters, setFilters] = useState<AuditLogFilters>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadLogs() {
      setLoading(true);
      try {
        const res = await getAuditLogs(filters);
        setLogs(res.logs);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load activity");
      } finally {
        setLoading(false);
      }
    }

    void loadLogs();
  }, [filters]);

  return (
    <div className="activity-page">
      <div className="page-header">
        <h1 className="page-title">Activity</h1>
        <p className="page-subtitle">Review workspace audit events</p>
      </div>

      <div className="activity-filters">
        <label className="form-group">
          <span className="form-label">From</span>
          <input
            className="form-input"
            type="date"
            value={filters.fromDate ?? ""}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, fromDate: e.target.value || undefined }))
            }
          />
        </label>

        <label className="form-group">
          <span className="form-label">To</span>
          <input
            className="form-input"
            type="date"
            value={filters.toDate ?? ""}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, toDate: e.target.value || undefined }))
            }
          />
        </label>

        <label className="form-group">
          <span className="form-label">Action</span>
          <select
            className="form-select"
            value={filters.action ?? ""}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, action: e.target.value || undefined }))
            }
          >
            <option value="">All actions</option>
            {ACTION_OPTIONS.map((action) => (
              <option key={action} value={action}>
                {formatAction(action)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <div className="page-loading">
          <div className="spinner" />
          <p>Loading activity...</p>
        </div>
      ) : error ? (
        <div className="page-error">
          <div className="alert alert--error">{error}</div>
        </div>
      ) : logs.length === 0 ? (
        <div className="empty-state">
          <p>No activity found.</p>
        </div>
      ) : (
        <div className="table-wrap activity-table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>User</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td className="td-expiry">{formatDateTime(log.createdAt)}</td>
                  <td className="td-name">{log.user.name}</td>
                  <td>
                    <span className="badge badge--gray">{formatAction(log.action)}</span>
                  </td>
                  <td className="td-unit">{log.entity}</td>
                  <td>{describeLog(log)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function describeLog(log: AuditLog) {
  const actor = log.user.name;
  const meta = log.meta;
  const itemName = stringMeta(meta.itemName, "item");
  const unit = stringMeta(meta.unit, "units");
  const quantity = numberMeta(meta.quantity);

  switch (log.action) {
    case "TRANSFER":
      return `${actor} transferred ${formatQuantity(quantity)}${unit} ${itemName} from ${stringMeta(meta.fromLocationName, "source")} to ${stringMeta(meta.toLocationName, "destination")}`;
    case "STOCK_IN":
      return `${actor} added ${formatQuantity(quantity)}${unit} ${itemName}`;
    case "STOCK_OUT":
      return `${actor} deducted ${formatQuantity(quantity)}${unit} ${itemName}`;
    case "CREATE_ITEM":
      return `${actor} created item ${itemName}`;
    case "CREATE_PURCHASE":
      return `${actor} created a purchase from ${stringMeta(meta.supplierName, "supplier")}`;
    case "CREATE_SUPPLIER":
      return `${actor} created supplier ${stringMeta(meta.supplierName, "supplier")}`;
    default:
      return `${actor} performed ${formatAction(log.action)}`;
  }
}

function stringMeta(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function numberMeta(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

function formatAction(action: string) {
  return action
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
