import { existsSync, readFileSync } from "node:fs";

loadDotEnvFile("apps/api/.env");

const nodeEnv = process.env.NODE_ENV ?? "development";
const databaseUrl = process.env.DATABASE_URL;
const jwtSecret = process.env.JWT_SECRET;
const corsAllowedOrigins = process.env.CORS_ALLOWED_ORIGINS;

const issues = [];

if (!databaseUrl) {
  issues.push("DATABASE_URL is not set; the API will fall back to a local default.");
}

if (nodeEnv === "production") {
  if (!jwtSecret || jwtSecret === "development-secret" || jwtSecret.length < 32) {
    issues.push("JWT_SECRET must be set to at least 32 characters in production.");
  }

  if (!corsAllowedOrigins) {
    issues.push("CORS_ALLOWED_ORIGINS must be set explicitly in production.");
  }

  const origins = parseCsv(corsAllowedOrigins);
  const unsafeOrigins = origins.filter((origin) => {
    const lower = origin.toLowerCase();
    return lower === "*" || lower.includes("localhost") || lower.includes("127.0.0.1");
  });

  if (unsafeOrigins.length > 0) {
    issues.push(`Production CORS origins include unsafe local/wildcard values: ${unsafeOrigins.join(", ")}.`);
  }
}

if (issues.length > 0) {
  console.error("ShelfSense ops check failed:");
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log(`ShelfSense ops check passed for NODE_ENV=${nodeEnv}.`);

function parseCsv(value) {
  return value
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean) ?? [];
}

function loadDotEnvFile(path) {
  if (!existsSync(path)) return;

  const lines = readFileSync(path, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) continue;

    const key = trimmed.slice(0, equalsIndex).trim();
    const rawValue = trimmed.slice(equalsIndex + 1).trim();

    if (!key || process.env[key] !== undefined) continue;

    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}
