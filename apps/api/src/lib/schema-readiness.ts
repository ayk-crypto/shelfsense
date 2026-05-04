import { prisma } from "../db/prisma.js";
import { logger } from "./logger.js";

const REQUIRED_TABLES = [
  "User",
  "Workspace",
  "Membership",
  "CustomRole",
  "Location",
  "Item",
  "StockBatch",
  "StockMovement",
  "Supplier",
  "Purchase",
  "PurchaseItem",
  "AuditLog",
  "Notification",
  "PasswordResetToken",
  "EmailVerifToken",
  "StockCount",
  "StockCountItem",
];

export interface SchemaReadinessResult {
  ready: boolean;
  missingTables: string[];
  dbReachable: boolean;
}

export async function checkSchemaReadiness(): Promise<SchemaReadinessResult> {
  let rows: Array<{ table_name: string }>;
  try {
    rows = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
    `;
  } catch (err) {
    logger.error("[SCHEMA] Cannot reach database to check schema readiness", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { ready: false, missingTables: [], dbReachable: false };
  }

  const present = new Set(rows.map((r) => r.table_name));
  const missingTables = REQUIRED_TABLES.filter((t) => !present.has(t));
  return { ready: missingTables.length === 0, missingTables, dbReachable: true };
}

export async function logSchemaReadiness(): Promise<void> {
  const result = await checkSchemaReadiness();

  if (!result.dbReachable) {
    logger.error("[SCHEMA] Startup check: database is unreachable — service will not function");
    return;
  }

  if (result.ready) {
    logger.info("[SCHEMA] Startup check: all required tables present — schema is ready");
    return;
  }

  logger.error("[SCHEMA] Startup check: schema is NOT fully migrated", {
    missingTables: result.missingTables,
    tableCount: result.missingTables.length,
    action: "Run: npx prisma migrate deploy",
  });

  for (const table of result.missingTables) {
    logger.error(`[SCHEMA] Missing table: "${table}"`);
  }
}
