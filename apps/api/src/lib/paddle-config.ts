import { env } from "../config/env.js";
import { logger } from "./logger.js";

export function getPaddlePriceId(planCode: string, billingCycle: "MONTHLY" | "ANNUAL"): string | null {
  const map: Record<string, Record<string, string | undefined>> = {
    BASIC: {
      MONTHLY: env.paddleBasicMonthlyPriceId,
      ANNUAL: env.paddleBasicAnnualPriceId,
    },
    STARTER: {
      MONTHLY: env.paddleBasicMonthlyPriceId,
      ANNUAL: env.paddleBasicAnnualPriceId,
    },
    PRO: {
      MONTHLY: env.paddleProMonthlyPriceId,
      ANNUAL: env.paddleProAnnualPriceId,
    },
  };
  return map[planCode.toUpperCase()]?.[billingCycle] ?? null;
}

export function validatePaddleConfig(): void {
  const missing: string[] = [];
  if (!env.paddleWebhookSecret) missing.push("PADDLE_WEBHOOK_SECRET");
  if (!env.paddleBasicMonthlyPriceId) missing.push("PADDLE_BASIC_MONTHLY_PRICE_ID");
  if (!env.paddleBasicAnnualPriceId) missing.push("PADDLE_BASIC_ANNUAL_PRICE_ID");
  if (!env.paddleProMonthlyPriceId) missing.push("PADDLE_PRO_MONTHLY_PRICE_ID");
  if (!env.paddleProAnnualPriceId) missing.push("PADDLE_PRO_ANNUAL_PRICE_ID");
  if (missing.length > 0) {
    throw new Error(`[PADDLE] Missing required env vars: ${missing.join(", ")}`);
  }
}

export function isPaddleConfigured(): boolean {
  return Boolean(
    env.paddleWebhookSecret &&
    env.paddleBasicMonthlyPriceId &&
    env.paddleBasicAnnualPriceId &&
    env.paddleProMonthlyPriceId &&
    env.paddleProAnnualPriceId,
  );
}

export function getPaddleAmountFromCents(amount: string | number): number {
  const raw = typeof amount === "string" ? parseInt(amount, 10) : amount;
  return raw / 100;
}

export function parsePaddleBillingCycle(interval: string, frequency: number): "MONTHLY" | "ANNUAL" {
  if (interval === "year" || (interval === "month" && frequency === 12)) return "ANNUAL";
  return "MONTHLY";
}

export function logPaddle(level: "info" | "warn" | "error", message: string, meta?: Record<string, unknown>): void {
  logger[level](`[PADDLE] ${message}`, meta ?? {});
}
