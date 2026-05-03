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

export const env = {
  databaseUrl:
    (process.env.NODE_ENV === "test" ? process.env.TEST_DATABASE_URL : undefined) ??
    process.env.DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5432/shelfsense?schema=public",
  jwtSecret: process.env.JWT_SECRET ?? "development-secret",
  port: Number(process.env.PORT ?? 4000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  corsAllowedOrigins: parseCsv(process.env.CORS_ALLOWED_ORIGINS) ?? defaultCorsAllowedOrigins,
};
