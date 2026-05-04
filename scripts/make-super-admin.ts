import "dotenv/config";
import { PrismaClient } from "../apps/api/src/generated/prisma/client.js";
import { PlatformRole } from "../apps/api/src/generated/prisma/enums.js";

const prisma = new PrismaClient();

async function main() {
  const email = process.argv[2];

  if (!email) {
    console.error("Usage: npm run make:super-admin -- <email>");
    process.exit(1);
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true, platformRole: true },
  });

  if (!user) {
    console.error(`No user found with email: ${email}`);
    process.exit(1);
  }

  if (user.platformRole === PlatformRole.SUPER_ADMIN) {
    console.log(`${user.name} (${user.email}) is already a SUPER_ADMIN.`);
    process.exit(0);
  }

  await prisma.user.update({
    where: { email },
    data: { platformRole: PlatformRole.SUPER_ADMIN },
  });

  console.log(`✅  Promoted ${user.name} (${user.email}) to SUPER_ADMIN.`);
  console.log("They will see Platform Admin in the app on next login.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
