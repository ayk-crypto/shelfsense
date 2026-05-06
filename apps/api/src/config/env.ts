import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ─── Load environment files ───────────────────────────────────────────────────
// Priority order (highest to lowest — dotenv skips already-set vars):
//   .env.{NODE_ENV}.local  →  .env.{NODE_ENV}  →  .env.local  →  .env
//
// In Replit, the DATABASE_URL is injected as a real process.env secret before
// this file runs, so it always takes priority over any .env file on disk.
// On Render (staging/production), env vars are set in the dashboard — same applies.

const _dir = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(_dir, "../.."); // apps/api/src/config/../.. = apps/api/

const _nodeEnvEarly = process.env.NODE_ENV ?? "development";
for (const file of [
  `.env.${_nodeEnvEarly}.local`,
  `.env.${_nodeEnvEarly}`,
  `.env.local`,
  `.env`,
]) {
  const fullPath = resolve(APP_ROOT, file);
  if (existsSync(fullPath)) {
    dotenv.config({ path: fullPath });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseCsv(value: string | undefined) {
  return value
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Returns DB host + database name for logging — never includes password or credentials.
 * Safe to print to stdout.
 */
export function getDbDisplayInfo(dbUrl: string): string {
  try {
    const u = new URL(dbUrl);
    const db = u.pathname.replace(/^\//, "") || "(default)";
    return `${u.host} / ${db}`;
  } catch {
    return "<unparseable>";
  }
}

function getJwtSecret() {
  const secret = process.env.JWT_SECRET ?? "development-secret";
  const nodeEnv = process.env.NODE_ENV ?? "development";

  if (nodeEnv === "production") {
    if (!process.env.JWT_SECRET || secret === "development-secret" || secret.length < 32) {
      throw new Error(
        "[STARTUP SAFETY] JWT_SECRET must be set to at least 32 characters in production.",
      );
    }
  }

  return secret;
}

function getEmailFrom() {
  return (
    process.env.SMTP_FROM ??
    process.env.EMAIL_FROM ??
    "noreply@shelfsenseapp.com"
  );
}

/**
 * Safety gate: refuses to start if the environment + database combination is dangerous.
 * - production + localhost DB → hard crash (prevents real env vars pointing to dev DB)
 * - production + no DATABASE_URL → hard crash (prevents silent localhost fallback)
 */
function assertDbSafety(nodeEnv: string, dbUrl: string) {
  const isLocalhost = /localhost|127\.0\.0\.1/.test(dbUrl);
  const urlExplicitlySet = Boolean(process.env.DATABASE_URL);

  if (nodeEnv === "production") {
    if (!urlExplicitlySet) {
      throw new Error(
        "[STARTUP SAFETY] NODE_ENV=production but DATABASE_URL is not set. " +
        "Production must use an explicit hosted database. " +
        "Set DATABASE_URL in your Render environment variables.",
      );
    }
    if (isLocalhost) {
      throw new Error(
        "[STARTUP SAFETY] NODE_ENV=production but DATABASE_URL points to localhost. " +
        "Production must use a hosted Neon database. " +
        "Update DATABASE_URL to your Neon production connection string.",
      );
    }
  }
  // Development/staging connecting to a hosted Neon DB is normal and expected.
}

// ─── Build and validate env ───────────────────────────────────────────────────

const _rawDbUrl =
  (process.env.NODE_ENV === "test" ? process.env.TEST_DATABASE_URL : undefined) ??
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/shelfsense?schema=public";

assertDbSafety(_nodeEnvEarly, _rawDbUrl);

export const env = {
  databaseUrl: _rawDbUrl,
  jwtSecret: getJwtSecret(),
  port: Number(process.env.PORT ?? 3000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  corsAllowedOrigins: parseCsv(process.env.CORS_ALLOWED_ORIGINS) ?? [
    "http://localhost:5173",
    "http://localhost:5000",
    "http://127.0.0.1:5000",
  ],
  smtpHost: process.env.SMTP_HOST,
  smtpPort: Number(process.env.SMTP_PORT ?? 587),
  smtpUser: process.env.SMTP_USER,
  smtpPass: process.env.SMTP_PASS,
  emailFrom: getEmailFrom(),
  emailFromName: process.env.EMAIL_FROM_NAME ?? "ShelfSense",
  appUrl: process.env.WEB_BASE_URL ?? process.env.APP_URL ?? "http://localhost:5000",
  supportFrom: process.env.SUPPORT_FROM ?? null,
  supportInboundSecret: process.env.SUPPORT_INBOUND_SECRET ?? null,
  paymentProvider: (process.env.PAYMENT_PROVIDER ?? "mock").toLowerCase() as "mock" | "payfast" | "safepay" | "paddle",
  // Paddle
  paddleEnv: (process.env.PADDLE_ENV ?? "sandbox") as "sandbox" | "production",
  paddleApiKey: process.env.PADDLE_API_KEY,
  paddleWebhookSecret: process.env.PADDLE_WEBHOOK_SECRET,
  paddleBasicMonthlyPriceId: process.env.PADDLE_BASIC_MONTHLY_PRICE_ID,
  paddleBasicAnnualPriceId: process.env.PADDLE_BASIC_ANNUAL_PRICE_ID,
  paddleProMonthlyPriceId: process.env.PADDLE_PRO_MONTHLY_PRICE_ID,
  paddleProAnnualPriceId: process.env.PADDLE_PRO_ANNUAL_PRICE_ID,
  appFrontendUrl: process.env.APP_FRONTEND_URL ?? process.env.WEB_BASE_URL ?? process.env.APP_URL ?? "http://localhost:5000",
};
