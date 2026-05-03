import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Express } from "express";
import type { PrismaClient } from "../src/generated/prisma/client.js";

let app: Express;
let prisma: PrismaClient;

const runId = `lifecycle-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const createdEmails = new Set<string>();

function uniqueEmail(label: string) {
  const email = `${runId}-${label}@example.test`;
  createdEmails.add(email);
  return email;
}

beforeAll(async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

  const appModule = await import("../src/app.js");
  const prismaModule = await import("../src/db/prisma.js");
  app = appModule.app;
  prisma = prismaModule.prisma;
});

afterAll(async () => {
  if (!prisma) return;

  const users = await prisma.user.findMany({
    where: {
      email: {
        in: Array.from(createdEmails),
      },
    },
    select: {
      ownedSpaces: {
        select: { id: true },
      },
    },
  });
  const ownedWorkspaceIds = users.flatMap((user) => user.ownedSpaces.map((workspace) => workspace.id));

  await prisma.user.deleteMany({
    where: {
      email: {
        in: Array.from(createdEmails),
      },
    },
  });

  if (ownedWorkspaceIds.length > 0) {
    const remainingOwnedWorkspaces = await prisma.workspace.count({
      where: {
        id: { in: ownedWorkspaceIds },
      },
    });

    if (remainingOwnedWorkspaces > 0) {
      throw new Error("Test cleanup failed: owned workspaces were not removed by cascade delete.");
    }
  }

  await prisma.$disconnect();
});

describe("team lifecycle", () => {
  it("updates, deactivates, and reactivates non-owner team members with audit logs", async () => {
    const owner = await registerOwner("team-lifecycle-owner");
    const teamEmail = uniqueEmail("team-member");

    const createRes = await request(app)
      .post("/team/users")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        name: "Lifecycle Operator",
        email: teamEmail,
        password: "demo123456",
        role: "OPERATOR",
      })
      .expect(201);

    const userId = createRes.body.user.userId as string;

    const updateRes = await request(app)
      .patch(`/team/users/${userId}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        name: "Lifecycle Manager",
        role: "MANAGER",
      })
      .expect(200);

    expect(updateRes.body.user).toMatchObject({
      userId,
      name: "Lifecycle Manager",
      role: "MANAGER",
      isActive: true,
    });

    const deactivateRes = await request(app)
      .patch(`/team/users/${userId}/deactivate`)
      .set("Authorization", `Bearer ${owner.token}`)
      .expect(200);

    expect(deactivateRes.body.user).toMatchObject({
      userId,
      isActive: false,
    });
    expect(deactivateRes.body.user.deactivatedAt).toEqual(expect.any(String));

    const loginRes = await request(app)
      .post("/auth/login")
      .send({
        email: teamEmail,
        password: "demo123456",
      })
      .expect(200);

    expect(loginRes.body.user.workspaceId).toBeNull();
    expect(loginRes.body.user.role).toBeNull();

    await request(app)
      .get("/items")
      .set("Authorization", `Bearer ${loginRes.body.token}`)
      .expect(403);

    const activeTokenRes = await request(app)
      .post("/auth/login")
      .send({
        email: teamEmail,
        password: "demo123456",
      })
      .expect(200);

    await request(app)
      .patch(`/team/users/${userId}/reactivate`)
      .set("Authorization", `Bearer ${owner.token}`)
      .expect(200);

    await request(app)
      .get("/items")
      .set("Authorization", `Bearer ${activeTokenRes.body.token}`)
      .expect(200);

    await request(app)
      .patch(`/team/users/${userId}/deactivate`)
      .set("Authorization", `Bearer ${owner.token}`)
      .expect(200);

    await request(app)
      .get("/items")
      .set("Authorization", `Bearer ${activeTokenRes.body.token}`)
      .expect(403);

    const reactivateRes = await request(app)
      .patch(`/team/users/${userId}/reactivate`)
      .set("Authorization", `Bearer ${owner.token}`)
      .expect(200);

    expect(reactivateRes.body.user).toMatchObject({
      userId,
      isActive: true,
      deactivatedAt: null,
    });

    const actions = await prisma.auditLog.findMany({
      where: {
        workspaceId: owner.workspaceId,
        entity: "Membership",
        entityId: userId,
      },
      select: { action: true },
    });

    expect(actions.map((log) => log.action)).toEqual(
      expect.arrayContaining([
        "UPDATE_TEAM_MEMBER",
        "DEACTIVATE_TEAM_MEMBER",
        "REACTIVATE_TEAM_MEMBER",
      ]),
    );
  });

  it("rejects owner role edits, creating owners, self-deactivation, and owner deactivation", async () => {
    const owner = await registerOwner("team-guard-owner");

    await request(app)
      .post("/team/users")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        name: "Bad Owner",
        email: uniqueEmail("bad-owner"),
        password: "demo123456",
        role: "OWNER",
      })
      .expect(400);

    await request(app)
      .patch(`/team/users/${owner.userId}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ role: "MANAGER" })
      .expect(400);

    await request(app)
      .patch(`/team/users/${owner.userId}/deactivate`)
      .set("Authorization", `Bearer ${owner.token}`)
      .expect(400);
  });
});

describe("location lifecycle", () => {
  it("updates, archives, and reactivates empty locations with audit logs", async () => {
    const owner = await registerOwner("location-lifecycle-owner");

    const createRes = await request(app)
      .post("/locations")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ name: "Archive Me" })
      .expect(201);

    const locationId = createRes.body.location.id as string;

    const updateRes = await request(app)
      .patch(`/locations/${locationId}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ name: "Archived Branch" })
      .expect(200);

    expect(updateRes.body.location).toMatchObject({
      id: locationId,
      name: "Archived Branch",
      isActive: true,
    });

    const archiveRes = await request(app)
      .patch(`/locations/${locationId}/archive`)
      .set("Authorization", `Bearer ${owner.token}`)
      .expect(200);

    expect(archiveRes.body.location).toMatchObject({
      id: locationId,
      isActive: false,
    });
    expect(archiveRes.body.location.archivedAt).toEqual(expect.any(String));

    const activeLocations = await request(app)
      .get("/locations")
      .set("Authorization", `Bearer ${owner.token}`)
      .expect(200);

    expect(activeLocations.body.locations.some((location: { id: string }) => location.id === locationId)).toBe(false);

    const allLocations = await request(app)
      .get("/locations?includeArchived=true")
      .set("Authorization", `Bearer ${owner.token}`)
      .expect(200);

    expect(allLocations.body.locations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: locationId, isActive: false }),
      ]),
    );

    await request(app)
      .get("/stock/summary")
      .set("Authorization", `Bearer ${owner.token}`)
      .set("x-location-id", locationId)
      .expect(400);

    const reactivateRes = await request(app)
      .patch(`/locations/${locationId}/reactivate`)
      .set("Authorization", `Bearer ${owner.token}`)
      .expect(200);

    expect(reactivateRes.body.location).toMatchObject({
      id: locationId,
      isActive: true,
      archivedAt: null,
    });

    const actions = await prisma.auditLog.findMany({
      where: {
        workspaceId: owner.workspaceId,
        entity: "Location",
        entityId: locationId,
      },
      select: { action: true },
    });

    expect(actions.map((log) => log.action)).toEqual(
      expect.arrayContaining([
        "UPDATE_LOCATION",
        "ARCHIVE_LOCATION",
        "REACTIVATE_LOCATION",
      ]),
    );
  });

  it("rejects archiving locations with remaining stock and the last active location", async () => {
    const owner = await registerOwner("location-guard-owner");

    const stockLocationRes = await request(app)
      .post("/locations")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ name: "Stock Branch" })
      .expect(201);

    const stockLocationId = stockLocationRes.body.location.id as string;

    const itemRes = await request(app)
      .post("/items")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        name: "Lifecycle Flour",
        unit: "kg",
        minStockLevel: 1,
      })
      .expect(201);

    await request(app)
      .post("/stock/in")
      .set("Authorization", `Bearer ${owner.token}`)
      .set("x-location-id", stockLocationId)
      .send({
        itemId: itemRes.body.item.id,
        quantity: 5,
      })
      .expect(201);

    const stockArchiveRes = await request(app)
      .patch(`/locations/${stockLocationId}/archive`)
      .set("Authorization", `Bearer ${owner.token}`)
      .expect(400);

    expect(stockArchiveRes.body).toEqual({ error: "Cannot archive a location with remaining stock" });

    const lastLocationOwner = await registerOwner("last-location-owner");
    const mainBranch = await prisma.location.findFirstOrThrow({
      where: {
        workspaceId: lastLocationOwner.workspaceId,
        name: "Main Branch",
      },
      select: { id: true },
    });

    const lastArchiveRes = await request(app)
      .patch(`/locations/${mainBranch.id}/archive`)
      .set("Authorization", `Bearer ${lastLocationOwner.token}`)
      .expect(400);

    expect(lastArchiveRes.body).toEqual({ error: "Cannot archive the last active location" });
  });

  it("does not silently reactivate archived-only workspaces from location reads", async () => {
    const owner = await registerOwner("archived-only-owner");

    await prisma.location.updateMany({
      where: { workspaceId: owner.workspaceId },
      data: {
        isActive: false,
        archivedAt: new Date(),
      },
    });

    const res = await request(app)
      .get("/locations")
      .set("Authorization", `Bearer ${owner.token}`)
      .expect(400);

    expect(res.body).toEqual({ error: "No active locations are available" });

    const activeLocations = await prisma.location.count({
      where: {
        workspaceId: owner.workspaceId,
        isActive: true,
      },
    });

    expect(activeLocations).toBe(0);
  });

  it("prevents concurrent archives from leaving zero active locations", async () => {
    const owner = await registerOwner("concurrent-archive-owner");
    const branchRes = await request(app)
      .post("/locations")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ name: "Second Branch" })
      .expect(201);

    const mainBranch = await prisma.location.findFirstOrThrow({
      where: {
        workspaceId: owner.workspaceId,
        name: "Main Branch",
      },
      select: { id: true },
    });

    const [first, second] = await Promise.all([
      request(app)
        .patch(`/locations/${mainBranch.id}/archive`)
        .set("Authorization", `Bearer ${owner.token}`),
      request(app)
        .patch(`/locations/${branchRes.body.location.id}/archive`)
        .set("Authorization", `Bearer ${owner.token}`),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 400]);

    const activeLocations = await prisma.location.count({
      where: {
        workspaceId: owner.workspaceId,
        isActive: true,
      },
    });

    expect(activeLocations).toBe(1);
  });

  it("rejects archived locations as transfer source or destination", async () => {
    const owner = await registerOwner("transfer-archived-owner");
    const sourceRes = await request(app)
      .post("/locations")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ name: "Transfer Source" })
      .expect(201);
    const destinationRes = await request(app)
      .post("/locations")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ name: "Transfer Destination" })
      .expect(201);
    const itemRes = await createItem(owner.token, "Transfer Rice");

    await request(app)
      .post("/stock/in")
      .set("Authorization", `Bearer ${owner.token}`)
      .set("x-location-id", sourceRes.body.location.id)
      .send({
        itemId: itemRes.body.item.id,
        quantity: 4,
      })
      .expect(201);

    await request(app)
      .patch(`/locations/${destinationRes.body.location.id}/archive`)
      .set("Authorization", `Bearer ${owner.token}`)
      .expect(200);

    await request(app)
      .post("/stock/transfer")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        itemId: itemRes.body.item.id,
        fromLocationId: sourceRes.body.location.id,
        toLocationId: destinationRes.body.location.id,
        quantity: 1,
      })
      .expect(400);

    await prisma.location.update({
      where: { id: sourceRes.body.location.id },
      data: {
        isActive: false,
        archivedAt: new Date(),
      },
    });

    await request(app)
      .post("/stock/transfer")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        itemId: itemRes.body.item.id,
        fromLocationId: sourceRes.body.location.id,
        toLocationId: await getMainBranchId(owner.workspaceId),
        quantity: 1,
      })
      .expect(400);
  });

  it("rejects stock-in and purchase creation for archived requested locations", async () => {
    const owner = await registerOwner("archived-write-owner");
    const archivedRes = await request(app)
      .post("/locations")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ name: "Archived Writes" })
      .expect(201);
    const itemRes = await createItem(owner.token, "Archived Write Beans");

    await request(app)
      .patch(`/locations/${archivedRes.body.location.id}/archive`)
      .set("Authorization", `Bearer ${owner.token}`)
      .expect(200);

    await request(app)
      .post("/stock/in")
      .set("Authorization", `Bearer ${owner.token}`)
      .set("x-location-id", archivedRes.body.location.id)
      .send({
        itemId: itemRes.body.item.id,
        quantity: 3,
      })
      .expect(400);

    const supplierRes = await request(app)
      .post("/suppliers")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ name: "Archived Write Supplier" })
      .expect(201);

    await request(app)
      .post("/purchases")
      .set("Authorization", `Bearer ${owner.token}`)
      .set("x-location-id", archivedRes.body.location.id)
      .send({
        supplierId: supplierRes.body.supplier.id,
        items: [
          {
            itemId: itemRes.body.item.id,
            quantity: 2,
            unitCost: 10,
          },
        ],
      })
      .expect(400);
  });
});

async function registerOwner(label: string) {
  const email = uniqueEmail(label);
  const res = await request(app)
    .post("/auth/register")
    .send({
      name: `Owner ${label}`,
      email,
      password: "demo123456",
      workspaceName: `Workspace ${label}`,
    })
    .expect(201);

  return {
    token: res.body.token as string,
    userId: res.body.user.id as string,
    workspaceId: res.body.user.workspaceId as string,
  };
}

function createItem(token: string, name: string) {
  return request(app)
    .post("/items")
    .set("Authorization", `Bearer ${token}`)
    .send({
      name,
      unit: "pcs",
      minStockLevel: 1,
    })
    .expect(201);
}

async function getMainBranchId(workspaceId: string) {
  const mainBranch = await prisma.location.findFirstOrThrow({
    where: {
      workspaceId,
      name: "Main Branch",
    },
    select: { id: true },
  });

  return mainBranch.id;
}
