import { app } from "./app.js";
import { env, getDbDisplayInfo } from "./config/env.js";
import { startAlertScheduler } from "./jobs/alert-scheduler.js";
import { logSchemaReadiness } from "./lib/schema-readiness.js";
import { seedDefaultPlansIfEmpty } from "./lib/seed-default-plans.js";

function printStartupBanner() {
  const line = "─".repeat(56);
  const db = getDbDisplayInfo(env.databaseUrl);
  const envLabel =
    env.nodeEnv === "production"
      ? "production  ⚠️  LIVE"
      : env.nodeEnv === "staging"
        ? "staging"
        : "development";

  console.log(`\n${line}`);
  console.log(`  ShelfSense API — ${envLabel}`);
  console.log(`  DB   : ${db}`);
  console.log(`  Port : ${env.port}`);
  console.log(`  Web  : ${env.appUrl}`);
  console.log(`  CORS : ${env.corsAllowedOrigins.join(", ")}`);
  console.log(`${line}\n`);
}

app.listen(env.port, "0.0.0.0", () => {
  printStartupBanner();
  void logSchemaReadiness();
  void seedDefaultPlansIfEmpty();
  startAlertScheduler();
});
