import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { registerServiceWorker } from "./registerServiceWorker";
import { installItemFormUsabilityEnhancements } from "./utils/itemFormUsability";
import { installInventoryPlanningManager } from "./utils/inventoryPlanningManager";
import "./pages/ItemsPagePractical.css";

installItemFormUsabilityEnhancements();
installInventoryPlanningManager();
registerServiceWorker();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
