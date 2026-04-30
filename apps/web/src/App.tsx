import type { HealthStatus } from "@shelfsense/shared";
import "./App.css";

const status: HealthStatus = "ok";

export function App() {
  return (
    <main className="app-shell">
      <h1>ShelfSense Web Running</h1>
      <p>API health status: {status}</p>
    </main>
  );
}
