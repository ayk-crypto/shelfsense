import cors from "cors";
import express from "express";
import type { HealthResponse } from "@shelfsense/shared";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/error-handler.js";
import { alertsRouter } from "./routes/alerts.js";
import { auditLogsRouter } from "./routes/audit-logs.js";
import { authRouter } from "./routes/auth.js";
import { itemsRouter } from "./routes/items.js";
import { locationsRouter } from "./routes/locations.js";
import { purchasesRouter } from "./routes/purchases.js";
import { stockRouter } from "./routes/stock.js";
import { suppliersRouter } from "./routes/suppliers.js";
import { teamRouter } from "./routes/team.js";
import { workspaceRouter } from "./routes/workspace.js";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  const response: HealthResponse = { status: "ok" };
  res.json(response);
});

app.use("/auth", authRouter);
app.use("/workspace", workspaceRouter);
app.use("/locations", locationsRouter);
app.use("/items", itemsRouter);
app.use("/stock", stockRouter);
app.use("/alerts", alertsRouter);
app.use("/audit-logs", auditLogsRouter);
app.use("/suppliers", suppliersRouter);
app.use("/purchases", purchasesRouter);
app.use("/team", teamRouter);
app.use(errorHandler);

app.listen(env.port, () => {
  console.log(`ShelfSense API listening on port ${env.port}`);
});
