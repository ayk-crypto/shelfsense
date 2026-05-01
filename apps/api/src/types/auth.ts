import type { Role } from "../generated/prisma/enums.js";

export interface AuthUser {
  userId: string;
  id: string;
  name: string;
  email: string;
  workspaceId: string | null;
  role: Role | null;
}
