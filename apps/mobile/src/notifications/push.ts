import { Platform } from "react-native";
import Constants from "expo-constants";
import { fetch as expoFetch } from "expo/fetch";
import * as Notifications from "expo-notifications";
import type { Enrollment } from "@/host/types";

export type PushRegistrationState = "enabled" | "disabled" | "denied" | "unavailable";

function hostEnrollment(enrollment: Enrollment | null): Extract<Enrollment, { mode: "host" }> | null {
  return enrollment?.mode === "host" ? enrollment : null;
}

function projectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined;
  const value = Constants.easConfig?.projectId ?? extra?.eas?.projectId ?? process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function hostRequest(
  enrollment: Extract<Enrollment, { mode: "host" }>,
  method: "GET" | "POST" | "DELETE",
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await expoFetch(`${enrollment.hostUrl}/api/mobile/push-token`, {
    method,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${enrollment.token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(payload.error ?? `Push registration failed (${response.status}).`));
  return payload;
}

async function expoToken(): Promise<string> {
  const id = projectId();
  if (!id) throw new Error("Push notifications require an EAS project ID in this build.");
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("agent-updates", {
      name: "Agent updates",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 180],
      lightColor: "#19AE7A",
    });
  }
  return (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;
}

export async function pushRegistrationState(enrollment: Enrollment | null): Promise<PushRegistrationState> {
  const host = hostEnrollment(enrollment);
  if (!host || (Platform.OS !== "ios" && Platform.OS !== "android")) return "unavailable";
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain === false) return "denied";
  const remote = await hostRequest(host, "GET");
  return remote.enabled === true ? "enabled" : "disabled";
}

export async function enablePushNotifications(enrollment: Enrollment | null): Promise<PushRegistrationState> {
  const host = hostEnrollment(enrollment);
  if (!host || (Platform.OS !== "ios" && Platform.OS !== "android")) return "unavailable";
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain !== false) {
    permission = await Notifications.requestPermissionsAsync();
  }
  if (!permission.granted) return permission.canAskAgain === false ? "denied" : "disabled";
  const token = await expoToken();
  await hostRequest(host, "POST", { token, platform: Platform.OS });
  return "enabled";
}

/** Re-register a rotated Expo token only after the user has already granted
 * OS permission. This function never prompts. */
export async function syncPushRegistration(enrollment: Enrollment | null): Promise<void> {
  const host = hostEnrollment(enrollment);
  if (!host || (Platform.OS !== "ios" && Platform.OS !== "android")) return;
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return;
  const token = await expoToken();
  await hostRequest(host, "POST", { token, platform: Platform.OS });
}

export async function disablePushNotifications(enrollment: Enrollment | null): Promise<void> {
  const host = hostEnrollment(enrollment);
  if (!host) return;
  await hostRequest(host, "DELETE");
}

export function configurePushPresentation(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

export function notificationBotId(response: Notifications.NotificationResponse | null): string | null {
  const value = response?.notification.request.content.data?.botId;
  return typeof value === "string" && /^[\w-]{1,100}$/.test(value) ? value : null;
}

export { Notifications };
