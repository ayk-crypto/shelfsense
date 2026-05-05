import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { Role, StockMovementType } from "../src/generated/prisma/enums.js";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/shelfsense?schema=public";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

const demoUser = {
  name: "Demo User",
  email: "demo@shelfsense.local",
  password: "demo123456",
};

const demoOperatorUser = {
  name: "Demo Operator",
  email: "operator@shelfsense.local",
  password: "demo123456",
};

const demoWorkspaceName = "ShelfSense Demo Workspace";

const demoItems = [
  {
    name: "Chicken",
    unit: "kg",
    category: "Raw Material",
    minStockLevel: 10,
    trackExpiry: true,
    batches: [
      {
        quantity: 25,
        remainingQuantity: 18,
        unitCost: 620,
        expiryDate: "2026-05-30",
        batchNo: "CHK-001",
        supplierName: "Demo Poultry Supplier",
      },
    ],
  },
  {
    name: "Cooking Oil",
    unit: "liter",
    category: "Raw Material",
    minStockLevel: 5,
    trackExpiry: true,
    batches: [
      {
        quantity: 12,
        remainingQuantity: 8,
        unitCost: 520,
        expiryDate: "2026-07-15",
        batchNo: "OIL-001",
        supplierName: "Demo Grocery Supplier",
      },
    ],
  },
  {
    name: "Rice",
    unit: "kg",
    category: "Raw Material",
    minStockLevel: 20,
    trackExpiry: false,
    batches: [
      {
        quantity: 60,
        remainingQuantity: 42,
        unitCost: 280,
        expiryDate: null,
        batchNo: "RICE-001",
        supplierName: "Demo Staples Supplier",
      },
    ],
  },
  {
    name: "Coke 1.5L",
    unit: "pcs",
    category: "Beverage",
    minStockLevel: 12,
    trackExpiry: true,
    batches: [
      {
        quantity: 36,
        remainingQuantity: 30,
        unitCost: 165,
        expiryDate: "2026-06-20",
        batchNo: "COKE-001",
        supplierName: "Demo Beverage Supplier",
      },
    ],
  },
  {
    name: "Flour",
    unit: "kg",
    category: "Raw Material",
    minStockLevel: 15,
    trackExpiry: true,
    batches: [
      {
        quantity: 40,
        remainingQuantity: 22,
        unitCost: 190,
        expiryDate: "2026-06-05",
        batchNo: "FLR-001",
        supplierName: "Demo Bakery Supplier",
      },
    ],
  },
];

const DEFAULT_PLANS = [
  { name: "Free", code: "FREE", description: "Get started with basic inventory tracking.", monthlyPrice: 0, annualPrice: 0, trialDays: 0, maxUsers: 2, maxLocations: 1, maxItems: 100, maxSuppliers: 10, enableExpiryTracking: true, enableBarcodeScanning: false, enableReports: true, enableAdvancedReports: false, enablePurchases: false, enableSuppliers: false, enableTeamManagement: false, enableCustomRoles: false, enableEmailAlerts: false, enableDailyOps: false, isPublic: true, sortOrder: 0 },
  { name: "Starter", code: "STARTER", description: "Perfect for small teams managing one location.", monthlyPrice: 1500, annualPrice: 15000, trialDays: 14, maxUsers: 5, maxLocations: 2, maxItems: 500, maxSuppliers: 50, enableExpiryTracking: true, enableBarcodeScanning: true, enableReports: true, enableAdvancedReports: false, enablePurchases: true, enableSuppliers: true, enableTeamManagement: true, enableCustomRoles: false, enableEmailAlerts: true, enableDailyOps: true, isPublic: true, sortOrder: 1 },
  { name: "Pro", code: "PRO", description: "Full-featured plan for growing businesses.", monthlyPrice: 3500, annualPrice: 35000, trialDays: 14, maxUsers: 20, maxLocations: 10, maxItems: 5000, maxSuppliers: null, enableExpiryTracking: true, enableBarcodeScanning: true, enableReports: true, enableAdvancedReports: true, enablePurchases: true, enableSuppliers: true, enableTeamManagement: true, enableCustomRoles: true, enableEmailAlerts: true, enableDailyOps: true, isPublic: true, sortOrder: 2 },
  { name: "Business", code: "BUSINESS", description: "Unlimited scale for enterprise operations.", monthlyPrice: 8000, annualPrice: 80000, trialDays: 14, maxUsers: null, maxLocations: null, maxItems: null, maxSuppliers: null, enableExpiryTracking: true, enableBarcodeScanning: true, enableReports: true, enableAdvancedReports: true, enablePurchases: true, enableSuppliers: true, enableTeamManagement: true, enableCustomRoles: true, enableEmailAlerts: true, enableDailyOps: true, isPublic: true, sortOrder: 3 },
  { name: "Custom", code: "CUSTOM", description: "Tailored plan with custom pricing and limits.", monthlyPrice: 0, annualPrice: 0, trialDays: 0, maxUsers: null, maxLocations: null, maxItems: null, maxSuppliers: null, enableExpiryTracking: true, enableBarcodeScanning: true, enableReports: true, enableAdvancedReports: true, enablePurchases: true, enableSuppliers: true, enableTeamManagement: true, enableCustomRoles: true, enableEmailAlerts: true, enableDailyOps: true, isPublic: false, sortOrder: 4 },
] as const;

async function seedPlans() {
  for (const plan of DEFAULT_PLANS) {
    await prisma.plan.upsert({
      where: { code: plan.code },
      update: { name: plan.name, description: plan.description, sortOrder: plan.sortOrder },
      create: plan,
    });
  }
  console.log("Default plans seeded.");
}

async function seedCoupons() {
  await prisma.coupon.upsert({
    where: { code: "LAUNCH100" },
    update: { isActive: true },
    create: {
      code: "LAUNCH100",
      name: "Launch 100% Off",
      description: "Full discount for early adopters — activate any paid plan for free.",
      discountType: "PERCENTAGE",
      discountValue: 100,
      isActive: true,
    },
  });
  console.log("Launch coupon seeded (LAUNCH100).");
}

async function main() {
  await seedPlans();
  await seedCoupons();
  const hashedPassword = await bcrypt.hash(demoUser.password, 12);
  const hashedOperatorPassword = await bcrypt.hash(demoOperatorUser.password, 12);

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      where: { email: demoUser.email },
      update: {
        name: demoUser.name,
        password: hashedPassword,
        emailVerified: true,
      },
      create: {
        name: demoUser.name,
        email: demoUser.email,
        password: hashedPassword,
        emailVerified: true,
      },
    });

    const operatorUser = await tx.user.upsert({
      where: { email: demoOperatorUser.email },
      update: {
        name: demoOperatorUser.name,
        password: hashedOperatorPassword,
        emailVerified: true,
      },
      create: {
        name: demoOperatorUser.name,
        email: demoOperatorUser.email,
        password: hashedOperatorPassword,
        emailVerified: true,
      },
    });

    const existingDemoWorkspaces = await tx.workspace.findMany({
      where: {
        ownerId: user.id,
        name: demoWorkspaceName,
      },
      select: { id: true },
    });
    const workspaceIds = existingDemoWorkspaces.map((workspace) => workspace.id);

    if (workspaceIds.length > 0) {
      await tx.stockMovement.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await tx.stockBatch.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await tx.item.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await tx.membership.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await tx.workspace.deleteMany({
        where: { id: { in: workspaceIds } },
      });
    }

    const workspace = await tx.workspace.create({
      data: {
        name: demoWorkspaceName,
        ownerId: user.id,
        memberships: {
          create: [
            {
              userId: user.id,
              role: Role.OWNER,
            },
            {
              userId: operatorUser.id,
              role: Role.OPERATOR,
            },
          ],
        },
      },
    });

    const location = await tx.location.create({
      data: {
        name: "Main Branch",
        workspaceId: workspace.id,
      },
    });

    for (const demoItem of demoItems) {
      const item = await tx.item.create({
        data: {
          name: demoItem.name,
          unit: demoItem.unit,
          category: demoItem.category,
          minStockLevel: demoItem.minStockLevel,
          trackExpiry: demoItem.trackExpiry,
          workspaceId: workspace.id,
        },
      });

      for (const demoBatch of demoItem.batches) {
        const batch = await tx.stockBatch.create({
          data: {
            itemId: item.id,
            workspaceId: workspace.id,
            locationId: location.id,
            quantity: demoBatch.quantity,
            remainingQuantity: demoBatch.remainingQuantity,
            unitCost: demoBatch.unitCost,
            expiryDate: demoBatch.expiryDate
              ? new Date(demoBatch.expiryDate)
              : null,
            batchNo: demoBatch.batchNo,
            supplierName: demoBatch.supplierName,
          },
        });

        await tx.stockMovement.create({
          data: {
            workspaceId: workspace.id,
            locationId: location.id,
            itemId: item.id,
            batchId: batch.id,
            type: StockMovementType.STOCK_IN,
            quantity: demoBatch.quantity,
            unitCost: demoBatch.unitCost,
            note: "Demo opening stock",
          },
        });
      }
    }
  });

  console.log("Demo seed complete.");
  console.log(`Email: ${demoUser.email}`);
  console.log(`Password: ${demoUser.password}`);
  console.log(`Operator Email: ${demoOperatorUser.email}`);
  console.log(`Operator Password: ${demoOperatorUser.password}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
