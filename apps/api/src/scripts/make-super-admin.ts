import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

const dbUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/shelfsense?schema=public";

const adapter = new PrismaPg({ connectionString: dbUrl });
const prisma = new PrismaClient({ adapter });

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();

  if (!email) {
    console.error("Usage: npm run make:super-admin -- <email>");
    process.exit(1);
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true, platformRole: true, isDisabled: true },
  });

  if (!user) {
    console.error(`Error: No user found with email: ${email}`);
    process.exit(1);
  }

  if (user.platformRole === "SUPER_ADMIN" && !user.isDisabled) {
    console.log(`Already done: ${user.name} <${user.email}> is SUPER_ADMIN and active.`);
    process.exit(0);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { platformRole: "SUPER_ADMIN", isDisabled: false },
  });

  console.log(`Success: ${user.name} <${user.email}> is now SUPER_ADMIN (isDisabled=false).`);
}

main()
  .catch((err) => {
    console.error("Error:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
