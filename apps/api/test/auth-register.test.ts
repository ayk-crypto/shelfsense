import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Express } from "express";
import type { PrismaClient } from "../src/generated/prisma/client.js";

let app: Express;
let prisma: PrismaClient;

const runId = `authreg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
  if (prisma) {
    const users = await prisma.user.findMany({
      where: {
        email: {
          in: Array.from(createdEmails),
        },
      },
      select: {
        id: true,
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
  }
});

describe("POST /auth/register", () => {
  it("creates user, workspace, Main Branch location, and OWNER membership", async () => {
    const email = uniqueEmail("full-create");

    const res = await request(app)
      .post("/auth/register")
      .send({
        name: "Register Owner",
        email,
        password: "demo123456",
        workspaceName: "Register Test Workspace",
      })
      .expect(201);

    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({
      name: "Register Owner",
      email,
      role: "OWNER",
    });
    expect(res.body.user.id).toEqual(expect.any(String));
    expect(res.body.user.workspaceId).toEqual(expect.any(String));

    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        memberships: true,
        ownedSpaces: {
          include: {
            locations: true,
          },
        },
      },
    });

    expect(user).not.toBeNull();
    expect(user?.memberships).toHaveLength(1);
    expect(user?.memberships[0]).toMatchObject({
      workspaceId: res.body.user.workspaceId,
      role: "OWNER",
    });
    expect(user?.ownedSpaces).toHaveLength(1);
    expect(user?.ownedSpaces[0]).toMatchObject({
      id: res.body.user.workspaceId,
      name: "Register Test Workspace",
      onboardingCompleted: false,
    });
    expect(user?.ownedSpaces[0].locations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Main Branch" }),
      ]),
    );
  });

  it("returns workspaceId and role OWNER", async () => {
    const email = uniqueEmail("shape");

    const res = await request(app)
      .post("/auth/register")
      .send({
        name: "Shape Owner",
        email,
        password: "demo123456",
      })
      .expect(201);

    expect(res.body.user.workspaceId).toEqual(expect.any(String));
    expect(res.body.user.role).toBe("OWNER");
  });

  it("returns 409 clear JSON for duplicate email", async () => {
    const email = uniqueEmail("duplicate");
    const payload = {
      name: "Duplicate Owner",
      email,
      password: "demo123456",
      workspaceName: "Duplicate Workspace",
    };

    await request(app).post("/auth/register").send(payload).expect(201);

    const res = await request(app)
      .post("/auth/register")
      .send(payload)
      .expect(409);

    expect(res.body).toEqual({ error: "Email is already registered" });
  });

  it("returns 400 for invalid email", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({
        name: "Invalid Email",
        email: "not-an-email",
        password: "demo123456",
      })
      .expect(400);

    expect(res.body).toEqual({ error: "A valid email address is required" });
  });

  it("returns 400 for short password", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({
        name: "Short Password",
        email: uniqueEmail("short-password"),
        password: "short",
      })
      .expect(400);

    expect(res.body).toEqual({ error: "Password must be at least 8 characters" });
  });
});

describe("POST /auth/login", () => {
  it("still returns existing auth shape", async () => {
    const email = uniqueEmail("login-shape");

    await request(app)
      .post("/auth/register")
      .send({
        name: "Login Shape Owner",
        email,
        password: "demo123456",
        workspaceName: "Login Shape Workspace",
      })
      .expect(201);

    const res = await request(app)
      .post("/auth/login")
      .send({
        email,
        password: "demo123456",
      })
      .expect(200);

    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({
      name: "Login Shape Owner",
      email,
      role: "OWNER",
    });
    expect(res.body.user.id).toEqual(expect.any(String));
    expect(res.body.user.createdAt).toEqual(expect.any(String));
    expect(res.body.user.workspaceId).toEqual(expect.any(String));
  });
});
