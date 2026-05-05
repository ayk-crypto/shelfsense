import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/shelfsense?schema=public";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

const plans = [
  {
    name: "Free",
    code: "FREE",
    description: "Everything you need to replace your spreadsheet and get started.",
    monthlyPrice: 0,
    annualPrice: 0,
    currency: "$",
    maxUsers: 3,
    maxLocations: 1,
    maxItems: 50,
    enableExpiryTracking: true,
    enableBarcodeScanning: true,
    enableReports: true,
    enableAdvancedReports: false,
    enablePurchases: false,
    enableSuppliers: false,
    enableTeamManagement: true,
    enableCustomRoles: false,
    enableEmailAlerts: true,
    enableDailyOps: true,
    isPublic: true,
    isActive: true,
    sortOrder: 0,
  },
  {
    name: "Starter",
    code: "STARTER",
    description: "For growing businesses that need more items, locations, and team members.",
    monthlyPrice: 19,
    annualPrice: 190,
    currency: "$",
    maxUsers: 10,
    maxLocations: 5,
    maxItems: 500,
    enableExpiryTracking: true,
    enableBarcodeScanning: true,
    enableReports: true,
    enableAdvancedReports: false,
    enablePurchases: true,
    enableSuppliers: true,
    enableTeamManagement: true,
    enableCustomRoles: false,
    enableEmailAlerts: true,
    enableDailyOps: true,
    isPublic: true,
    isActive: true,
    sortOrder: 1,
  },
  {
    name: "Pro",
    code: "PRO",
    description: "Unlimited scale for operations that can't afford gaps in visibility.",
    monthlyPrice: 49,
    annualPrice: 490,
    currency: "$",
    maxUsers: null,
    maxLocations: null,
    maxItems: null,
    enableExpiryTracking: true,
    enableBarcodeScanning: true,
    enableReports: true,
    enableAdvancedReports: true,
    enablePurchases: true,
    enableSuppliers: true,
    enableTeamManagement: true,
    enableCustomRoles: true,
    enableEmailAlerts: true,
    enableDailyOps: true,
    isPublic: true,
    isActive: true,
    sortOrder: 2,
  },
];

async function main() {
  console.log("Seeding plans…");
  for (const plan of plans) {
    const result = await prisma.plan.upsert({
      where: { code: plan.code },
      update: plan,
      create: plan,
    });
    console.log(`  ✓ ${result.name} (${result.code}) — id: ${result.id}`);
  }
  console.log("Done.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
