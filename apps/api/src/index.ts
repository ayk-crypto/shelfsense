import { app } from "./app.js";
import { env } from "./config/env.js";
import { startAlertScheduler } from "./jobs/alert-scheduler.js";

app.listen(env.port, () => {
  console.log(`ShelfSense API listening on port ${env.port}`);
  startAlertScheduler();
});
