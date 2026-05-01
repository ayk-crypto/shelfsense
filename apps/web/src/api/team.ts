import type { CreateTeamUserInput, CreateTeamUserResponse, TeamResponse } from "../types";
import { apiClient } from "./client";

export async function getTeam(): Promise<TeamResponse> {
  return apiClient.get<TeamResponse>("/team");
}

export async function createTeamUser(
  data: CreateTeamUserInput,
): Promise<CreateTeamUserResponse> {
  return apiClient.post<CreateTeamUserResponse>("/team/users", data, true);
}
