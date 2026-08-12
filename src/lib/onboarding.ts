// First-run state is intentionally local. Cumea ships with no analytics or
// remote identity collection; this marker never leaves the user's device.
const DONE_KEY = "cumea-onboarding-done";

export function onboardingDone(): boolean {
  return Boolean(localStorage.getItem(DONE_KEY));
}

export function setOnboardingDone(): void {
  localStorage.setItem(DONE_KEY, new Date().toISOString());
}
