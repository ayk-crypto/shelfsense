const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const databaseUrl = process.env.DATABASE_URL;

if (!testDatabaseUrl) {
  fail("TEST_DATABASE_URL is required. Point it at a migrated disposable test database.");
}

const testTarget = parseDatabaseTarget(testDatabaseUrl);
const databaseTarget = databaseUrl ? parseDatabaseTarget(databaseUrl) : null;

if (databaseTarget && isSameDatabaseTarget(testTarget, databaseTarget)) {
  fail("TEST_DATABASE_URL must not target the same database/schema as DATABASE_URL.");
}

if (!hasTestDatabaseMarker(testTarget)) {
  fail('TEST_DATABASE_URL database name or schema must contain "test", "testing", or "shelfsense_test".');
}

export function parseDatabaseTarget(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("Database URL is not a valid URL.");
  }

  const database = decodeURIComponent(url.pathname.replace(/^\/+/, "").replace(/\/+$/, ""));
  const schema = url.searchParams.get("schema")?.trim() || "public";

  if (!database) {
    fail("Database URL must include a database name.");
  }

  return {
    host: url.host.toLowerCase(),
    database: database.toLowerCase(),
    schema: schema.toLowerCase(),
  };
}

export function isSameDatabaseTarget(left, right) {
  return left.host === right.host && left.database === right.database && left.schema === right.schema;
}

export function hasTestDatabaseMarker(target) {
  return hasMarker(target.database) || hasMarker(target.schema);
}

function hasMarker(value) {
  return value.includes("shelfsense_test") || value.includes("testing") || value.includes("test");
}

function fail(message) {
  console.error(`[test-db-safety] ${message}`);
  process.exit(1);
}
