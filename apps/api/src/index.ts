import express from "express";
import type { HealthResponse } from "@shelfsense/shared";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/error-handler.js";
import { authRouter } from "./routes/auth.js";
import { itemsRouter } from "./routes/items.js";
import { stockRouter } from "./routes/stock.js";
import { workspaceRouter } from "./routes/workspace.js";

const app = express();

app.use(express.json());

app.get("/api/health", (_req, res) => {
  const response: HealthResponse = { status: "ok" };
  res.json(response);
});

app.use("/auth", authRouter);
app.use("/workspace", workspaceRouter);
app.use("/items", itemsRouter);
app.use("/stock", stockRouter);
app.use(errorHandler);

app.listen(env.port, () => {
  console.log(`ShelfSense API listening on port ${env.port}`);
});
