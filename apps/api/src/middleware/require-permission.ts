import type { NextFunction, Request, Response } from "express";
import { Role } from "../generated/prisma/enums.js";
import { logger } from "../lib/logger.js";

export type Permission =
  | "items:create"
  | "items:edit"
  | "items:archive"
  | "items:reactivate"
  | "items:delete"
  | "stock:in"
  | "stock:out"
  | "stock:adjust"
  | "stock:count:finalize"
  | "purchases:create"
  | "purchases:order"
  | "purchases:receive"
  | "purchases:cancel"
  | "suppliers:create"
  | "suppliers:edit"
  | "suppliers:delete"
  | "transfers:create"
  | "reports:export"
  | "workspace:settings"
  | "team:manage";

const ROLE_DEFAULT_PERMISSIONS: Record<Role, Permission[]> = {
  [Role.OWNER]: [
    "items:create", "items:edit", "items:archive", "items:reactivate", "items:delete",
    "stock:in", "stock:out", "stock:adjust", "stock:count:finalize",
    "purchases:create", "purchases:order", "purchases:receive", "purchases:cancel",
    "suppliers:create", "suppliers:edit", "suppliers:delete",
    "transfers:create", "reports:export", "workspace:settings", "team:manage",
  ],
  [Role.MANAGER]: [
    "items:create", "items:edit", "items:archive",
    "stock:in", "stock:out", "stock:adjust", "stock:count:finalize",
    "purchases:create", "purchases:order", "purchases:receive", "purchases:cancel",
    "suppliers:create", "suppliers:edit", "suppliers:delete",
    "transfers:create", "reports:export",
  ],
  [Role.OPERATOR]: [
    "stock:out", "stock:count:finalize",
  ],
};

export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;

    if (!user?.role) {
      logger.warn("[SECURITY] Permission denied — unauthenticated", { permission });
      return res.status(403).json({ error: "You do not have permission to perform this action." });
    }

    let allowed = false;

    if (user.permissions && Array.isArray(user.permissions)) {
      allowed = user.permissions.includes(permission);
    } else {
      const defaults = ROLE_DEFAULT_PERMISSIONS[user.role as Role];
      allowed = defaults ? defaults.includes(permission) : false;
    }

    if (!allowed) {
      logger.warn("[SECURITY] Permission denied", {
        userId: user.userId,
        role: user.role,
        customRoleId: user.customRoleId,
        permission,
        path: req.path,
        method: req.method,
      });
      return res.status(403).json({ error: "You do not have permission to perform this action." });
    }

    return next();
  };
}
