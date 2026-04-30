import { Role } from "../generated/prisma/enums.js";
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { prisma } from "../db/prisma.js";
import { asyncHandler } from "../utils/async-handler.js";

export const workspaceRouter = Router();

workspaceRouter.post("/create", requireAuth, asyncHandler(async (req, res) => {
  const { name } = req.body as { name?: string };

  const trimmedName = name?.trim();

  if (!trimmedName) {
    return res.status(400).json({ error: "Workspace name is required" });
  }

  const workspace = await prisma.workspace.create({
    data: {
      name: trimmedName,
      ownerId: req.user!.id,
      memberships: {
        create: {
          userId: req.user!.id,
          role: Role.OWNER,
        },
      },
    },
    include: {
      memberships: {
        where: { userId: req.user!.id },
        select: { id: true, role: true, createdAt: true },
      },
    },
  });

  return res.status(201).json({ workspace });
}));
