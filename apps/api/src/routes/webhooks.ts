import { Router } from "express";
import crypto from "crypto";
import { Prisma } from "../generated/prisma/client.js";
import { SubscriptionStatus, BillingCycle, PaymentMethod, PaymentStatus } from "../generated/prisma/enums.js";
import { prisma } from "../db/prisma.js";
import { asyncHandler } from "../utils/async-handler.js";
import { logger } from "../lib/logger.js";
import { env } from "../config/env.js";
import { getPaddleAmountFromCents, parsePaddleBillingCycle } from "../lib/paddle-config.js";

export const webhooksRouter = Router();

// ── HTML sanitiser (no external deps) ────────────────────────────────────

function sanitizeHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script\s*>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style\s*>/gi, "")
    .replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, "")
    .replace(/\bhref\s*=\s*"javascript:[^"]*"/gi, 'href="#"')
    .replace(/\bhref\s*=\s*'javascript:[^']*'/gi, "href='#'")
    .replace(/<\/?(iframe|object|embed|form|meta|base)\b[^>]*>/gi, "");
}

async function logTicketEvent(
  ticketId: string,
  eventType: string,
  actorUserId: string | null,
  metadata: Record<string, unknown> = {},
) {
  await prisma.supportTicketEvent.create({
    data: {
      ticketId,
      eventType,
      actorUserId,
      metadata: metadata as Prisma.InputJsonValue,
    },
  });
}

// ── Paddle signature verification ──────────────────────────────────────────

function verifyPaddleSignature(rawBody: Buffer | string, signatureHeader: string, secret: string): boolean {
  const parts = signatureHeader.split(";");
  const tsPart = parts.find((p) => p.startsWith("ts="));
  const h1Part = parts.find((p) => p.startsWith("h1="));
  if (!tsPart || !h1Part) return false;

  const ts = tsPart.slice(3);
  const h1 = h1Part.slice(3);
  const bodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody;
  const payload = `${ts}:${bodyStr}`;

  const expected = crypto.createHmac("sha256", secret).update(payload, "utf8").digest("hex");

  try {
    // Lengths must match for timingSafeEqual
    if (expected.length !== h1.length) return false;
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(h1, "hex"));
  } catch {
    return false;
  }
}

// ── Paddle custom_data helper ──────────────────────────────────────────────

interface PaddleCustomData {
  workspaceId?: string;
  userId?: string;
  planCode?: string;
  billingCycle?: string;
}

function extractCustomData(data: Record<string, unknown>): PaddleCustomData {
  const cd = (data.custom_data ?? {}) as Record<string, unknown>;
  return {
    workspaceId: typeof cd.workspaceId === "string" ? cd.workspaceId : undefined,
    userId: typeof cd.userId === "string" ? cd.userId : undefined,
    planCode: typeof cd.planCode === "string" ? cd.planCode : undefined,
    billingCycle: typeof cd.billingCycle === "string" ? cd.billingCycle : undefined,
  };
}

const PLAN_TIER_MAP: Record<string, string> = {
  FREE: "FREE",
  STARTER: "BASIC",
  BASIC: "BASIC",
  PRO: "PRO",
  BUSINESS: "PRO",
};

// ── POST /webhooks/paddle ──────────────────────────────────────────────────
// Receives events from Paddle Billing (v2).
// Uses raw body captured by express.json verify hook in app.ts.

webhooksRouter.post(
  "/paddle",
  asyncHandler(async (req, res) => {
    const signatureHeader = (req.headers["paddle-signature"] ?? "") as string;
    const webhookSecret = env.paddleWebhookSecret;

    // Raw body is attached by the app.ts verify hook
    const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;

    if (!rawBody) {
      logger.warn("[PADDLE][WEBHOOK] Missing raw body — ensure rawBody capture is configured");
      return res.status(400).json({ error: "Raw body not available" });
    }

    if (!webhookSecret) {
      logger.error("[PADDLE][WEBHOOK] PADDLE_WEBHOOK_SECRET not configured — rejecting webhook");
      return res.status(500).json({ error: "Webhook secret not configured" });
    }

    if (!signatureHeader) {
      logger.warn("[PADDLE][WEBHOOK] Missing Paddle-Signature header");
      return res.status(401).json({ error: "Missing Paddle-Signature header" });
    }

    const valid = verifyPaddleSignature(rawBody, signatureHeader, webhookSecret);
    if (!valid) {
      logger.warn("[PADDLE][WEBHOOK] Signature verification failed");
      return res.status(401).json({ error: "Invalid webhook signature" });
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>;
    } catch {
      return res.status(400).json({ error: "Invalid JSON payload" });
    }

    const eventType = (payload.event_type ?? payload.notification_type) as string | undefined;
    const eventId = (payload.event_id ?? payload.notification_id) as string | undefined;

    if (!eventId || !eventType) {
      logger.warn("[PADDLE][WEBHOOK] Missing event_id or event_type", { payload });
      return res.status(400).json({ error: "Missing event_id or event_type" });
    }

    logger.info("[PADDLE][WEBHOOK] Received", { eventType, eventId });

    // Idempotency: check if already processed
    const existing = await prisma.webhookEvent.findUnique({ where: { eventId } });
    if (existing) {
      if (existing.processingStatus === "PROCESSED") {
        logger.info("[PADDLE][WEBHOOK] Duplicate event ignored", { eventId });
        return res.json({ ok: true, idempotent: true });
      }
      // If RECEIVED or FAILED, allow re-processing
    }

    // Store event (upsert for re-processing support)
    const webhookRecord = await prisma.webhookEvent.upsert({
      where: { eventId },
      create: {
        provider: "paddle",
        eventId,
        eventType,
        processingStatus: "RECEIVED",
        rawPayload: payload as Prisma.InputJsonValue,
      },
      update: {
        processingStatus: "RECEIVED",
        errorMessage: null,
      },
    });

    try {
      await processPaddleEvent(eventType, payload as Record<string, unknown>);

      await prisma.webhookEvent.update({
        where: { id: webhookRecord.id },
        data: { processingStatus: "PROCESSED", processedAt: new Date() },
      });

      logger.info("[PADDLE][WEBHOOK] Processed successfully", { eventType, eventId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("[PADDLE][WEBHOOK] Processing failed", { eventType, eventId, error: msg });

      await prisma.webhookEvent.update({
        where: { id: webhookRecord.id },
        data: { processingStatus: "FAILED", errorMessage: msg },
      });

      // Still return 200 so Paddle doesn't retry on processing errors (data issues)
    }

    return res.json({ ok: true });
  }),
);

// ── Event processor ────────────────────────────────────────────────────────

async function processPaddleEvent(eventType: string, payload: Record<string, unknown>): Promise<void> {
  const data = (payload.data ?? {}) as Record<string, unknown>;

  switch (eventType) {
    case "transaction.completed":
      await handleTransactionCompleted(data);
      break;
    case "subscription.created":
      await handleSubscriptionCreated(data);
      break;
    case "subscription.updated":
      await handleSubscriptionUpdated(data);
      break;
    case "subscription.canceled":
    case "subscription.cancelled":
      await handleSubscriptionCanceled(data);
      break;
    case "subscription.past_due":
      await handleSubscriptionPastDue(data);
      break;
    case "transaction.payment_failed":
      await handleTransactionPaymentFailed(data);
      break;
    case "transaction.refunded":
      await handleTransactionRefunded(data);
      break;
    default:
      logger.info("[PADDLE][WEBHOOK] Unhandled event type", { eventType });
  }
}

// ── transaction.completed ─────────────────────────────────────────────────

async function handleTransactionCompleted(data: Record<string, unknown>): Promise<void> {
  const customData = extractCustomData(data);
  const { workspaceId, userId, planCode, billingCycle } = customData;

  if (!workspaceId) {
    logger.warn("[PADDLE][transaction.completed] Missing workspaceId in custom_data");
    return;
  }

  const transactionId = data.id as string | undefined;
  const subscriptionId = data.subscription_id as string | undefined;
  const customerId = data.customer_id as string | undefined;
  const billingPeriod = data.billing_period as Record<string, unknown> | undefined;
  const items = (data.items as Record<string, unknown>[] | undefined) ?? [];
  const details = (data.details as Record<string, unknown> | undefined) ?? {};
  const totals = (details.totals as Record<string, unknown> | undefined) ?? {};

  const priceId = (items[0] as Record<string, unknown>)?.price_id as string | undefined
    ?? ((items[0] as Record<string, unknown>)?.price as Record<string, unknown>)?.id as string | undefined;
  const amountStr = (totals.total as string | undefined) ?? (totals.subtotal as string | undefined) ?? "0";
  const amount = getPaddleAmountFromCents(amountStr);
  const currency = (totals.currency_code as string | undefined) ?? "USD";

  const periodStart = billingPeriod?.starts_at ? new Date(billingPeriod.starts_at as string) : new Date();
  const periodEnd = billingPeriod?.ends_at ? new Date(billingPeriod.ends_at as string) : null;

  const resolvedPlanCode = (planCode ?? "BASIC").toUpperCase();
  const resolvedCycle = billingCycle === "ANNUAL" ? BillingCycle.ANNUAL : BillingCycle.MONTHLY;
  const workspaceTier = PLAN_TIER_MAP[resolvedPlanCode] ?? "BASIC";

  const plan = await prisma.plan.findFirst({
    where: { code: { in: [resolvedPlanCode, workspaceTier] }, isActive: true },
    select: { id: true },
  });

  if (!plan) {
    logger.error("[PADDLE][transaction.completed] Plan not found", { resolvedPlanCode, workspaceTier });
    return;
  }

  await prisma.$transaction(async (tx) => {
    // Cancel existing active subscriptions
    await tx.subscription.updateMany({
      where: {
        workspaceId,
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL, SubscriptionStatus.MANUAL_REVIEW] },
      },
      data: { status: SubscriptionStatus.CANCELLED },
    });

    // Find or create the subscription for this Paddle subscription_id
    let sub = subscriptionId
      ? await tx.subscription.findFirst({ where: { gatewaySubscriptionId: subscriptionId } })
      : null;

    if (sub) {
      sub = await tx.subscription.update({
        where: { id: sub.id },
        data: {
          status: SubscriptionStatus.ACTIVE,
          gatewayTransactionId: transactionId,
          gatewayCustomerId: customerId,
          gatewayPriceId: priceId,
          gatewayStatus: "completed",
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          nextBillingAt: periodEnd,
          nextRenewalAt: periodEnd,
          lastPaymentAt: new Date(),
          amount,
          currency,
          billingCycle: resolvedCycle,
          planId: plan.id,
          manualNotes: null,
        },
      });
    } else {
      sub = await tx.subscription.create({
        data: {
          workspaceId,
          planId: plan.id,
          status: SubscriptionStatus.ACTIVE,
          billingCycle: resolvedCycle,
          currency,
          amount,
          gatewayProvider: "paddle",
          gatewayCustomerId: customerId,
          gatewaySubscriptionId: subscriptionId,
          gatewayTransactionId: transactionId,
          gatewayPriceId: priceId,
          gatewayStatus: "completed",
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          nextBillingAt: periodEnd,
          nextRenewalAt: periodEnd,
          lastPaymentAt: new Date(),
          manualNotes: null,
        },
      });
    }

    // Record payment
    if (userId) {
      await tx.payment.create({
        data: {
          workspaceId,
          subscriptionId: sub.id,
          amount,
          currency,
          paymentMethod: PaymentMethod.PADDLE,
          status: PaymentStatus.PAID,
          paidAt: new Date(),
          gatewayProvider: "paddle",
          gatewayReference: transactionId,
          notes: `Paddle transaction ${transactionId}`,
          recordedByUserId: userId,
        },
      });
    }

    // Update workspace plan tier
    await tx.workspace.update({
      where: { id: workspaceId },
      data: { plan: workspaceTier as "FREE" | "BASIC" | "PRO", onboardingCompleted: true },
    });
  });

  logger.info("[PADDLE][transaction.completed] Subscription activated", {
    workspaceId, planCode: resolvedPlanCode, transactionId, amount,
  });
}

// ── subscription.created ──────────────────────────────────────────────────

async function handleSubscriptionCreated(data: Record<string, unknown>): Promise<void> {
  const customData = extractCustomData(data);
  const { workspaceId, userId, planCode, billingCycle } = customData;

  if (!workspaceId) {
    logger.warn("[PADDLE][subscription.created] Missing workspaceId in custom_data");
    return;
  }

  const paddleSubId = data.id as string | undefined;
  const customerId = data.customer_id as string | undefined;
  const paddleStatus = data.status as string | undefined;
  const billingCycleData = data.billing_cycle as Record<string, unknown> | undefined;
  const currentPeriod = data.current_billing_period as Record<string, unknown> | undefined;
  const items = (data.items as Record<string, unknown>[] | undefined) ?? [];
  const priceId = ((items[0] as Record<string, unknown>)?.price as Record<string, unknown>)?.id as string | undefined;
  const unitPrice = ((items[0] as Record<string, unknown>)?.price as Record<string, unknown>)?.unit_price as Record<string, unknown> | undefined;
  const amountStr = unitPrice?.amount as string | undefined ?? "0";
  const currency = unitPrice?.currency_code as string | undefined ?? "USD";
  const amount = getPaddleAmountFromCents(amountStr);

  const resolvedCycle = billingCycleData
    ? parsePaddleBillingCycle(billingCycleData.interval as string, billingCycleData.frequency as number)
    : billingCycle === "ANNUAL" ? "ANNUAL" : "MONTHLY";

  const periodStart = currentPeriod?.starts_at ? new Date(currentPeriod.starts_at as string) : new Date();
  const periodEnd = currentPeriod?.ends_at ? new Date(currentPeriod.ends_at as string) : null;

  const resolvedPlanCode = (planCode ?? "BASIC").toUpperCase();
  const workspaceTier = PLAN_TIER_MAP[resolvedPlanCode] ?? "BASIC";

  const plan = await prisma.plan.findFirst({
    where: { code: { in: [resolvedPlanCode, workspaceTier] }, isActive: true },
    select: { id: true },
  });
  if (!plan) {
    logger.error("[PADDLE][subscription.created] Plan not found", { resolvedPlanCode });
    return;
  }

  const dbStatus = paddleStatus === "trialing" ? SubscriptionStatus.TRIAL : SubscriptionStatus.ACTIVE;
  const dbCycle = resolvedCycle === "ANNUAL" ? BillingCycle.ANNUAL : BillingCycle.MONTHLY;

  await prisma.$transaction(async (tx) => {
    // Upsert by Paddle subscription ID
    const existing = paddleSubId
      ? await tx.subscription.findFirst({ where: { gatewaySubscriptionId: paddleSubId } })
      : null;

    if (existing) {
      await tx.subscription.update({
        where: { id: existing.id },
        data: {
          status: dbStatus,
          gatewayCustomerId: customerId,
          gatewayPriceId: priceId,
          gatewayStatus: paddleStatus,
          billingCycle: dbCycle,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          nextBillingAt: periodEnd,
          nextRenewalAt: periodEnd,
          amount,
          currency,
          planId: plan.id,
          manualNotes: null,
        },
      });
    } else {
      await tx.subscription.updateMany({
        where: {
          workspaceId,
          status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL, SubscriptionStatus.MANUAL_REVIEW] },
        },
        data: { status: SubscriptionStatus.CANCELLED },
      });

      await tx.subscription.create({
        data: {
          workspaceId,
          planId: plan.id,
          status: dbStatus,
          billingCycle: dbCycle,
          currency,
          amount,
          gatewayProvider: "paddle",
          gatewayCustomerId: customerId,
          gatewaySubscriptionId: paddleSubId,
          gatewayPriceId: priceId,
          gatewayStatus: paddleStatus,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          nextBillingAt: periodEnd,
          nextRenewalAt: periodEnd,
          manualNotes: null,
        },
      });
    }

    await tx.workspace.update({
      where: { id: workspaceId },
      data: { plan: workspaceTier as "FREE" | "BASIC" | "PRO", onboardingCompleted: true },
    });
  });

  logger.info("[PADDLE][subscription.created] Subscription created/updated", {
    workspaceId, paddleSubId, status: dbStatus,
  });
}

// ── subscription.updated ──────────────────────────────────────────────────

async function handleSubscriptionUpdated(data: Record<string, unknown>): Promise<void> {
  const paddleSubId = data.id as string | undefined;
  if (!paddleSubId) return;

  const customData = extractCustomData(data);
  const { workspaceId } = customData;

  const sub = await prisma.subscription.findFirst({
    where: { gatewaySubscriptionId: paddleSubId },
  });
  if (!sub && !workspaceId) {
    logger.warn("[PADDLE][subscription.updated] Subscription not found", { paddleSubId });
    return;
  }

  const paddleStatus = data.status as string | undefined;
  const scheduledChange = data.scheduled_change as Record<string, unknown> | undefined;
  const cancelAtPeriodEnd = scheduledChange?.action === "cancel";
  const currentPeriod = data.current_billing_period as Record<string, unknown> | undefined;
  const billingCycleData = data.billing_cycle as Record<string, unknown> | undefined;
  const items = (data.items as Record<string, unknown>[] | undefined) ?? [];
  const priceId = ((items[0] as Record<string, unknown>)?.price as Record<string, unknown>)?.id as string | undefined;

  let dbStatus: SubscriptionStatus | undefined;
  if (paddleStatus === "active") dbStatus = SubscriptionStatus.ACTIVE;
  else if (paddleStatus === "trialing") dbStatus = SubscriptionStatus.TRIAL;
  else if (paddleStatus === "past_due") dbStatus = SubscriptionStatus.PAST_DUE;
  else if (paddleStatus === "canceled" || paddleStatus === "cancelled") dbStatus = SubscriptionStatus.CANCELLED;
  else if (paddleStatus === "paused") dbStatus = SubscriptionStatus.SUSPENDED;

  const resolvedCycle = billingCycleData
    ? parsePaddleBillingCycle(billingCycleData.interval as string, billingCycleData.frequency as number)
    : null;
  const dbCycle = resolvedCycle === "ANNUAL" ? BillingCycle.ANNUAL : resolvedCycle === "MONTHLY" ? BillingCycle.MONTHLY : undefined;

  const periodStart = currentPeriod?.starts_at ? new Date(currentPeriod.starts_at as string) : undefined;
  const periodEnd = currentPeriod?.ends_at ? new Date(currentPeriod.ends_at as string) : undefined;

  const targetId = sub?.id;
  if (!targetId) return;

  await prisma.subscription.update({
    where: { id: targetId },
    data: {
      ...(dbStatus !== undefined && { status: dbStatus }),
      ...(dbCycle !== undefined && { billingCycle: dbCycle }),
      ...(priceId && { gatewayPriceId: priceId }),
      ...(paddleStatus && { gatewayStatus: paddleStatus }),
      cancelAtPeriodEnd,
      ...(periodStart && { currentPeriodStart: periodStart }),
      ...(periodEnd && { currentPeriodEnd: periodEnd, nextBillingAt: periodEnd, nextRenewalAt: periodEnd }),
    },
  });

  logger.info("[PADDLE][subscription.updated] Subscription updated", {
    paddleSubId, status: dbStatus, cancelAtPeriodEnd,
  });
}

// ── subscription.canceled ─────────────────────────────────────────────────

async function handleSubscriptionCanceled(data: Record<string, unknown>): Promise<void> {
  const paddleSubId = data.id as string | undefined;
  if (!paddleSubId) return;

  const sub = await prisma.subscription.findFirst({
    where: { gatewaySubscriptionId: paddleSubId },
  });
  if (!sub) {
    logger.warn("[PADDLE][subscription.canceled] Subscription not found", { paddleSubId });
    return;
  }

  const effectiveAt = data.canceled_at as string | undefined ?? data.effective_at as string | undefined;

  await prisma.subscription.update({
    where: { id: sub.id },
    data: {
      status: SubscriptionStatus.CANCELLED,
      gatewayStatus: "canceled",
      cancelAtPeriodEnd: false,
      ...(effectiveAt && { currentPeriodEnd: new Date(effectiveAt) }),
    },
  });

  logger.info("[PADDLE][subscription.canceled] Subscription cancelled", { paddleSubId });
}

// ── subscription.past_due ─────────────────────────────────────────────────

async function handleSubscriptionPastDue(data: Record<string, unknown>): Promise<void> {
  const paddleSubId = data.id as string | undefined;
  if (!paddleSubId) return;

  const sub = await prisma.subscription.findFirst({ where: { gatewaySubscriptionId: paddleSubId } });
  if (!sub) return;

  await prisma.subscription.update({
    where: { id: sub.id },
    data: { status: SubscriptionStatus.PAST_DUE, gatewayStatus: "past_due" },
  });

  logger.warn("[PADDLE][subscription.past_due] Marked as past due", { paddleSubId });
}

// ── transaction.payment_failed ────────────────────────────────────────────

async function handleTransactionPaymentFailed(data: Record<string, unknown>): Promise<void> {
  const transactionId = data.id as string | undefined;
  const subscriptionId = data.subscription_id as string | undefined;

  logger.warn("[PADDLE][transaction.payment_failed] Payment failed", { transactionId, subscriptionId });

  if (subscriptionId) {
    const sub = await prisma.subscription.findFirst({ where: { gatewaySubscriptionId: subscriptionId } });
    if (sub) {
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { status: SubscriptionStatus.PAST_DUE, gatewayStatus: "payment_failed" },
      });
    }
  }

  if (transactionId) {
    await prisma.payment.updateMany({
      where: { gatewayReference: transactionId },
      data: { status: PaymentStatus.FAILED },
    });
  }
}

// ── transaction.refunded ──────────────────────────────────────────────────

async function handleTransactionRefunded(data: Record<string, unknown>): Promise<void> {
  const transactionId = data.id as string | undefined;
  const subscriptionId = data.subscription_id as string | undefined;

  logger.info("[PADDLE][transaction.refunded] Refund received", { transactionId, subscriptionId });

  if (transactionId) {
    await prisma.payment.updateMany({
      where: { gatewayReference: transactionId },
      data: { status: PaymentStatus.REFUNDED },
    });
  }

  // Flag subscription for admin review if still active
  if (subscriptionId) {
    const sub = await prisma.subscription.findFirst({ where: { gatewaySubscriptionId: subscriptionId } });
    if (sub && sub.status === SubscriptionStatus.ACTIVE) {
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { manualNotes: `Refund issued for transaction ${transactionId} — review required.` },
      });
    }
  }
}

// ── POST /webhooks/resend/inbound ─────────────────────────────────────────
// Receives inbound email from Resend for support@shelfsenseapp.com

webhooksRouter.post("/resend/inbound", asyncHandler(async (req, res) => {
  // Validate webhook secret if configured
  if (env.supportInboundSecret) {
    const signature = req.headers["svix-signature"] as string | undefined
      ?? req.headers["resend-signature"] as string | undefined
      ?? req.headers["x-resend-signature"] as string | undefined;

    if (!signature) {
      logger.warn("[WEBHOOK] Missing inbound email signature");
      return res.status(401).json({ error: "Missing signature" });
    }

    const rawBody = JSON.stringify(req.body);
    const expected = crypto
      .createHmac("sha256", env.supportInboundSecret)
      .update(rawBody)
      .digest("hex");

    const provided = signature.replace(/^sha256=/, "");
    if (!crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(provided, "hex"))) {
      logger.warn("[WEBHOOK] Invalid inbound email signature");
      return res.status(401).json({ error: "Invalid signature" });
    }
  }

  const payload = req.body as Record<string, unknown>;
  const emailData = (payload.data ?? payload) as Record<string, unknown>;

  const from = (emailData.from ?? emailData.sender ?? "") as string;
  const subject = ((emailData.subject ?? "(No subject)") as string).trim();
  const htmlBody = emailData.html as string | undefined ?? null;
  const textBody = (emailData.text ?? emailData.plain_text ?? "") as string;
  const messageId = emailData.message_id as string | undefined
    ?? (emailData.headers as Record<string, string> | undefined)?.["Message-ID"]
    ?? null;
  const attachmentsRaw = emailData.attachments ?? null;

  if (!from) {
    logger.warn("[WEBHOOK] Inbound email missing sender");
    return res.status(200).json({ ok: true });
  }

  const match = from.match(/^"?([^"<>]*)"?\s*<([^>]+)>$/);
  const senderEmail = (match ? match[2] : from).toLowerCase().trim();
  const senderName = match ? match[1].trim() || null : null;

  logger.info(`[WEBHOOK] Inbound email from ${senderEmail} — ${subject}`);

  const user = await prisma.user.findUnique({
    where: { email: senderEmail },
    select: {
      id: true,
      memberships: {
        where: { isActive: true },
        select: { workspaceId: true },
        take: 1,
      },
    },
  });

  const userId = user?.id ?? null;
  const workspaceId = user?.memberships[0]?.workspaceId ?? null;

  const sanitizedHtml = htmlBody ? sanitizeHtml(htmlBody) : null;

  const existingTicket = messageId ? null : await prisma.supportTicket.findFirst({
    where: {
      requesterEmail: senderEmail,
      status: { in: ["OPEN", "PENDING"] },
    },
    orderBy: { lastMessageAt: "desc" },
    select: { id: true, ticketNumber: true },
  });

  let ticketId: string;
  let isNew = false;

  if (existingTicket) {
    ticketId = existingTicket.id;
    await prisma.supportTicket.update({
      where: { id: ticketId },
      data: { lastMessageAt: new Date(), status: "OPEN" },
    });
  } else {
    const ticket = await prisma.supportTicket.create({
      data: {
        subject,
        status: "OPEN",
        priority: "NORMAL",
        source: "EMAIL",
        workspaceId,
        userId,
        requesterEmail: senderEmail,
        requesterName: senderName,
        lastMessageAt: new Date(),
      },
      select: { id: true, ticketNumber: true },
    });
    ticketId = ticket.id;
    isNew = true;
  }

  await prisma.supportMessage.create({
    data: {
      ticketId,
      direction: "INBOUND",
      senderEmail,
      senderName,
      bodyHtml: sanitizedHtml,
      bodyText: textBody || subject,
      providerMessageId: messageId,
      attachments: attachmentsRaw as Prisma.InputJsonValue ?? Prisma.JsonNull,
      createdByUserId: userId,
    },
  });

  await logTicketEvent(
    ticketId,
    isNew ? "ticket_created" : "message_received",
    userId,
    { senderEmail, subject },
  );

  logger.info(`[WEBHOOK] ${isNew ? "Created" : "Updated"} ticket ${ticketId} from inbound email`);

  return res.status(200).json({ ok: true, ticketId });
}));
