import { Router } from "express";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import { asyncHandler } from "../utils/async-handler.js";
import { requireAuth } from "../middleware/auth.js";

export const supportRouter = Router();
supportRouter.use(requireAuth);

function getWorkspaceId(req: Parameters<typeof requireAuth>[0]): string | null {
  return req.user?.workspaceId ?? null;
}

const TICKET_SELECT = {
  id: true,
  ticketNumber: true,
  subject: true,
  status: true,
  priority: true,
  source: true,
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

const MESSAGE_SELECT = {
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
} as const;

// ── GET /support/tickets ───────────────────────────────────────────────────

supportRouter.get("/tickets", asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);
  if (!workspaceId) return res.status(400).json({ error: "No active workspace" });

  const q = req.query as Record<string, string | undefined>;
  const page = Math.max(1, Number(q.page ?? 1));
  const limit = Math.min(25, Math.max(1, Number(q.limit ?? 10)));
  const skip = (page - 1) * limit;

  const where: Prisma.SupportTicketWhereInput = { workspaceId };
  if (q.status) where.status = q.status as never;

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

// ── POST /support/tickets ──────────────────────────────────────────────────

supportRouter.post("/tickets", asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);
  const user = req.user!;
  if (!workspaceId) return res.status(400).json({ error: "No active workspace" });

  const { subject, message } = req.body as { subject?: string; message?: string };
  if (!subject?.trim()) return res.status(400).json({ error: "subject is required" });
  if (!message?.trim()) return res.status(400).json({ error: "message is required" });

  const ticket = await prisma.$transaction(async (tx) => {
    const t = await tx.supportTicket.create({
      data: {
        subject: subject.trim(),
        status: "OPEN",
        priority: "NORMAL",
        source: "PORTAL",
        workspaceId,
        userId: user.id,
        requesterEmail: user.email,
        requesterName: user.name,
        lastMessageAt: new Date(),
      },
      select: TICKET_SELECT,
    });

    await tx.supportMessage.create({
      data: {
        ticketId: t.id,
        direction: "INBOUND",
        senderEmail: user.email,
        senderName: user.name ?? user.email,
        bodyText: message.trim(),
        createdByUserId: user.id,
      },
    });

    await tx.supportTicketEvent.create({
      data: {
        ticketId: t.id,
        eventType: "created",
        actorUserId: user.id,
        metadata: { source: "PORTAL" } as Prisma.InputJsonValue,
      },
    });

    return t;
  });

  return res.status(201).json({ ticket });
}));

// ── GET /support/tickets/:id ───────────────────────────────────────────────

supportRouter.get("/tickets/:id", asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);
  if (!workspaceId) return res.status(400).json({ error: "No active workspace" });

  const ticket = await prisma.supportTicket.findFirst({
    where: { id: req.params.id, workspaceId },
    select: {
      ...TICKET_SELECT,
      messages: {
        where: { direction: { not: "INTERNAL" } },
        orderBy: { createdAt: "asc" },
        select: MESSAGE_SELECT,
      },
    },
  });

  if (!ticket) return res.status(404).json({ error: "Ticket not found" });
  return res.json({ ticket });
}));

// ── POST /support/tickets/:id/reply ───────────────────────────────────────

supportRouter.post("/tickets/:id/reply", asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);
  const user = req.user!;
  if (!workspaceId) return res.status(400).json({ error: "No active workspace" });

  const { message } = req.body as { message?: string };
  if (!message?.trim()) return res.status(400).json({ error: "message is required" });

  const ticket = await prisma.supportTicket.findFirst({
    where: { id: req.params.id, workspaceId },
    select: { id: true, status: true, ticketNumber: true },
  });
  if (!ticket) return res.status(404).json({ error: "Ticket not found" });

  const [msg] = await prisma.$transaction([
    prisma.supportMessage.create({
      data: {
        ticketId: ticket.id,
        direction: "INBOUND",
        senderEmail: user.email,
        senderName: user.name ?? user.email,
        bodyText: message.trim(),
        createdByUserId: user.id,
      },
      select: MESSAGE_SELECT,
    }),
    prisma.supportTicket.update({
      where: { id: ticket.id },
      data: {
        lastMessageAt: new Date(),
        status: ticket.status === "RESOLVED" || ticket.status === "CLOSED" ? "OPEN" : ticket.status,
      },
    }),
  ]);

  await prisma.supportTicketEvent.create({
    data: {
      ticketId: ticket.id,
      eventType: "customer_replied",
      actorUserId: user.id,
    },
  });

  return res.status(201).json({ message: msg });
}));
