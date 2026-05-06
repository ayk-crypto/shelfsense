import { useNavigate } from "react-router-dom";
import { REQUIRED_PLAN, usePlanFeatures, type PlanFeatures } from "../context/PlanFeaturesContext";

interface PlanFeatureGateProps {
  feature: keyof Omit<PlanFeatures, "planCode" | "planName" | "isLoading">;
  children: React.ReactNode;
}

export function PlanFeatureGate({ feature, children }: PlanFeatureGateProps) {
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
    return (
      <div className="plan-gate">
        <div className="plan-gate__card">
          <div className="plan-gate__icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <h2 className="plan-gate__title">
            {requiredPlan} plan required
          </h2>
          <p className="plan-gate__body">
            This feature isn't available on your current{" "}
            <strong>{features.planName}</strong> plan. Upgrade to{" "}
            <strong>{requiredPlan}</strong> or higher to unlock it.
          </p>
          <div className="plan-gate__actions">
            <button
              className="btn btn--primary"
              onClick={() => navigate("/plan")}
            >
              View plans
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
