import { spawnSync } from "node:child_process";
import "./test-db-safety.mjs";

const env = {
  ...process.env,
  NODE_ENV: "test",
  DATABASE_URL: process.env.TEST_DATABASE_URL,
};

const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  cwd: "apps/api",
  env,
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exit(result.status ?? 1);
