import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { asyncHandler } from "../utils/async-handler.js";

export const adminSystemRouter = Router();

adminSystemRouter.get("/health", asyncHandler(async (_req, res) => {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  let dbStatus: "ok" | "error" = "ok";
  let dbLatencyMs: number | null = null;

  try {
    const start = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    dbLatencyMs = Date.now() - start;
  } catch {
    dbStatus = "error";
  }

  const emailConfigured = Boolean(
    process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS,
  );

  const [failedEmails24h, totalEmailsSent, lastSentEmail] = await Promise.all([
    prisma.emailLog.count({ where: { status: "FAILED", createdAt: { gte: dayAgo } } }),
    prisma.emailLog.count({ where: { status: "SENT" } }),
    prisma.emailLog.findFirst({
      where: { status: "SENT" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, type: true, recipient: true },
    }),
  ]);

  const schedulerStatus = process.env.SCHEDULER_DISABLED ? "disabled" : "running";

  return res.json({
    health: {
      api: { status: "ok", timestamp: now.toISOString() },
      database: { status: dbStatus, latencyMs: dbLatencyMs },
      email: {
        configured: emailConfigured,
        provider: emailConfigured ? "SMTP" : "none",
        failedLast24h: failedEmails24h,
        totalSent: totalEmailsSent,
        lastSentAt: lastSentEmail?.createdAt ?? null,
        lastSentType: lastSentEmail?.type ?? null,
      },
      scheduler: { status: schedulerStatus },
      build: {
        nodeVersion: process.version,
        env: process.env.NODE_ENV ?? "development",
      },
    },
  });
}));

adminSystemRouter.get("/email-logs", asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10)));
  const skip = (page - 1) * limit;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const type = typeof req.query.type === "string" ? req.query.type : undefined;
  const search = typeof req.query.search === "string" ? req.query.search.trim() : undefined;

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (type) where.type = type;
  if (search) {
    where.OR = [
      { recipient: { contains: search, mode: "insensitive" } },
      { subject: { contains: search, mode: "insensitive" } },
    ];
  }

  const [total, logs] = await Promise.all([
    prisma.emailLog.count({ where }),
    prisma.emailLog.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      select: {
        id: true, type: true, recipient: true, subject: true,
        status: true, provider: true, errorMessage: true,
        workspaceId: true, createdAt: true,
      },
    }),
  ]);

  return res.json({ logs, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}));

adminSystemRouter.get("/email-logs/:id", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const log = await prisma.emailLog.findUnique({ where: { id } });
  if (!log) return res.status(404).json({ error: "Log not found" });
  return res.json({ log });
}));
