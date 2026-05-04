import type { PlatformRole, Role } from "../generated/prisma/enums.js";

export interface AuthUser {
  userId: string;
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  platformRole: PlatformRole;
  workspaceId: string | null;
  role: Role | null;
  customRoleId: string | null;
  customRoleName: string | null;
  customRoleColor: string | null;
  permissions: string[] | null;
}
