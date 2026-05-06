import { useNavigate } from "react-router-dom";
import { REQUIRED_PLAN, usePlanFeatures, type PlanFeatures } from "../context/PlanFeaturesContext";

type FeatureKey = keyof Omit<PlanFeatures, "planCode" | "planName" | "isLoading">;

interface FeatureMeta {
  title: string;
  description: string;
  bullets: string[];
  color: string;
  icon: React.ReactNode;
}

function hexToRgb(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

const FEATURE_META: Record<FeatureKey, FeatureMeta> = {
  enablePurchases: {
    title: "Purchase Orders",
    description: "Create and manage purchase orders, receive stock against open POs, and track supplier costs end-to-end.",
    bullets: [
      "Create and track purchase orders",
      "Receive stock directly against POs",
      "Supplier cost & spend tracking",
      "Export full purchase history to CSV",
    ],
    color: "#6366f1",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
        <line x1="3" y1="6" x2="21" y2="6" />
        <path d="M16 10a4 4 0 01-8 0" />
      </svg>
    ),
  },
  enableSuppliers: {
    title: "Supplier Management",
    description: "Build a supplier directory, store contact details, and connect suppliers to your purchase orders.",
    bullets: [
      "Full supplier contact directory",
      "Link suppliers to purchase orders",
      "Track supplier spend & history",
      "Supplier performance insights",
    ],
    color: "#0ea5e9",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1" y="3" width="15" height="13" rx="1" />
        <path d="M16 8h4l3 5v3h-7V8z" />
        <circle cx="5.5" cy="18.5" r="2.5" />
        <circle cx="18.5" cy="18.5" r="2.5" />
      </svg>
    ),
  },
  enableAdvancedReports: {
    title: "Advanced Analytics",
    description: "Deep-dive analytics for supplier spend, stock aging, expiry loss, variance, and transfer history.",
    bullets: [
      "Supplier spend analysis",
      "Expiry loss & wastage reports",
      "Stock aging & adjustment variance",
      "Transfer history reporting",
    ],
    color: "#8b5cf6",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
  },
  enableTeamManagement: {
    title: "Team Management",
    description: "Invite team members, assign roles, and control who can view or edit your inventory workspace.",
    bullets: [
      "Invite unlimited team members",
      "Assign manager & operator roles",
      "Location-based access control",
      "Full activity audit trail",
    ],
    color: "#059669",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
      </svg>
    ),
  },
  enableCustomRoles: {
    title: "Custom Roles & Permissions",
    description: "Design your own roles with granular permission toggles for every module in your inventory system.",
    bullets: [
      "Unlimited custom role builder",
      "Granular per-module permissions",
      "Assign roles to any team member",
      "Restrict access by page or action",
    ],
    color: "#7c3aed",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
      </svg>
    ),
  },
  enableBarcodeScanning: {
    title: "Barcode Scanning",
    description: "Use your device camera to scan barcodes and instantly look up, add, or update inventory items.",
    bullets: [
      "Camera-based barcode scanner",
      "Instant item lookup by barcode",
      "Add & receive stock by scan",
      "Works on mobile and desktop",
    ],
    color: "#0891b2",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9V5a2 2 0 012-2h4M3 15v4a2 2 0 002 2h4M15 3h4a2 2 0 012 2v4M15 21h4a2 2 0 002-2v-4" />
        <line x1="7" y1="8" x2="7" y2="16" />
        <line x1="10" y1="8" x2="10" y2="16" />
        <line x1="13" y1="8" x2="13" y2="16" />
        <line x1="16" y1="8" x2="16" y2="16" />
      </svg>
    ),
  },
  enableEmailAlerts: {
    title: "Email Alerts",
    description: "Stay on top of low stock and expiring items with automated email alerts and daily digest summaries.",
    bullets: [
      "Low stock threshold alerts",
      "Expiry date warnings",
      "Daily inventory digest email",
      "Configurable thresholds per item",
    ],
    color: "#d97706",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" />
      </svg>
    ),
  },
  enableDailyOps: {
    title: "Daily Operations",
    description: "A guided daily checklist to keep your team aligned on key inventory tasks every shift.",
    bullets: [
      "Shift-based task checklists",
      "Team accountability tracking",
      "Progress visibility across locations",
      "Custom daily task templates",
    ],
    color: "#0284c7",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
      </svg>
    ),
  },
  enableReports: {
    title: "Inventory Reports",
    description: "Understand stock value, usage patterns, and costs with detailed exportable business reports.",
    bullets: [
      "Inventory valuation report",
      "Usage by item analysis",
      "Wastage cost tracking",
      "CSV export for all reports",
    ],
    color: "#0284c7",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
  },
  enableExpiryTracking: {
    title: "Expiry Date Tracking",
    description: "Track batch expiry dates, get alerts before items expire, and cut costly wastage.",
    bullets: [
      "Per-batch expiry date tracking",
      "Expiry alerts and warnings",
      "Expiry loss reporting",
      "FIFO / FEFO batch management",
    ],
    color: "#dc2626",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
};

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ width: 14, height: 14, flexShrink: 0 }}>
      <path fillRule="evenodd" d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
    </svg>
  );
}

interface PlanFeatureGateProps {
  feature: FeatureKey;
  children: React.ReactNode;
  inline?: boolean;
}

export function PlanFeatureGate({ feature, children, inline = false }: PlanFeatureGateProps) {
  const features = usePlanFeatures();
  const navigate = useNavigate();

  if (features.isLoading) {
    return (
      <div className="page-loading">
        <div className="spinner" />
      </div>
    );
  }

  if (!features[feature]) {
    const requiredPlan = REQUIRED_PLAN[feature];
    const meta = FEATURE_META[feature];
    const { r, g, b } = hexToRgb(meta.color);
    const tintBg = `rgba(${r},${g},${b},0.08)`;
    const tintBorder = `rgba(${r},${g},${b},0.2)`;
    const planCode = requiredPlan.toUpperCase() === "BASIC" ? "STARTER" : requiredPlan.toUpperCase();
    const checkoutPath = `/billing/checkout?plan=${planCode}`;

    return (
      <div className={`plan-gate${inline ? " plan-gate--inline" : ""}`}>
        <div className="plan-gate__card">
          <div
            className="plan-gate__icon-wrap"
            style={{ background: tintBg, border: `1.5px solid ${tintBorder}`, color: meta.color }}
          >
            {meta.icon}
          </div>
          <span
            className="plan-gate__badge"
            style={{ background: tintBg, color: meta.color, border: `1px solid ${tintBorder}` }}
          >
            {requiredPlan} plan
          </span>
          <h2 className="plan-gate__title">Unlock {meta.title}</h2>
          <p className="plan-gate__desc">{meta.description}</p>
          <ul className="plan-gate__bullets">
            {meta.bullets.map((bullet) => (
              <li key={bullet} className="plan-gate__bullet">
                <CheckIcon />
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
          <div className="plan-gate__actions">
            <button
              className="btn btn--primary plan-gate__cta"
              onClick={() => navigate(checkoutPath)}
            >
              Upgrade to {requiredPlan}
              <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" style={{ width: 15, height: 15 }}>
                <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
            <button className="plan-gate__all-plans" onClick={() => navigate("/plan")}>
              View all plans
            </button>
          </div>
          <p className="plan-gate__current">
            You're on the <strong>{features.planName}</strong> plan
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
