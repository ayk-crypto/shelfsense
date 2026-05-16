import { Link } from "react-router-dom";
import type { PhysicalCountSettings } from "../types";

interface Props {
  settings: PhysicalCountSettings | null;
  loading?: boolean;
  onConfigure?: () => void;
}

function daysUntil(isoDate: string): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.round((new Date(isoDate).getTime() - Date.now()) / msPerDay);
}

function fmtDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function PhysicalCountReminderCard({ settings, loading, onConfigure }: Props) {
  if (loading) {
    return (
      <div className="pc-reminder-card pc-reminder-card--loading">
        <div className="spinner spinner--sm" />
      </div>
    );
  }

  // Not configured
  if (!settings || !settings.enabled) {
    return (
      <div className="pc-reminder-card pc-reminder-card--unconfigured">
        <div className="pc-reminder-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </div>
        <div className="pc-reminder-content">
          <p className="pc-reminder-title">Physical inventory reminders not configured</p>
          <p className="pc-reminder-sub">Set a counting frequency to get reminded when stock verification is due.</p>
        </div>
        <button type="button" className="btn btn--sm btn--secondary pc-reminder-btn" onClick={onConfigure}>
          Configure
        </button>
      </div>
    );
  }

  const now = new Date();
  const lastCompleted = settings.lastCompletedAt ? new Date(settings.lastCompletedAt) : null;
  const nextDue = settings.nextDueAt ? new Date(settings.nextDueAt) : null;
  const days = nextDue ? daysUntil(settings.nextDueAt!) : null;

  // No next due date yet (custom with missing params, etc.)
  if (!nextDue) {
    return (
      <div className="pc-reminder-card pc-reminder-card--unconfigured">
        <div className="pc-reminder-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </div>
        <div className="pc-reminder-content">
          <p className="pc-reminder-title">Physical inventory reminders enabled</p>
          <p className="pc-reminder-sub">
            {lastCompleted
              ? `Last count completed ${fmtDate(settings.lastCompletedAt!)}. Next due date could not be calculated — check your custom frequency settings.`
              : "No counts completed yet. Start your first count to begin the reminder cycle."}
          </p>
        </div>
        <Link to="/stock-count" className="btn btn--sm btn--primary pc-reminder-btn">Start Count</Link>
      </div>
    );
  }

  // Overdue
  if (days !== null && days < 0) {
    const overdue = Math.abs(days);
    return (
      <div className="pc-reminder-card pc-reminder-card--overdue">
        <div className="pc-reminder-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <div className="pc-reminder-content">
          <p className="pc-reminder-title">Physical count overdue by {overdue} day{overdue !== 1 ? "s" : ""}</p>
          <p className="pc-reminder-sub">Was due {fmtDate(settings.nextDueAt!)}. Please complete a stock count to verify inventory accuracy.</p>
        </div>
        <Link to="/stock-count" className="btn btn--sm btn--primary pc-reminder-btn">Start Count</Link>
      </div>
    );
  }

  // Due today
  if (days === 0) {
    return (
      <div className="pc-reminder-card pc-reminder-card--due">
        <div className="pc-reminder-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
            <polyline points="9 16 11 18 15 14" />
          </svg>
        </div>
        <div className="pc-reminder-content">
          <p className="pc-reminder-title">Physical count is due today</p>
          <p className="pc-reminder-sub">Start a new count to verify stock accuracy and keep your records up to date.</p>
        </div>
        <Link to="/stock-count" className="btn btn--sm btn--primary pc-reminder-btn">Start Count</Link>
      </div>
    );
  }

  // Upcoming
  if (days !== null && days <= 7) {
    return (
      <div className="pc-reminder-card pc-reminder-card--upcoming">
        <div className="pc-reminder-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </div>
        <div className="pc-reminder-content">
          <p className="pc-reminder-title">Physical count due in {days} day{days !== 1 ? "s" : ""}</p>
          <p className="pc-reminder-sub">Scheduled for {fmtDate(settings.nextDueAt!)}. Plan ahead to avoid disruptions.</p>
        </div>
        <Link to="/stock-count" className="btn btn--sm btn--secondary pc-reminder-btn">View Counts</Link>
      </div>
    );
  }

  // Recently completed / all good
  return (
    <div className="pc-reminder-card pc-reminder-card--ok">
      <div className="pc-reminder-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <div className="pc-reminder-content">
        <p className="pc-reminder-title">
          {lastCompleted
            ? `Last count: ${fmtDate(settings.lastCompletedAt!)}`
            : "Physical count reminders active"}
        </p>
        <p className="pc-reminder-sub">
          Next count due {fmtDate(settings.nextDueAt!)}
          {days !== null ? ` (in ${days} days)` : ""}.
        </p>
      </div>
      <Link to="/stock-count" className="btn btn--sm btn--secondary pc-reminder-btn">View Counts</Link>
    </div>
  );
}
