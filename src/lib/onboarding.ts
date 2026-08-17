// First-run state is intentionally local. Cumea ships with no analytics or
// remote identity collection; this marker never leaves the user's device.
const DONE_KEY = "cumea-onboarding-done";

export function onboardingDone(): boolean {
  const scenario = window.cumea?.performanceScenario;
  // Benchmark overrides exist only when the Electron process also has an
  // explicit local performance-report path. A first-run sample must stay a
  // first run even if a caller accidentally reuses its profile directory.
  if (scenario?.profile === "first-run") return false;
  if (scenario?.seedOnboarding) {
    if (!localStorage.getItem(DONE_KEY)) localStorage.setItem(DONE_KEY, new Date(0).toISOString());
    return true;
  }
  return Boolean(localStorage.getItem(DONE_KEY));
}

export function setOnboardingDone(): void {
  localStorage.setItem(DONE_KEY, new Date().toISOString());
}
