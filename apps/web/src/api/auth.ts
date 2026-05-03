import type { LoginResponse } from "../types";
import { apiClient } from "./client";

export async function login(email: string, password: string): Promise<LoginResponse> {
  return apiClient.post<LoginResponse>("/auth/login", { email, password }, false);
}

export async function register(data: {
  name: string;
  email: string;
  password: string;
  workspaceName?: string;
}): Promise<LoginResponse> {
  return apiClient.post<LoginResponse>("/auth/register", data, false);
}
