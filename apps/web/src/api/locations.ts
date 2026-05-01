import type { CreateLocationInput, CreateLocationResponse, LocationsResponse } from "../types";
import { apiClient } from "./client";

export async function getLocations(): Promise<LocationsResponse> {
  return apiClient.get<LocationsResponse>("/locations");
}

export async function createLocation(data: CreateLocationInput): Promise<CreateLocationResponse> {
  return apiClient.post<CreateLocationResponse>("/locations", data, true);
}
