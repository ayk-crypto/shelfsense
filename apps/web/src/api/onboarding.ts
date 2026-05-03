import type { CompleteOnboardingResponse, OnboardingStatusResponse } from "../types";
import { apiClient } from "./client";

export async function getOnboardingStatus(): Promise<OnboardingStatusResponse> {
  return apiClient.get<OnboardingStatusResponse>("/onboarding/status");
}

export async function completeOnboarding(): Promise<CompleteOnboardingResponse> {
  return apiClient.patch<CompleteOnboardingResponse>("/onboarding/complete", {});
}
