import type { CompleteOnboardingResponse, OnboardingStatusResponse } from "../types";
import { apiClient } from "./client";

export async function getOnboardingStatus(): Promise<OnboardingStatusResponse> {
  return apiClient.get<OnboardingStatusResponse>("/onboarding/status");
}

export async function saveOnboardingStep(step: number): Promise<void> {
  await apiClient.patch<{ currentStep: number }>("/onboarding/step", { step });
}

export async function completeOnboarding(): Promise<CompleteOnboardingResponse> {
  return apiClient.patch<CompleteOnboardingResponse>("/onboarding/complete", {});
}
