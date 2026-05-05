import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import type { HealthResponse } from "@shelfsense/shared";
import { env } from "./config/env.js";
import { prisma } from "./db/prisma.js";
import { errorHandler } from "./middleware/error-handler.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { logRequest } from "./lib/logger.js";
import { checkSchemaReadiness } from "./lib/schema-readiness.js";
import { alertsRouter } from "./routes/alerts.js";
import { auditLogsRouter } from "./routes/audit-logs.js";
import { authRouter } from "./routes/auth.js";
import { itemsRouter } from "./routes/items.js";
import { locationsRouter } from "./routes/locations.js";
import { notificationsRouter } from "./routes/notifications.js";
import { onboardingRouter } from "./routes/onboarding.js";
import { purchasesRouter } from "./routes/purchases.js";
import { reorderSuggestionsRouter } from "./routes/reorder-suggestions.js";
import { planRouter } from "./routes/plan.js";
import { subscriptionsRouter } from "./routes/subscriptions.js";
import { adminRouter } from "./routes/admin.js";
import { announcementsRouter } from "./routes/announcements.js";
import { reportsRouter } from "./routes/reports.js";
import { stockCountsRouter } from "./routes/stock-counts.js";
import { stockRouter } from "./routes/stock.js";
import { suppliersRouter } from "./routes/suppliers.js";
import { teamRouter } from "./routes/team.js";
import { workspaceRouter } from "./routes/workspace.js";
import { supportRouter } from "./routes/support.js";
import { webhooksRouter } from "./routes/webhooks.js";

export const app = express();

app.set("trust proxy", 1);

app.use(requestIdMiddleware);

app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    logRequest({
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl.split("?")[0],
      status: res.statusCode,
      durationMs: Date.now() - start,
      userId: req.user?.userId ?? null,
      workspaceId: req.user?.workspaceId ?? null,
    });
  });
  next();
});

class ForbiddenOriginError extends Error {
  status = 403;

  constructor(origin: string) {
    super(`CORS origin is not allowed: ${origin}`);
  }
}

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || env.corsAllowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      // Allow Replit dev/preview domains in non-production environments only
      if (env.nodeEnv !== "production" && origin.match(/^https?:\/\/.+\.replit\.dev(:\d+)?$/)) {
        callback(null, true);
        return;
      }

      callback(new ForbiddenOriginError(origin));
    },
    allowedHeaders: ["Content-Type", "Authorization", "x-location-id", "x-request-id"],
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  }),
);

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many requests. Please try again later." },
    skip: () => env.nodeEnv === "test",
  }),
);

const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many authentication attempts. Please try again later." },
  skip: () => env.nodeEnv === "test",
});

const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again later." },
  skip: () => env.nodeEnv === "test",
});

const forgotPasswordRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many password reset requests. Please try again later." },
  skip: () => env.nodeEnv === "test",
});

app.use("/auth", authRateLimit);
app.use("/auth/login", loginRateLimit);
app.use("/auth/forgot-password", forgotPasswordRateLimit);
app.use("/auth/reset-password", forgotPasswordRateLimit);
app.use("/auth/resend-verification", forgotPasswordRateLimit);

app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  const response: HealthResponse = { status: "ok" };
  res.json(response);
});

app.get("/api/ready", async (_req, res) => {
  const result = await checkSchemaReadiness();

  if (!result.dbReachable) {
    return res.status(503).json({
      status: "not_ready",
      database: "unavailable",
      schema: "unknown",
    });
  }

  if (!result.ready) {
    return res.status(503).json({
      status: "not_ready",
      database: "ok",
      schema: "not_migrated",
      missingTables: result.missingTables,
    });
  }

  return res.json({
    status: "ready",
    database: "ok",
    schema: "ok",
  });
});

app.use("/auth", authRouter);
app.use("/workspace", workspaceRouter);
app.use("/locations", locationsRouter);
app.use("/notifications", notificationsRouter);
app.use("/onboarding", onboardingRouter);
app.use("/items", itemsRouter);
app.use("/stock", stockRouter);
app.use("/stock-counts", stockCountsRouter);
app.use("/alerts", alertsRouter);
app.use("/audit-logs", auditLogsRouter);
app.use("/suppliers", suppliersRouter);
app.use("/purchases", purchasesRouter);
app.use("/reorder-suggestions", reorderSuggestionsRouter);
app.use("/admin", adminRouter);
app.use("/announcements", announcementsRouter);
app.use("/webhooks", webhooksRouter);
app.use("/reports", reportsRouter);
app.use("/plan", planRouter);
app.use("/subscriptions", subscriptionsRouter);
app.use("/team", teamRouter);
app.use("/support", supportRouter);
app.use((req, res) => {
  const body: Record<string, unknown> = { error: "Route not found", code: "NOT_FOUND" };
  if (req.requestId) body.requestId = req.requestId;
  res.status(404).json(body);
});
app.use(errorHandler);
