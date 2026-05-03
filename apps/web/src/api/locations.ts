import type { CreateLocationInput, CreateLocationResponse, Location, LocationsResponse } from "../types";
import { apiClient } from "./client";

export async function getLocations(includeArchived = false): Promise<LocationsResponse> {
  return apiClient.get<LocationsResponse>(`/locations${includeArchived ? "?includeArchived=true" : ""}`);
}

export async function createLocation(data: CreateLocationInput): Promise<CreateLocationResponse> {
  return apiClient.post<CreateLocationResponse>("/locations", data, true);
}

export async function updateLocation(id: string, data: CreateLocationInput): Promise<{ location: Location }> {
  return apiClient.patch<{ location: Location }>(`/locations/${id}`, data, true);
}

export async function archiveLocation(id: string): Promise<{ location: Location }> {
  return apiClient.patch<{ location: Location }>(`/locations/${id}/archive`, {}, true);
}

export async function reactivateLocation(id: string): Promise<{ location: Location }> {
  return apiClient.patch<{ location: Location }>(`/locations/${id}/reactivate`, {}, true);
}
