import { useEffect, useRef, useState } from "react";
import { createLocation } from "../api/locations";
import { useLocation } from "../context/LocationContext";
import type { Location } from "../types";

interface Toast {
  id: number;
  msg: string;
  type: "success" | "error";
}

let toastSeq = 0;

export function LocationsPage() {
  const { locations, loading, error, refreshLocations } = useLocation();
  const [addOpen, setAddOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  function showToast(msg: string, type: "success" | "error") {
    const id = ++toastSeq;
    setToasts((prev) => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((toast) => toast.id !== id)), 3500);
  }

  if (loading && locations.length === 0) {
    return (
      <div className="page-loading">
        <div className="spinner" />
        <p>Loading locations...</p>
      </div>
    );
  }

  if (error && locations.length === 0) {
    return (
      <div className="page-error">
        <div className="alert alert--error">{error}</div>
      </div>
    );
  }

  return (
    <div className="locations-page">
      <div className="page-header locations-page-header">
        <div>
          <h1 className="page-title">Locations</h1>
          <p className="page-subtitle">Manage workspace branches</p>
        </div>
        <button className="btn btn--primary" onClick={() => setAddOpen(true)}>
          + Add Location
        </button>
      </div>

      {locations.length === 0 ? (
        <div className="empty-state">
          <p>No locations found.</p>
        </div>
      ) : (
        <div className="location-list">
          {locations.map((location) => (
            <LocationCard key={location.id} location={location} />
          ))}
        </div>
      )}

      {addOpen && (
        <AddLocationModal
          onClose={() => setAddOpen(false)}
          onSuccess={(location) => {
            setAddOpen(false);
            showToast(`Added ${location.name}`, "success");
            void refreshLocations();
          }}
          onError={(msg) => showToast(msg, "error")}
        />
      )}

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

function LocationCard({ location }: { location: Location }) {
  return (
    <article className="location-card">
      <div>
        <h2 className="location-card-name">{location.name}</h2>
        <p className="location-card-date">Created {formatDate(location.createdAt)}</p>
      </div>
    </article>
  );
}

function AddLocationModal({
  onClose,
  onSuccess,
  onError,
}: {
  onClose: () => void;
  onSuccess: (location: Location) => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => { firstRef.current?.focus(); }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;

    setSaving(true);
    try {
      const res = await createLocation({ name: trimmedName });
      onSuccess(res.location);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to add location");
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Add Location</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="modal-body">
          <form onSubmit={(e) => { void handleSubmit(e); }}>
            <div className="form-group">
              <label className="form-label">Location name / Branch name *</label>
              <input
                ref={firstRef}
                className="form-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Downtown Branch"
                required
              />
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn--ghost" onClick={onClose}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn--primary"
                disabled={saving || !name.trim()}
              >
                {saving ? <span className="btn-spinner" /> : null}
                {saving ? "Adding..." : "Add Location"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}
