import type { User, Permission } from "../types";
import { MANAGER_PERMISSIONS, OPERATOR_PERMISSIONS } from "../types";

/**
 * Check whether a user has a given permission.
 *
 * Rules (in order):
 * 1. If the user has a custom role, use the explicit `permissions` array
 *    stored on that role — base-role defaults are NOT applied.
 * 2. OWNER always has every permission.
 * 3. MANAGER / OPERATOR fall back to their default permission sets.
 */
export function hasPermission(
  user: User | null | undefined,
  permission: Permission,
): boolean {
  if (!user) return false;

  // Custom role: respect the explicit permission list
  if (user.permissions !== null && user.permissions !== undefined) {
    return (user.permissions as string[]).includes(permission);
  }

  // Standard roles
  if (user.role === "OWNER") return true;
  if (user.role === "MANAGER") return (MANAGER_PERMISSIONS as readonly string[]).includes(permission);
  if (user.role === "OPERATOR") return (OPERATOR_PERMISSIONS as readonly string[]).includes(permission);
  return false;
}
