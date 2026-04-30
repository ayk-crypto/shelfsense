import express from "express";
import type { HealthResponse } from "@shelfsense/shared";

const app = express();
const port = Number(process.env.PORT ?? 4000);

app.get("/api/health", (_req, res) => {
  const response: HealthResponse = { status: "ok" };
  res.json(response);
});

app.listen(port, () => {
  console.log(`ShelfSense API listening on port ${port}`);
});
