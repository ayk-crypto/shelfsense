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

async function main() {
  const hashedPassword = await bcrypt.hash(demoUser.password, 12);

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      where: { email: demoUser.email },
      update: {
        name: demoUser.name,
        password: hashedPassword,
      },
      create: {
        name: demoUser.name,
        email: demoUser.email,
        password: hashedPassword,
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
          create: {
            userId: user.id,
            role: Role.OWNER,
          },
        },
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
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
