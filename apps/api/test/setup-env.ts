import "dotenv/config";

process.env.NODE_ENV = "test";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const databaseUrl = process.env.DATABASE_URL;

if (!testDatabaseUrl) {
  throw new Error(
    "TEST_DATABASE_URL is required for API tests. Point it at a migrated disposable test database.",
  );
}

const testDatabaseTarget = parseDatabaseTarget(testDatabaseUrl);
const databaseTarget = databaseUrl ? parseDatabaseTarget(databaseUrl) : null;

if (databaseTarget && isSameDatabaseTarget(testDatabaseTarget, databaseTarget)) {
  throw new Error("TEST_DATABASE_URL must not target the same database/schema as DATABASE_URL.");
}

if (!hasTestDatabaseMarker(testDatabaseTarget)) {
  throw new Error(
    'TEST_DATABASE_URL database name or schema must contain an obvious test marker such as "test", "testing", or "shelfsense_test".',
  );
}

interface DatabaseTarget {
  host: string;
  database: string;
  schema: string;
}

function parseDatabaseTarget(value: string): DatabaseTarget {
  const url = new URL(value);
  const database = decodeURIComponent(url.pathname.replace(/^\/+/, "").replace(/\/+$/, ""));
  const schema = url.searchParams.get("schema")?.trim() || "public";

  if (!database) {
    throw new Error("Database URL must include a database name.");
  }

  return {
    host: url.host.toLowerCase(),
    database: database.toLowerCase(),
    schema: schema.toLowerCase(),
  };
}

function isSameDatabaseTarget(left: DatabaseTarget, right: DatabaseTarget) {
  return left.host === right.host && left.database === right.database && left.schema === right.schema;
}

function hasTestDatabaseMarker(target: DatabaseTarget) {
  return hasMarker(target.database) || hasMarker(target.schema);
}

function hasMarker(value: string) {
  return value.includes("shelfsense_test") || value.includes("testing") || value.includes("test");
}
