import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { hasPermission } from "../utils/permissions";
import { CostUnitsPage } from "./CostUnitsPage";
import { ItemsPage } from "./ItemsPage";
import "./ItemsAreaPage.css";

export function ItemsAreaPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canManageItems = hasPermission(user, "inventory_manage");
  const showCostUnits = location.pathname === "/items/cost-units";

  if (showCostUnits && !canManageItems) {
    return <Navigate to="/items" replace />;
  }

  return (
    <div className="items-area">
      {canManageItems && (
        <div className="items-area-tabs" role="tablist" aria-label="Inventory item views">
          <button
            type="button"
            role="tab"
            aria-selected={!showCostUnits}
            className={!showCostUnits ? "is-active" : ""}
            onClick={() => navigate("/items")}
          >
            Items
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={showCostUnits}
            className={showCostUnits ? "is-active" : ""}
            onClick={() => navigate("/items/cost-units")}
          >
            Cost & Units
          </button>
        </div>
      )}
      {showCostUnits ? <CostUnitsPage /> : <ItemsPage />}
    </div>
  );
}
