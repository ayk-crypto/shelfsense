import type {
  UpdateWorkspaceSettingsInput,
  WorkspaceSettingsResponse,
} from "../types";
import { apiClient } from "./client";

export async function getWorkspaceSettings(): Promise<WorkspaceSettingsResponse> {
  return apiClient.get<WorkspaceSettingsResponse>("/workspace/settings");
}

export async function updateWorkspaceSettings(
  data: UpdateWorkspaceSettingsInput,
): Promise<WorkspaceSettingsResponse> {
  return apiClient.patch<WorkspaceSettingsResponse>("/workspace/settings", data, true);
}
