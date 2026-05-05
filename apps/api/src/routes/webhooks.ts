import { Router } from "express";
import crypto from "crypto";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import { asyncHandler } from "../utils/async-handler.js";
import { logger } from "../lib/logger.js";
import { env } from "../config/env.js";

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

  // Parse Resend inbound email payload
  // Resend sends: { type: "email.received", data: { from, to, subject, html, text, headers, attachments } }
  // or a flat payload depending on configuration
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
    return res.status(200).json({ ok: true }); // 200 to prevent Resend retries
  }

  // Extract sender email and name from "Name <email>" format
  const match = from.match(/^"?([^"<>]*)"?\s*<([^>]+)>$/);
  const senderEmail = (match ? match[2] : from).toLowerCase().trim();
  const senderName = match ? match[1].trim() || null : null;

  logger.info(`[WEBHOOK] Inbound email from ${senderEmail} — ${subject}`);

  // Look up user by sender email
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

  // Check for existing open ticket from same sender (simple thread matching)
  // In a full implementation this would use In-Reply-To/References headers
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
