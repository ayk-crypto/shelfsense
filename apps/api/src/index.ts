import { app } from "./app.js";
import { env, getDbDisplayInfo } from "./config/env.js";
import { startAlertScheduler } from "./jobs/alert-scheduler.js";
import { logSchemaReadiness } from "./lib/schema-readiness.js";
import { seedDefaultPlansIfEmpty } from "./lib/seed-default-plans.js";
import { isPaddleConfigured } from "./lib/paddle-config.js";

function printStartupBanner() {
  const line = "─".repeat(56);
  const db = getDbDisplayInfo(env.databaseUrl);
  const envLabel =
    env.nodeEnv === "production"
      ? "production  ⚠️  LIVE"
      : env.nodeEnv === "staging"
        ? "staging"
        : "development";

  const paddleStatus = (() => {
    if (env.paymentProvider !== "paddle") return `disabled (provider=${env.paymentProvider})`;
    if (!env.paddleWebhookSecret)        return "✗ PADDLE_WEBHOOK_SECRET missing";
    if (!env.paddleBasicMonthlyPriceId)  return "✗ PADDLE_BASIC_MONTHLY_PRICE_ID missing";
    if (!env.paddleBasicAnnualPriceId)   return "✗ PADDLE_BASIC_ANNUAL_PRICE_ID missing";
    if (!env.paddleProMonthlyPriceId)    return "✗ PADDLE_PRO_MONTHLY_PRICE_ID missing";
    if (!env.paddleProAnnualPriceId)     return "✗ PADDLE_PRO_ANNUAL_PRICE_ID missing";
    return `✓ configured (${env.paddleEnv})`;
  })();

  console.log(`\n${line}`);
  console.log(`  ShelfSense API — ${envLabel}`);
  console.log(`  DB      : ${db}`);
  console.log(`  Port    : ${env.port}`);
  console.log(`  Web     : ${env.appUrl}`);
  console.log(`  CORS    : ${env.corsAllowedOrigins.join(", ")}`);
  console.log(`  Payment : ${env.paymentProvider}`);
  console.log(`  Paddle  : ${paddleStatus}`);
  console.log(`${line}\n`);
}

app.listen(env.port, "0.0.0.0", () => {
  printStartupBanner();
  void logSchemaReadiness();
  void seedDefaultPlansIfEmpty();
  startAlertScheduler();
});
