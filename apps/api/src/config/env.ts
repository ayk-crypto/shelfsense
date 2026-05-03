import "dotenv/config";

const defaultCorsAllowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5000",
  "http://127.0.0.1:5000",
];

function parseCsv(value: string | undefined) {
  return value
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getJwtSecret() {
  const secret = process.env.JWT_SECRET ?? "development-secret";
  const nodeEnv = process.env.NODE_ENV ?? "development";

  if (nodeEnv === "production") {
    if (!process.env.JWT_SECRET || secret === "development-secret" || secret.length < 32) {
      throw new Error("JWT_SECRET must be set to at least 32 characters in production.");
    }
  }

  return secret;
}

export const env = {
  databaseUrl:
    (process.env.NODE_ENV === "test" ? process.env.TEST_DATABASE_URL : undefined) ??
    process.env.DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5432/shelfsense?schema=public",
  jwtSecret: getJwtSecret(),
  port: Number(process.env.PORT ?? 4000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  corsAllowedOrigins: parseCsv(process.env.CORS_ALLOWED_ORIGINS) ?? defaultCorsAllowedOrigins,
};
