import { useEffect, useMemo, useRef, useState } from "react";
import { ConfirmModal } from "../components/ConfirmModal";
import type { ConfirmOptions } from "../components/ConfirmModal";
import {
  archiveLocation,
  createLocation,
  getLocations,
  reactivateLocation,
  updateLocation,
} from "../api/locations";
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
  const [allLocations, setAllLocations] = useState<Location[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const [localLoading, setLocalLoading] = useState(false);
  const [confirmOpts, setConfirmOpts] = useState<ConfirmOptions | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const visibleLocations = showArchived ? allLocations : locations;
  const archivedCount = useMemo(
    () => allLocations.filter((location) => !location.isActive).length,
    [allLocations],
  );
  const visibleArchivedCount = visibleLocations.filter((location) => !location.isActive).length;

  function showToast(msg: string, type: "success" | "error") {
    const id = ++toastSeq;
    setToasts((prev) => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((toast) => toast.id !== id)), 3500);
  }

  async function refreshAllLocations(nextShowArchived = showArchived) {
    await refreshLocations();

    if (!nextShowArchived) {
      return;
    }

    setLocalLoading(true);
    try {
      const res = await getLocations(true);
      setAllLocations(res.locations);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to load archived locations", "error");
    } finally {
      setLocalLoading(false);
    }
  }

  async function handleToggleArchived() {
    const nextShowArchived = !showArchived;
    setShowArchived(nextShowArchived);

    if (nextShowArchived) {
      setLocalLoading(true);
      try {
        const res = await getLocations(true);
        setAllLocations(res.locations);
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Failed to load archived locations", "error");
      } finally {
        setLocalLoading(false);
      }
    }
  }

  function handleArchive(location: Location) {
    setConfirmOpts({
      title: `Archive ${location.name}?`,
      message: "Locations with remaining stock cannot be archived. You can restore this location later.",
      confirmLabel: "Archive",
      variant: "danger",
      onConfirm: async () => {
        setConfirmOpts(null);
        try {
          await archiveLocation(location.id);
          showToast(`Archived ${location.name}`, "success");
          await refreshAllLocations(showArchived);
        } catch (err) {
          showToast(err instanceof Error ? err.message : "Failed to archive location", "error");
        }
      },
      onCancel: () => setConfirmOpts(null),
    });
  }

  async function handleReactivate(location: Location) {
    try {
      await reactivateLocation(location.id);
      showToast(`Reactivated ${location.name}`, "success");
      await refreshAllLocations(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to reactivate location", "error");
    }
  }

  useEffect(() => {
    if (showArchived) {
      void refreshAllLocations(true);
    }
  }, [showArchived]);

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
          <p className="page-subtitle">Manage branches, archived locations, and active stock destinations.</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn--secondary" onClick={() => { void handleToggleArchived(); }}>
            {showArchived ? "Hide archived" : "Show archived"}
          </button>
          <button className="btn btn--primary" onClick={() => setAddOpen(true)}>
            + Add Location
          </button>
        </div>
      </div>

      <div className="ops-metric-strip" aria-live="polite" aria-label="Location summary">
        <div className="ops-metric">
          <span className="ops-metric-label">Active locations</span>
          <strong className="ops-metric-value">{locations.length}</strong>
        </div>
        <div className="ops-metric">
          <span className="ops-metric-label">Archived</span>
          <strong className="ops-metric-value">{showArchived ? visibleArchivedCount : archivedCount}</strong>
        </div>
        <div className="ops-metric">
          <span className="ops-metric-label">Visible rows</span>
          <strong className="ops-metric-value">{visibleLocations.length}</strong>
        </div>
        <div className="ops-metric">
          <span className="ops-metric-label">Lifecycle mode</span>
          <strong className="ops-metric-value ops-metric-value--small">{showArchived ? "Archive view" : "Active only"}</strong>
        </div>
      </div>

      {localLoading ? <div className="alert alert--info">Refreshing locations...</div> : null}

      {visibleLocations.length === 0 ? (
        <div className="empty-state">
          <p>No locations found.</p>
        </div>
      ) : (
        <div className="location-list">
          {visibleLocations.map((location) => (
            <LocationCard
              key={location.id}
              location={location}
              onEdit={() => setEditingLocation(location)}
              onArchive={() => { void handleArchive(location); }}
              onReactivate={() => { void handleReactivate(location); }}
            />
          ))}
        </div>
      )}

      {addOpen && (
        <AddLocationModal
          onClose={() => setAddOpen(false)}
          onSuccess={(location) => {
            setAddOpen(false);
            showToast(`Added ${location.name}`, "success");
            void refreshAllLocations(showArchived);
          }}
          onError={(msg) => showToast(msg, "error")}
        />
      )}

      {editingLocation && (
        <EditLocationModal
          location={editingLocation}
          onClose={() => setEditingLocation(null)}
          onSuccess={(location) => {
            setEditingLocation(null);
            showToast(`Updated ${location.name}`, "success");
            void refreshAllLocations(showArchived);
          }}
          onError={(msg) => showToast(msg, "error")}
        />
      )}

      {confirmOpts && <ConfirmModal {...confirmOpts} />}

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

function LocationCard({
  location,
  onEdit,
  onArchive,
  onReactivate,
}: {
  location: Location;
  onEdit: () => void;
  onArchive: () => void;
  onReactivate: () => void;
}) {
  return (
    <article className={`location-card ${!location.isActive ? "is-muted" : ""}`}>
      <div>
        <h2 className="location-card-name">{location.name}</h2>
        <p className="location-card-date">Created {formatDate(location.createdAt)}</p>
      </div>
      <div className="team-member-meta">
        <span className={`badge ${location.isActive ? "badge--green" : "badge--gray"}`}>
          {location.isActive ? "Active" : "Archived"}
        </span>
      </div>
      <div className="lifecycle-actions">
        <button className="btn btn--sm btn--secondary" onClick={onEdit}>
          Edit
        </button>
        {location.isActive ? (
          <button className="btn btn--sm btn--danger" onClick={onArchive}>
            Archive
          </button>
        ) : (
          <button className="btn btn--sm btn--primary" onClick={onReactivate}>
            Reactivate
          </button>
        )}
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
    <LocationModal title="Add Location" onClose={onClose}>
      <form onSubmit={(e) => { void handleSubmit(e); }}>
        <LocationNameField value={name} onChange={setName} firstRef={firstRef} />
        <ModalActions onClose={onClose} saving={saving} disabled={!name.trim()} label="Add Location" savingLabel="Adding..." />
      </form>
    </LocationModal>
  );
}

function EditLocationModal({
  location,
  onClose,
  onSuccess,
  onError,
}: {
  location: Location;
  onClose: () => void;
  onSuccess: (location: Location) => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState(location.name);
  const [saving, setSaving] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => { firstRef.current?.focus(); }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;

    setSaving(true);
    try {
      const res = await updateLocation(location.id, { name: trimmedName });
      onSuccess(res.location);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to update location");
      setSaving(false);
    }
  }

  return (
    <LocationModal title="Edit Location" onClose={onClose}>
      <form onSubmit={(e) => { void handleSubmit(e); }}>
        <LocationNameField value={name} onChange={setName} firstRef={firstRef} />
        <ModalActions onClose={onClose} saving={saving} disabled={!name.trim()} label="Save changes" savingLabel="Saving..." />
      </form>
    </LocationModal>
  );
}

function LocationModal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function LocationNameField({ value, onChange, firstRef }: { value: string; onChange: (value: string) => void; firstRef: React.RefObject<HTMLInputElement | null> }) {
  return (
    <div className="form-group">
      <label className="form-label">Location name / Branch name *</label>
      <input
        ref={firstRef}
        className="form-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. Downtown Branch"
        required
      />
    </div>
  );
}

function ModalActions({ onClose, saving, disabled, label, savingLabel }: { onClose: () => void; saving: boolean; disabled: boolean; label: string; savingLabel: string }) {
  return (
    <div className="modal-footer">
      <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
      <button type="submit" className="btn btn--primary" disabled={saving || disabled}>
        {saving ? <span className="btn-spinner" /> : null}
        {saving ? savingLabel : label}
      </button>
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
