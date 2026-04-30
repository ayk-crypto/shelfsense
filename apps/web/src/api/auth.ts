import type { LoginResponse } from "../types";
import { apiClient } from "./client";

export async function login(email: string, password: string): Promise<LoginResponse> {
  return apiClient.post<LoginResponse>("/auth/login", { email, password }, false);
}
