import type { CreateCustomRoleInput, CreateTeamUserInput, CreateTeamUserResponse, CustomRole, CustomRolesResponse, TeamMember, TeamResponse } from "../types";
import { apiClient } from "./client";

export async function getTeam(includeInactive = false): Promise<TeamResponse> {
  return apiClient.get<TeamResponse>(`/team${includeInactive ? "?includeInactive=true" : ""}`);
}

export async function createTeamUser(
  data: CreateTeamUserInput,
): Promise<CreateTeamUserResponse> {
  return apiClient.post<CreateTeamUserResponse>("/team/users", data, true);
}

export async function updateTeamUser(
  userId: string,
  data: Partial<Pick<CreateTeamUserInput, "name" | "role"> & { customRoleId: string | null }>,
): Promise<{ user: TeamMember }> {
  return apiClient.patch<{ user: TeamMember }>(`/team/users/${userId}`, data, true);
}

export async function deactivateTeamUser(userId: string): Promise<{ user: TeamMember }> {
  return apiClient.patch<{ user: TeamMember }>(`/team/users/${userId}/deactivate`, {}, true);
}

export async function reactivateTeamUser(userId: string): Promise<{ user: TeamMember }> {
  return apiClient.patch<{ user: TeamMember }>(`/team/users/${userId}/reactivate`, {}, true);
}

export async function getCustomRoles(): Promise<CustomRolesResponse> {
  return apiClient.get<CustomRolesResponse>("/team/custom-roles");
}

export async function createCustomRole(data: CreateCustomRoleInput): Promise<{ customRole: CustomRole }> {
  return apiClient.post<{ customRole: CustomRole }>("/team/custom-roles", data, true);
}

export async function updateCustomRole(
  roleId: string,
  data: Partial<CreateCustomRoleInput>,
): Promise<{ customRole: CustomRole }> {
  return apiClient.patch<{ customRole: CustomRole }>(`/team/custom-roles/${roleId}`, data, true);
}

export async function deleteCustomRole(roleId: string): Promise<{ ok: boolean }> {
  return apiClient.delete<{ ok: boolean }>(`/team/custom-roles/${roleId}`, true);
}
