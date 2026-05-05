import { app } from "./app.js";
import { env } from "./config/env.js";
import { startAlertScheduler } from "./jobs/alert-scheduler.js";
import { logSchemaReadiness } from "./lib/schema-readiness.js";
import { seedDefaultPlansIfEmpty } from "./lib/seed-default-plans.js";

app.listen(env.port, "0.0.0.0", () => {
  console.log(`ShelfSense API listening on 0.0.0.0:${env.port}`);
  void logSchemaReadiness();
  void seedDefaultPlansIfEmpty();
  startAlertScheduler();
});
