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

export async function forgotPassword(email: string): Promise<{ message: string }> {
  return apiClient.post<{ message: string }>("/auth/forgot-password", { email }, false);
}

export async function resetPassword(token: string, password: string): Promise<{ message: string }> {
  return apiClient.post<{ message: string }>("/auth/reset-password", { token, password }, false);
}

export async function verifyEmail(token: string): Promise<{ message: string }> {
  return apiClient.post<{ message: string }>("/auth/verify-email", { token }, false);
}

export async function resendVerification(): Promise<{ message: string }> {
  return apiClient.post<{ message: string }>("/auth/resend-verification", {}, true);
}
