import type { CreateTeamUserInput, CreateTeamUserResponse, TeamMember, TeamResponse } from "../types";
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
  data: Partial<Pick<CreateTeamUserInput, "name" | "role">>,
): Promise<{ user: TeamMember }> {
  return apiClient.patch<{ user: TeamMember }>(`/team/users/${userId}`, data, true);
}

export async function deactivateTeamUser(userId: string): Promise<{ user: TeamMember }> {
  return apiClient.patch<{ user: TeamMember }>(`/team/users/${userId}/deactivate`, {}, true);
}

export async function reactivateTeamUser(userId: string): Promise<{ user: TeamMember }> {
  return apiClient.patch<{ user: TeamMember }>(`/team/users/${userId}/reactivate`, {}, true);
}
