import "dotenv/config";

export const env = {
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5432/shelfsense?schema=public",
  jwtSecret: process.env.JWT_SECRET ?? "development-secret",
  port: Number(process.env.PORT ?? 4000),
};
