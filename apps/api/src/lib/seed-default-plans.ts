import { prisma } from "../db/prisma.js";
import { logger } from "./logger.js";

const DEFAULT_PLANS = [
  {
    name: "Free",
    code: "FREE",
    description: "Everything you need to replace your spreadsheet and get started.",
    monthlyPrice: 0,
    annualPrice: 0,
    currency: "$",
    trialDays: 0,
    maxUsers: 3,
    maxLocations: 1,
    maxItems: 50,
    maxSuppliers: null,
    enableExpiryTracking: true,
    enableBarcodeScanning: true,
    enableReports: true,
    enableAdvancedReports: false,
    enablePurchases: false,
    enableSuppliers: false,
    enableTeamManagement: false,
    enableCustomRoles: false,
    enableEmailAlerts: false,
    enableDailyOps: false,
    isPublic: true,
    isActive: true,
    sortOrder: 1,
  },
  {
    name: "Starter",
    code: "STARTER",
    description: "For growing teams who need real inventory control across multiple locations.",
    monthlyPrice: 19,
    annualPrice: 190,
    currency: "$",
    trialDays: 0,
    maxUsers: 10,
    maxLocations: 5,
    maxItems: 500,
    maxSuppliers: null,
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
    sortOrder: 2,
  },
  {
    name: "Pro",
    code: "PRO",
    description: "Unlimited everything. Advanced analytics, custom roles, and full team control.",
    monthlyPrice: 49,
    annualPrice: 490,
    currency: "$",
    trialDays: 0,
    maxUsers: null,
    maxLocations: null,
    maxItems: null,
    maxSuppliers: null,
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
    sortOrder: 3,
  },
];

export async function seedDefaultPlansIfEmpty(): Promise<void> {
  try {
    const count = await prisma.plan.count();
    if (count > 0) return;

    logger.info("[SEED] No plans found — seeding default plans");

    for (const plan of DEFAULT_PLANS) {
      await prisma.plan.upsert({
        where: { code: plan.code },
        update: {},
        create: plan,
      });
    }

    logger.info("[SEED] Default plans seeded: FREE, STARTER, PRO");
  } catch (err) {
    logger.error("[SEED] Failed to seed default plans", { error: String(err) });
  }
}
