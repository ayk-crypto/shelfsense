export type FrequencyType = "weekly" | "biweekly" | "monthly" | "quarterly" | "custom";
export type CustomIntervalUnit = "days" | "weeks" | "months";

export interface PhysicalCountScheduleSettings {
  frequencyType: string;
  customIntervalNumber: number | null;
  customIntervalUnit: string | null;
  createdAt: Date;
}

/**
 * Calculate the next physical count due date using a rolling cycle from the
 * last completed count date (or createdAt if no count has been done yet).
 *
 * Monthly example: completed 14 May → next due 14 June (NOT 1 June).
 * Edge case: completed 31 Jan → next due 28 Feb (last valid day of next month).
 */
export function calculateNextDueDate(
  lastCompletedAt: Date | null,
  settings: PhysicalCountScheduleSettings,
): Date | null {
  const base = lastCompletedAt ?? settings.createdAt;
  const d = new Date(base);

  switch (settings.frequencyType as FrequencyType) {
    case "weekly":
      d.setDate(d.getDate() + 7);
      break;

    case "biweekly":
      d.setDate(d.getDate() + 14);
      break;

    case "monthly": {
      const day = d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + 1);
      const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(day, daysInMonth));
      break;
    }

    case "quarterly": {
      const day = d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + 3);
      const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(day, daysInMonth));
      break;
    }

    case "custom": {
      const n = settings.customIntervalNumber;
      const unit = settings.customIntervalUnit as CustomIntervalUnit;
      if (!n || !unit) return null;
      if (unit === "days") {
        d.setDate(d.getDate() + n);
      } else if (unit === "weeks") {
        d.setDate(d.getDate() + n * 7);
      } else if (unit === "months") {
        const day = d.getDate();
        d.setDate(1);
        d.setMonth(d.getMonth() + n);
        const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        d.setDate(Math.min(day, daysInMonth));
      }
      break;
    }

    default:
      return null;
  }

  return d;
}

/**
 * How many days until (or since) the next due date.
 * Negative means overdue.
 */
export function daysUntilDue(nextDueAt: Date): number {
  const now = new Date();
  const msPerDay = 1000 * 60 * 60 * 24;
  const diff = nextDueAt.getTime() - now.getTime();
  return Math.round(diff / msPerDay);
}
