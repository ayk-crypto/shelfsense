import type { Request } from "express";
import { prisma } from "../db/prisma.js";

export const DEFAULT_LOCATION_NAME = "Main Branch";

export async function ensureDefaultLocation(workspaceId: string) {
  return prisma.location.upsert({
    where: {
      workspaceId_name: {
        workspaceId,
        name: DEFAULT_LOCATION_NAME,
      },
    },
    update: {},
    create: {
      workspaceId,
      name: DEFAULT_LOCATION_NAME,
    },
    select: {
      id: true,
      name: true,
      workspaceId: true,
      createdAt: true,
    },
  });
}

export async function getActiveLocationId(req: Request, workspaceId: string) {
  const requestedLocationId = getRequestedLocationId(req);

  if (requestedLocationId) {
    const location = await prisma.location.findFirst({
      where: {
        id: requestedLocationId,
        workspaceId,
      },
      select: { id: true },
    });

    if (location) {
      return location.id;
    }
  }

  const defaultLocation = await ensureDefaultLocation(workspaceId);
  return defaultLocation.id;
}

function getRequestedLocationId(req: Request) {
  const headerValue = req.header("x-location-id")?.trim();
  if (headerValue) return headerValue;

  const queryValue = req.query.locationId;
  if (typeof queryValue === "string" && queryValue.trim()) {
    return queryValue.trim();
  }

  const body = req.body as { locationId?: unknown } | undefined;
  return typeof body?.locationId === "string" && body.locationId.trim()
    ? body.locationId.trim()
    : null;
}
