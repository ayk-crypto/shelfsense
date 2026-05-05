import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ─── Load environment files ───────────────────────────────────────────────────
// Priority (highest → lowest): .env.{NODE_ENV}.local → .env.{NODE_ENV} → .env.local → .env
// dotenv.config() skips vars already set, so load highest priority first.
// In production (Render), real env vars are already set and win over any file.

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

// ─── Safety helpers ───────────────────────────────────────────────────────────

function parseCsv(value: string | undefined) {
  return value
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Returns DB host + database name without any password or credentials. */
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

/** Throws if the environment + database combination is unsafe. */
function assertDbSafety(nodeEnv: string, dbUrl: string) {
  const isLocalhost = /localhost|127\.0\.0\.1/.test(dbUrl);
  const urlProvided = Boolean(process.env.DATABASE_URL);

  if (nodeEnv === "production") {
    if (!urlProvided) {
      throw new Error(
        "[STARTUP SAFETY] NODE_ENV=production but DATABASE_URL is not set. " +
        "Production must use an explicit hosted database URL. " +
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

  if ((nodeEnv === "development" || nodeEnv === "staging") && urlProvided && !isLocalhost) {
    // Warn (not throw) if a non-local DB is used in dev/staging — it might be intentional
    const dbInfo = getDbDisplayInfo(dbUrl);
    if (nodeEnv === "development") {
      console.warn(
        `[env] ⚠️  Development environment is connecting to a hosted database: ${dbInfo}`,
      );
      console.warn(
        `[env]     If this is your production database, stop immediately and update DATABASE_URL.`,
      );
    }
  }
}

// ─── Build and validate env ───────────────────────────────────────────────────

const _rawDbUrl =
  (process.env.NODE_ENV === "test" ? process.env.TEST_DATABASE_URL : undefined) ??
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/shelfsense?schema=public";

const _nodeEnv = process.env.NODE_ENV ?? "development";

assertDbSafety(_nodeEnv, _rawDbUrl);

export const env = {
  databaseUrl: _rawDbUrl,
  jwtSecret: getJwtSecret(),
  port: Number(process.env.PORT ?? 3000),
  nodeEnv: _nodeEnv,
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
};
