/**
 * ShelfSense — Production Database Cleanup Script
 *
 * Lists all non-admin users and their workspace data.
 * Allows safely deleting test/dummy accounts from production.
 * Always exports a JSON backup before any deletion.
 *
 * Usage:
 *   npm run prod:cleanup:dry-run   — show what would be deleted (safe, read-only)
 *   npm run prod:cleanup:delete    — interactive deletion with confirmation
 *
 * The script will NEVER delete platform admin accounts unless explicitly selected.
 * The script ALWAYS creates a backup JSON file before any deletion.
 */

import "dotenv/config";
import { createInterface } from "node:readline";
import { writeFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

// ─── Parse arguments ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const IS_DELETE = args.includes("--delete");
const IS_DRY_RUN = !IS_DELETE; // default is dry-run

// ─── Safety checks ────────────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("\n❌  DATABASE_URL is not set.");
  console.error("    Export it before running: DATABASE_URL=postgres://... npm run prod:cleanup:dry-run");
  process.exit(1);
}

const nodeEnv = process.env.NODE_ENV ?? "development";
const isLocalDb = /localhost|127\.0\.0\.1/.test(DATABASE_URL);

if (IS_DELETE && isLocalDb) {
  console.log("\n⚠️   Deleting from a LOCAL database (localhost detected).");
}

if (IS_DELETE && nodeEnv !== "production" && !isLocalDb) {
  console.log(`\n⚠️   NODE_ENV is "${nodeEnv}" but DATABASE_URL looks like a hosted database.`);
  console.log("    Are you sure you're targeting the right database?");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeDbDisplay(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return "<unparseable URL>";
  }
}

function banner(title: string) {
  const line = "═".repeat(60);
  console.log(`\n${line}\n  ${title}\n${line}`);
}

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// ─── Prisma setup ─────────────────────────────────────────────────────────────

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  banner("ShelfSense — Production Database Cleanup");
  console.log(`  Database  : ${safeDbDisplay(DATABASE_URL!)}`);
  console.log(`  NODE_ENV  : ${nodeEnv}`);
  console.log(`  Mode      : ${IS_DRY_RUN ? "DRY RUN  (no data will change)" : "⚠️  DELETE (data will be permanently removed)"}`);

  if (IS_DELETE) {
    console.log("\n  ⚠️  DELETE MODE — you will confirm each deletion interactively.");
    console.log("  A JSON backup will be created before any data is removed.");
  }

  // ── Fetch all users ───────────────────────────────────────────────────────

  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      platformRole: true,
      emailVerified: true,
      isLocked: true,
      createdAt: true,
      memberships: {
        select: {
          role: true,
          isActive: true,
          workspace: {
            select: {
              id: true,
              name: true,
              plan: true,
              suspended: true,
              createdAt: true,
              _count: {
                select: {
                  items: true,
                  stockMovements: true,
                  members: true,
                  supportTickets: true,
                },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  // ── Print full inventory ──────────────────────────────────────────────────

  banner(`Database Inventory — ${users.length} user(s) found`);

  const candidatesForDeletion: typeof users = [];

  for (const user of users) {
    const isPlatformAdmin = user.platformRole !== "NONE";
    const looksLikeTestAccount =
      user.email.endsWith(".local") ||
      user.email.includes("test") ||
      user.email.includes("demo") ||
      user.name?.toLowerCase().includes("test") ||
      user.name?.toLowerCase().includes("demo");

    const icon = isPlatformAdmin ? "👑" : looksLikeTestAccount ? "🧪" : "👤";
    console.log(`\n  ${icon}  ${user.name ?? "(no name)"}  <${user.email}>`);
    console.log(`       ID       : ${user.id}`);
    console.log(`       Created  : ${user.createdAt.toISOString().slice(0, 10)}`);
    console.log(`       Verified : ${user.emailVerified ? "yes" : "no"}`);
    if (isPlatformAdmin) console.log(`       Platform : ${user.platformRole}  ← PROTECTED`);
    if (user.isLocked) console.log(`       Locked   : yes`);

    if (user.memberships.length === 0) {
      console.log(`       Workspaces: (none)`);
    }
    for (const m of user.memberships) {
      const w = m.workspace;
      console.log(
        `       Workspace: "${w.name}" [${m.role}] — plan=${w.plan} | ` +
        `items=${w._count.items}, movements=${w._count.stockMovements}, ` +
        `members=${w._count.members}, tickets=${w._count.supportTickets}`,
      );
    }

    if (!isPlatformAdmin) {
      candidatesForDeletion.push(user);
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  const platformAdminCount = users.length - candidatesForDeletion.length;

  banner("Summary");
  console.log(`  Total users       : ${users.length}`);
  console.log(`  Platform admins   : ${platformAdminCount}  (protected — never auto-deleted)`);
  console.log(`  Deletable users   : ${candidatesForDeletion.length}`);

  if (candidatesForDeletion.length === 0) {
    console.log("\n  Nothing to clean up. All users are platform admins.\n");
    return;
  }

  // ── Dry-run output ────────────────────────────────────────────────────────

  if (IS_DRY_RUN) {
    banner("Dry Run — No changes made");
    console.log("  Users that WOULD be selectable for deletion:\n");
    candidatesForDeletion.forEach((u, i) => {
      console.log(`  ${i + 1}. ${u.email}  (${u.name ?? "no name"})`);
    });
    console.log("\n  Deleting a user also deletes:");
    console.log("    - Their workspace memberships");
    console.log("    - Any workspaces they own (including all items, stock batches,");
    console.log("      stock movements, purchases, suppliers, alerts, notifications)");
    console.log("    - Their support tickets and messages");
    console.log("\n  To actually delete, run: npm run prod:cleanup:delete");
    console.log("  A JSON backup is always created before any deletion.\n");
    return;
  }

  // ── Interactive delete mode ───────────────────────────────────────────────

  banner("Interactive Deletion");
  console.log("  Select users to delete by number (comma-separated).");
  console.log("  Type 'all' to select all non-admin users, or 'none' to cancel.\n");

  candidatesForDeletion.forEach((u, i) => {
    console.log(`  ${i + 1}. ${u.email}  (${u.name ?? "no name"})`);
  });

  const selection = await prompt("\nYour selection: ");
  const trimmed = selection.trim().toLowerCase();

  let selected: typeof candidatesForDeletion = [];
  if (trimmed === "none" || trimmed === "") {
    console.log("\nNo users selected. Exiting without changes.\n");
    return;
  } else if (trimmed === "all") {
    selected = [...candidatesForDeletion];
  } else {
    const indices = trimmed
      .split(",")
      .map((s) => parseInt(s.trim(), 10) - 1)
      .filter((i) => !isNaN(i) && i >= 0 && i < candidatesForDeletion.length);
    if (indices.length === 0) {
      console.log("\nNo valid indices given. Exiting without changes.\n");
      return;
    }
    selected = indices.map((i) => candidatesForDeletion[i]);
  }

  // Deduplicate
  const selectedUnique = [...new Map(selected.map((u) => [u.id, u])).values()];

  console.log(`\n  About to delete ${selectedUnique.length} user(s):`);
  for (const u of selectedUnique) {
    console.log(`    - ${u.email}  (${u.name ?? "no name"})`);
  }

  // ── Create backup ─────────────────────────────────────────────────────────

  const backupFilename = `./prod-cleanup-backup-${Date.now()}.json`;
  try {
    const backupData = {
      timestamp: new Date().toISOString(),
      databaseHost: safeDbDisplay(DATABASE_URL!),
      selectedForDeletion: selectedUnique,
      allUsers: users,
    };
    writeFileSync(backupFilename, JSON.stringify(backupData, null, 2), "utf8");
    console.log(`\n  ✅ Backup saved to: ${backupFilename}`);
    console.log("     Keep this file — it is your only record of the deleted data.\n");
  } catch (err) {
    console.error("\n  ❌ Failed to write backup file. Aborting for safety.");
    console.error(err);
    process.exit(1);
  }

  // ── Final confirmation ────────────────────────────────────────────────────

  const confirm = await prompt(`  Type DELETE to permanently remove ${selectedUnique.length} user(s): `);

  if (confirm.trim() !== "DELETE") {
    console.log("\n  Confirmation not received. No data was deleted.\n");
    return;
  }

  // ── Execute deletion ──────────────────────────────────────────────────────

  console.log();
  let deletedCount = 0;

  for (const user of selectedUnique) {
    process.stdout.write(`  Deleting ${user.email} ... `);

    try {
      // Delete owned workspaces first (all workspace data cascades via schema)
      for (const m of user.memberships) {
        if (m.role === "OWNER") {
          await prisma.workspace.delete({ where: { id: m.workspace.id } });
        }
      }

      // Delete the user (memberships in non-owned workspaces cascade from User)
      await prisma.user.delete({ where: { id: user.id } });

      console.log("✓ deleted");
      deletedCount++;
    } catch (err) {
      console.log("❌ FAILED");
      console.error(`    Error deleting ${user.email}:`, err);
      console.error("    Continuing with remaining users...");
    }
  }

  banner("Cleanup Complete");
  console.log(`  Deleted    : ${deletedCount} / ${selectedUnique.length} user(s)`);
  console.log(`  Backup at  : ${backupFilename}`);
  console.log();
}

main()
  .catch((err) => {
    console.error("\n❌  Unexpected error:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
