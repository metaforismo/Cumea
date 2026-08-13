import * as SecureStore from "expo-secure-store";
import type { Enrollment } from "./types";

const ENROLLMENT_KEY = "cumea.mobile.enrollment.v1";
const ONBOARDING_KEY = "cumea.mobile.onboarding.v1";

export async function readEnrollment(): Promise<Enrollment | null> {
  const raw = await SecureStore.getItemAsync(ENROLLMENT_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Enrollment;
    if (value.mode === "demo") return value;
    if (
      value.mode === "host" &&
      typeof value.hostUrl === "string" &&
      typeof value.deviceId === "string" &&
      typeof value.token === "string"
    ) return value;
    return null;
  } catch {
    return null;
  }
}

export async function writeEnrollment(value: Enrollment): Promise<void> {
  await SecureStore.setItemAsync(ENROLLMENT_KEY, JSON.stringify(value), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function clearEnrollment(): Promise<void> {
  await SecureStore.deleteItemAsync(ENROLLMENT_KEY);
}

export async function onboardingComplete(): Promise<boolean> {
  return (await SecureStore.getItemAsync(ONBOARDING_KEY)) === "done";
}

export async function markOnboardingComplete(): Promise<void> {
  await SecureStore.setItemAsync(ONBOARDING_KEY, "done");
}
