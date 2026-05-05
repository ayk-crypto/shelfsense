import type { Request } from "express";
import { prisma } from "../db/prisma.js";

export const DEFAULT_LOCATION_NAME = "Main Branch";

export async function ensureDefaultLocation(workspaceId: string) {
  const activeMainBranch = await prisma.location.findFirst({
    where: {
      workspaceId,
      name: DEFAULT_LOCATION_NAME,
      isActive: true,
    },
    select: locationSelect,
  });

  if (activeMainBranch) {
    return activeMainBranch;
  }

  const activeLocation = await prisma.location.findFirst({
    where: {
      workspaceId,
      isActive: true,
    },
    orderBy: { createdAt: "asc" },
    select: locationSelect,
  });

  if (activeLocation) {
    return activeLocation;
  }

  const locationCount = await prisma.location.count({
    where: { workspaceId },
  });

  if (locationCount > 0) {
    throw Object.assign(new Error("No active locations are available"), { status: 400 });
  }

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
    select: locationSelect,
  });
}

export async function getActiveLocationId(req: Request, workspaceId: string) {
  const requestedLocationId = getRequestedLocationId(req);

  if (requestedLocationId) {
    const location = await prisma.location.findFirst({
      where: {
        id: requestedLocationId,
        workspaceId,
        isActive: true,
      },
      select: { id: true },
    });

    if (location) {
      return location.id;
    }

    // Requested location is archived or not in this workspace — silently fall
    // back to the workspace default. The frontend LocationContext will detect
    // the mismatch on its next load and update stored state automatically.
  }

  const defaultLocation = await ensureDefaultLocation(workspaceId);
  return defaultLocation.id;
}

export async function assertActiveLocation(
  client: ActiveLocationClient,
  workspaceId: string,
  locationId: string,
) {
  const location = await client.location.findFirst({
    where: {
      id: locationId,
      workspaceId,
      isActive: true,
    },
    select: { id: true },
  });

  if (!location) {
    throw Object.assign(new Error("Location is archived or unavailable"), { status: 400 });
  }

  return location.id;
}

export async function assertActiveLocations(
  client: ActiveLocationClient,
  workspaceId: string,
  locationIds: string[],
) {
  const uniqueLocationIds = [...new Set(locationIds)];
  const count = await client.location.count({
    where: {
      workspaceId,
      id: { in: uniqueLocationIds },
      isActive: true,
    },
  });

  if (count !== uniqueLocationIds.length) {
    throw Object.assign(new Error("Locations must be active and belong to this workspace"), { status: 400 });
  }
}

const locationSelect = {
  id: true,
  name: true,
  workspaceId: true,
  isActive: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

interface ActiveLocationClient {
  location: {
    findFirst: typeof prisma.location.findFirst;
    count: typeof prisma.location.count;
  };
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
