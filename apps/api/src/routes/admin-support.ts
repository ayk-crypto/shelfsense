import { Router } from "express";
import nodemailer from "nodemailer";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import { asyncHandler } from "../utils/async-handler.js";
import { logger } from "../lib/logger.js";
import { env } from "../config/env.js";

export const adminSupportRouter = Router();

// ── Helpers ────────────────────────────────────────────────────────────────

async function logAdminAction(
  adminId: string,
  action: string,
  entity: string,
  entityId: string,
  meta: Record<string, unknown> = {},
) {
  await prisma.adminAuditLog.create({
    data: { adminId, action, entity, entityId, meta: meta as Prisma.InputJsonValue },
  });
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

const TICKET_SELECT = {
  id: true,
  ticketNumber: true,
  subject: true,
  status: true,
  priority: true,
  source: true,
  category: true,
  workspaceId: true,
  userId: true,
  requesterEmail: true,
  requesterName: true,
  assignedToUserId: true,
  lastMessageAt: true,
  resolvedAt: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
  workspace: { select: { id: true, name: true } },
  user: { select: { id: true, name: true, email: true } },
  assignedTo: { select: { id: true, name: true, email: true } },
  _count: { select: { messages: true } },
} as const;

// ── GET /admin/support/summary ─────────────────────────────────────────────

adminSupportRouter.get("/summary", asyncHandler(async (_req, res) => {
  const [openCount, pendingCount, urgentCount, recentOpen] = await Promise.all([
    prisma.supportTicket.count({ where: { status: "OPEN" } }),
    prisma.supportTicket.count({ where: { status: "PENDING" } }),
    prisma.supportTicket.count({ where: { status: "OPEN", priority: { in: ["URGENT", "HIGH"] } } }),
    prisma.supportTicket.findMany({
      where: { status: { in: ["OPEN", "PENDING"] } },
      orderBy: { lastMessageAt: "desc" },
      take: 5,
      select: {
        id: true,
        ticketNumber: true,
        subject: true,
        status: true,
        priority: true,
        category: true,
        requesterEmail: true,
        requesterName: true,
        lastMessageAt: true,
        workspace: { select: { id: true, name: true } },
      },
    }),
  ]);

  return res.json({
    openCount,
    pendingCount,
    urgentCount,
    totalActive: openCount + pendingCount,
    recentOpen,
  });
}));

// ── GET /admin/support/tickets ─────────────────────────────────────────────

adminSupportRouter.get("/tickets", asyncHandler(async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const page = Math.max(1, Number(q.page ?? 1));
  const limit = Math.min(50, Math.max(1, Number(q.limit ?? 25)));
  const skip = (page - 1) * limit;

  const where: Prisma.SupportTicketWhereInput = {};
  if (q.status) where.status = q.status as never;
  if (q.priority) where.priority = q.priority as never;
  if (q.source) where.source = q.source as never;
  if (q.category) where.category = q.category;
  if (q.workspaceId) where.workspaceId = q.workspaceId;
  if (q.userId) where.userId = q.userId;
  if (q.assignedToUserId) where.assignedToUserId = q.assignedToUserId;
  if (q.search) {
    where.OR = [
      { subject: { contains: q.search, mode: "insensitive" } },
      { requesterEmail: { contains: q.search, mode: "insensitive" } },
      { requesterName: { contains: q.search, mode: "insensitive" } },
    ];
  }

  const [tickets, total] = await Promise.all([
    prisma.supportTicket.findMany({
      where,
      orderBy: { lastMessageAt: "desc" },
      skip,
      take: limit,
      select: TICKET_SELECT,
    }),
    prisma.supportTicket.count({ where }),
  ]);

  return res.json({ tickets, total, page, pages: Math.ceil(total / limit) });
}));

// ── GET /admin/support/tickets/:id ────────────────────────────────────────

adminSupportRouter.get("/tickets/:id", asyncHandler(async (req, res) => {
  const { id } = req.params;

  const ticket = await prisma.supportTicket.findUnique({
    where: { id },
    select: {
      ...TICKET_SELECT,
      messages: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          ticketId: true,
          direction: true,
          senderEmail: true,
          senderName: true,
          bodyHtml: true,
          bodyText: true,
          providerMessageId: true,
          attachments: true,
          createdByUserId: true,
          createdAt: true,
          createdBy: { select: { id: true, name: true } },
        },
      },
      notes: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          ticketId: true,
          note: true,
          createdByUserId: true,
          createdAt: true,
          createdBy: { select: { id: true, name: true } },
        },
      },
      events: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          ticketId: true,
          actorUserId: true,
          eventType: true,
          metadata: true,
          createdAt: true,
          actor: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!ticket) return res.status(404).json({ error: "Ticket not found" });
  return res.json({ ticket });
}));

// ── POST /admin/support/tickets/:id/reply ────────────────────────────────

adminSupportRouter.post("/tickets/:id/reply", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const adminId = req.user!.id;
  const adminName = req.user!.name;
  const adminEmail = req.user!.email;

  const body = req.body as { bodyText: string; bodyHtml?: string };
  if (!body.bodyText?.trim()) {
    return res.status(400).json({ error: "Reply body is required" });
  }

  const ticket = await prisma.supportTicket.findUnique({
    where: { id },
    select: { id: true, subject: true, requesterEmail: true, requesterName: true, status: true, ticketNumber: true },
  });
  if (!ticket) return res.status(404).json({ error: "Ticket not found" });

  const subject = ticket.subject.startsWith("Re:") ? ticket.subject : `Re: ${ticket.subject}`;
  const supportFrom = env.supportFrom ?? `"ShelfSense Support" <${env.smtpUser ?? env.emailFrom}>`;

  const footerText = `\n\n---\nShelfSense Support — Ticket #${ticket.ticketNumber}\nTo reply, respond to this email.`;
  const footerHtml = `<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0"><p style="font-size:12px;color:#94a3b8">ShelfSense Support — Ticket #${ticket.ticketNumber}<br>To reply, respond to this email.</p>`;

  const fullText = body.bodyText.trim() + footerText;
  const fullHtml = body.bodyHtml
    ? `${body.bodyHtml}${footerHtml}`
    : `<p style="white-space:pre-wrap">${body.bodyText.trim().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>${footerHtml}`;

  let providerMessageId: string | null = null;
  const isDev = env.nodeEnv !== "production";

  if (!isDev && env.smtpHost && env.smtpUser && env.smtpPass) {
    try {
      const transporter = nodemailer.createTransport({
        host: env.smtpHost,
        port: env.smtpPort,
        secure: env.smtpPort === 465,
        auth: { user: env.smtpUser, pass: env.smtpPass },
      });
      const info = await transporter.sendMail({
        from: supportFrom,
        to: ticket.requesterEmail,
        subject,
        text: fullText,
        html: fullHtml,
      });
      providerMessageId = info.messageId ?? null;
    } catch (err) {
      logger.error("[SUPPORT] Failed to send reply email", { ticketId: id, error: String(err) });
    }
  } else {
    logger.info(`[SUPPORT:DEV] Reply to ${ticket.requesterEmail} — ${subject}`);
  }

  await prisma.emailLog.create({
    data: {
      type: "SUPPORT_REPLY",
      recipient: ticket.requesterEmail,
      subject,
      status: providerMessageId || isDev ? "SENT" : "FAILED",
      provider: isDev ? "DEV_LOG" : (env.smtpHost ? "SMTP" : "none"),
      providerMessageId,
    },
  }).catch(() => {});

  const [message] = await prisma.$transaction([
    prisma.supportMessage.create({
      data: {
        ticketId: id,
        direction: "OUTBOUND",
        senderEmail: adminEmail,
        senderName: adminName,
        bodyText: body.bodyText.trim(),
        bodyHtml: body.bodyHtml ?? null,
        providerMessageId,
        createdByUserId: adminId,
      },
      select: {
        id: true, ticketId: true, direction: true, senderEmail: true, senderName: true,
        bodyHtml: true, bodyText: true, providerMessageId: true, attachments: true,
        createdByUserId: true, createdAt: true,
        createdBy: { select: { id: true, name: true } },
      },
    }),
    prisma.supportTicket.update({
      where: { id },
      data: {
        lastMessageAt: new Date(),
        status: ticket.status === "CLOSED" || ticket.status === "RESOLVED" ? "OPEN" : ticket.status,
      },
    }),
  ]);

  await logTicketEvent(id, "replied", adminId, { subject });
  await logAdminAction(adminId, "support_ticket_replied", "support_ticket", id, { ticketNumber: ticket.ticketNumber, to: ticket.requesterEmail });

  return res.status(201).json({ message });
}));

// ── PATCH /admin/support/tickets/:id/status ──────────────────────────────

adminSupportRouter.patch("/tickets/:id/status", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const adminId = req.user!.id;
  const { status } = req.body as { status: string };

  const validStatuses = ["OPEN", "PENDING", "RESOLVED", "CLOSED"];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${validStatuses.join(", ")}` });
  }

  const ticket = await prisma.supportTicket.findUnique({ where: { id }, select: { id: true, status: true, ticketNumber: true } });
  if (!ticket) return res.status(404).json({ error: "Ticket not found" });

  const now = new Date();
  const data: Prisma.SupportTicketUpdateInput = { status: status as never };
  if (status === "RESOLVED" && ticket.status !== "RESOLVED") data.resolvedAt = now;
  if (status === "CLOSED" && ticket.status !== "CLOSED") data.closedAt = now;
  if ((status === "OPEN" || status === "PENDING") && ticket.status === "RESOLVED") data.resolvedAt = null;
  if ((status === "OPEN" || status === "PENDING" || status === "RESOLVED") && ticket.status === "CLOSED") data.closedAt = null;

  const updated = await prisma.supportTicket.update({ where: { id }, data, select: TICKET_SELECT });
  await logTicketEvent(id, "status_changed", adminId, { from: ticket.status, to: status });
  await logAdminAction(adminId, "support_ticket_status_changed", "support_ticket", id, { ticketNumber: ticket.ticketNumber, from: ticket.status, to: status });

  return res.json({ ticket: updated });
}));

// ── PATCH /admin/support/tickets/:id/priority ─────────────────────────────

adminSupportRouter.patch("/tickets/:id/priority", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const adminId = req.user!.id;
  const { priority } = req.body as { priority: string };

  const validPriorities = ["LOW", "NORMAL", "HIGH", "URGENT"];
  if (!validPriorities.includes(priority)) {
    return res.status(400).json({ error: `priority must be one of: ${validPriorities.join(", ")}` });
  }

  const ticket = await prisma.supportTicket.findUnique({ where: { id }, select: { id: true, priority: true, ticketNumber: true } });
  if (!ticket) return res.status(404).json({ error: "Ticket not found" });

  const updated = await prisma.supportTicket.update({
    where: { id },
    data: { priority: priority as never },
    select: TICKET_SELECT,
  });

  await logTicketEvent(id, "priority_changed", adminId, { from: ticket.priority, to: priority });
  await logAdminAction(adminId, "support_ticket_priority_changed", "support_ticket", id, { ticketNumber: ticket.ticketNumber, from: ticket.priority, to: priority });

  return res.json({ ticket: updated });
}));

// ── PATCH /admin/support/tickets/:id/category ─────────────────────────────

adminSupportRouter.patch("/tickets/:id/category", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const adminId = req.user!.id;
  const { category } = req.body as { category: string | null };

  const validCategories = ["billing", "technical", "account", "feature", "general", null];
  if (!validCategories.includes(category as never)) {
    return res.status(400).json({ error: "Invalid category" });
  }

  const ticket = await prisma.supportTicket.findUnique({ where: { id }, select: { id: true, category: true, ticketNumber: true } });
  if (!ticket) return res.status(404).json({ error: "Ticket not found" });

  const updated = await prisma.supportTicket.update({
    where: { id },
    data: { category },
    select: TICKET_SELECT,
  });

  await logTicketEvent(id, "category_changed", adminId, { from: ticket.category, to: category });
  await logAdminAction(adminId, "support_ticket_category_changed", "support_ticket", id, { ticketNumber: ticket.ticketNumber, from: ticket.category, to: category });

  return res.json({ ticket: updated });
}));

// ── POST /admin/support/tickets/:id/notes ────────────────────────────────

adminSupportRouter.post("/tickets/:id/notes", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const adminId = req.user!.id;
  const { note } = req.body as { note: string };

  if (!note?.trim()) return res.status(400).json({ error: "note is required" });

  const ticket = await prisma.supportTicket.findUnique({ where: { id }, select: { id: true, ticketNumber: true } });
  if (!ticket) return res.status(404).json({ error: "Ticket not found" });

  const created = await prisma.supportInternalNote.create({
    data: { ticketId: id, note: note.trim(), createdByUserId: adminId },
    select: {
      id: true, ticketId: true, note: true, createdByUserId: true, createdAt: true,
      createdBy: { select: { id: true, name: true } },
    },
  });

  await logTicketEvent(id, "note_added", adminId, {});
  await logAdminAction(adminId, "support_note_added", "support_ticket", id, { ticketNumber: ticket.ticketNumber });

  return res.status(201).json({ note: created });
}));

// ── PATCH /admin/support/tickets/:id/assign ──────────────────────────────

adminSupportRouter.patch("/tickets/:id/assign", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const adminId = req.user!.id;
  const { assignedToUserId } = req.body as { assignedToUserId: string | null };

  const ticket = await prisma.supportTicket.findUnique({ where: { id }, select: { id: true, assignedToUserId: true, ticketNumber: true } });
  if (!ticket) return res.status(404).json({ error: "Ticket not found" });

  if (assignedToUserId) {
    const assignee = await prisma.user.findUnique({ where: { id: assignedToUserId }, select: { id: true } });
    if (!assignee) return res.status(400).json({ error: "Assignee not found" });
  }

  const updated = await prisma.supportTicket.update({
    where: { id },
    data: { assignedToUserId: assignedToUserId ?? null },
    select: TICKET_SELECT,
  });

  await logTicketEvent(id, "assigned", adminId, { to: assignedToUserId });
  await logAdminAction(adminId, "support_ticket_assigned", "support_ticket", id, { ticketNumber: ticket.ticketNumber, assignedToUserId });

  return res.json({ ticket: updated });
}));
