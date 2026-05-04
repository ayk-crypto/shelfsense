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

function getEmailFrom() {
  return (
    process.env.SMTP_FROM ??
    process.env.EMAIL_FROM ??
    "no-reply@shelfsense.app"
  );
}

export const env = {
  databaseUrl:
    (process.env.NODE_ENV === "test" ? process.env.TEST_DATABASE_URL : undefined) ??
    process.env.DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5432/shelfsense?schema=public",
  jwtSecret: getJwtSecret(),
  port: Number(process.env.PORT ?? 3000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  corsAllowedOrigins: parseCsv(process.env.CORS_ALLOWED_ORIGINS) ?? defaultCorsAllowedOrigins,
  smtpHost: process.env.SMTP_HOST,
  smtpPort: Number(process.env.SMTP_PORT ?? 587),
  smtpUser: process.env.SMTP_USER,
  smtpPass: process.env.SMTP_PASS,
  emailFrom: getEmailFrom(),
  emailFromName: process.env.EMAIL_FROM_NAME ?? "ShelfSense",
  appUrl: process.env.WEB_BASE_URL ?? process.env.APP_URL ?? "http://localhost:5000",
};
