import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { registerServiceWorker } from "./registerServiceWorker";
import { installItemFormUsabilityEnhancements } from "./utils/itemFormUsability";
import { installInventoryPlanningManager } from "./utils/inventoryPlanningManager";
import { installSupplierPurchasePlanner } from "./utils/supplierPurchasePlanner";
import "./pages/ItemsPagePractical.css";

installItemFormUsabilityEnhancements();
installInventoryPlanningManager();
installSupplierPurchasePlanner();
registerServiceWorker();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
