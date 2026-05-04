import { Role } from "../generated/prisma/enums.js";
import { Router, type Request } from "express";
import { prisma } from "../db/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../utils/async-handler.js";

export const auditLogsRouter = Router();

auditLogsRouter.use(requireAuth);

auditLogsRouter.get("/", requireRole([Role.OWNER, Role.MANAGER]), asyncHandler(async (req, res) => {
  const workspaceId = req.user?.workspaceId ?? null;

  if (!workspaceId) {
    return res.status(403).json({ error: "Workspace access required" });
  }

  const filters = parseAuditFilters(req.query);

  if (filters.fromDate === "invalid" || filters.toDate === "invalid") {
    return res.status(400).json({ error: "Date filters must be valid dates" });
  }

  const logs = await prisma.auditLog.findMany({
    where: {
      workspaceId,
      action: filters.action,
      createdAt: {
        gte: filters.fromDate,
        lte: filters.toDate,
      },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      action: true,
      entity: true,
      entityId: true,
      meta: true,
      createdAt: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  return res.json({ logs });
}));

function parseAuditFilters(query: Request["query"]) {
  return {
    action: parseOptionalString(query.action),
    fromDate: parseOptionalDate(query.fromDate),
    toDate: parseEndOfDayDate(query.toDate),
  };
}

function parseOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseOptionalDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "invalid" : date;
}

function parseEndOfDayDate(value: unknown) {
  const date = parseOptionalDate(value);

  if (date instanceof Date && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    date.setHours(23, 59, 59, 999);
  }

  return date;
}
