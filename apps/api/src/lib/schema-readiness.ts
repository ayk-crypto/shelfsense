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

const REQUIRED_COLUMNS: Array<{ table: string; column: string }> = [
  { table: "Workspace", column: "customPurchaseUnits" },
  { table: "Workspace", column: "customUnits" },
  { table: "Workspace", column: "customCategories" },
  { table: "StockBatch", column: "receivedQuantity" },
  { table: "StockBatch", column: "receivedUnit" },
  { table: "StockMovement", column: "enteredQuantity" },
  { table: "StockMovement", column: "enteredUnit" },
  { table: "StockMovement", column: "conversionFactor" },
  { table: "Item", column: "purchaseUnit" },
  { table: "Item", column: "purchaseConversionFactor" },
];

export interface SchemaReadinessResult {
  ready: boolean;
  missingTables: string[];
  missingColumns: Array<{ table: string; column: string }>;
  dbReachable: boolean;
}

export async function checkSchemaReadiness(): Promise<SchemaReadinessResult> {
  let tableRows: Array<{ table_name: string }>;
  let columnRows: Array<{ table_name: string; column_name: string }>;

  try {
    [tableRows, columnRows] = await Promise.all([
      prisma.$queryRaw<Array<{ table_name: string }>>`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
      `,
      prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = ANY(${REQUIRED_COLUMNS.map((c) => c.table)})
      `,
    ]);
  } catch (err) {
    logger.error("[SCHEMA] Cannot reach database to check schema readiness", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { ready: false, missingTables: [], missingColumns: [], dbReachable: false };
  }

  const presentTables = new Set(tableRows.map((r) => r.table_name));
  const missingTables = REQUIRED_TABLES.filter((t) => !presentTables.has(t));

  const presentColumns = new Set(columnRows.map((r) => `${r.table_name}.${r.column_name}`));
  const missingColumns = REQUIRED_COLUMNS.filter(
    (c) => !presentColumns.has(`${c.table}.${c.column}`),
  );

  const ready = missingTables.length === 0 && missingColumns.length === 0;
  return { ready, missingTables, missingColumns, dbReachable: true };
}

export async function logSchemaReadiness(): Promise<void> {
  const result = await checkSchemaReadiness();

  if (!result.dbReachable) {
    logger.error("[SCHEMA] Startup check: database is unreachable — service will not function");
    return;
  }

  if (result.ready) {
    logger.info("[SCHEMA] Startup check: all required tables and columns present — schema is ready");
    return;
  }

  logger.error("[SCHEMA] Startup check: schema is NOT fully migrated", {
    missingTables: result.missingTables,
    missingColumns: result.missingColumns,
    action: "Run: npx prisma migrate deploy",
  });

  for (const table of result.missingTables) {
    logger.error(`[SCHEMA] Missing table: "${table}"`);
  }
  for (const col of result.missingColumns) {
    logger.error(`[SCHEMA] Missing column: "${col.table}"."${col.column}"`);
  }
}
