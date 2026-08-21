const EXPO_PUSH_SEND_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_PUSH_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
const MAX_BATCH = 100;

export interface PushTarget {
  deviceId: string;
  token: string;
}

export interface MinimalPushPayload {
  title: string;
  body: string;
  data: { kind: "completed" | "needs_attention"; botId: string };
}

export interface PushSendResult {
  staleTokens: string[];
  receipts: Array<{ id: string; token: string }>;
}

function headers(accessToken?: string): Record<string, string> {
  return {
    accept: "application/json",
    "content-type": "application/json",
    ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
  };
}

export async function sendExpoPush(
  targets: PushTarget[],
  payload: MinimalPushPayload,
  options: { fetcher?: typeof fetch; accessToken?: string } = {},
): Promise<PushSendResult> {
  const fetcher = options.fetcher ?? fetch;
  const result: PushSendResult = { staleTokens: [], receipts: [] };
  for (let offset = 0; offset < targets.length; offset += MAX_BATCH) {
    const batch = targets.slice(offset, offset + MAX_BATCH);
    const response = await fetcher(EXPO_PUSH_SEND_URL, {
      method: "POST",
      headers: headers(options.accessToken),
      body: JSON.stringify(batch.map((target) => ({
        to: target.token,
        title: payload.title.slice(0, 80),
        body: payload.body.slice(0, 160),
        data: payload.data,
        sound: "default",
        priority: "high",
      }))),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Expo push HTTP ${response.status}`);
    const body = await response.json().catch(() => null) as { data?: unknown } | null;
    const tickets = Array.isArray(body?.data) ? body.data : [];
    for (let index = 0; index < batch.length; index += 1) {
      const ticket = tickets[index] as { status?: unknown; id?: unknown; details?: { error?: unknown } } | undefined;
      if (ticket?.details?.error === "DeviceNotRegistered") result.staleTokens.push(batch[index].token);
      if (ticket?.status === "ok" && typeof ticket.id === "string") {
        result.receipts.push({ id: ticket.id, token: batch[index].token });
      }
    }
  }
  return result;
}

export async function checkExpoPushReceipts(
  receipts: Array<{ id: string; token: string }>,
  options: { fetcher?: typeof fetch; accessToken?: string } = {},
): Promise<string[]> {
  if (!receipts.length) return [];
  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher(EXPO_PUSH_RECEIPTS_URL, {
    method: "POST",
    headers: headers(options.accessToken),
    body: JSON.stringify({ ids: receipts.map((receipt) => receipt.id) }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Expo push receipt HTTP ${response.status}`);
  const body = await response.json().catch(() => null) as { data?: Record<string, unknown> } | null;
  const data = body?.data && typeof body.data === "object" ? body.data : {};
  return receipts.flatMap((receipt) => {
    const value = data[receipt.id] as { details?: { error?: unknown } } | undefined;
    return value?.details?.error === "DeviceNotRegistered" ? [receipt.token] : [];
  });
}

export function scheduleExpoPushReceiptCheck(
  receipts: Array<{ id: string; token: string }>,
  onStaleToken: (token: string) => void,
  options: { accessToken?: string; delayMs?: number } = {},
): void {
  if (!receipts.length) return;
  const timer = setTimeout(() => {
    void checkExpoPushReceipts(receipts, { accessToken: options.accessToken })
      .then((tokens) => tokens.forEach(onStaleToken))
      .catch(() => {});
  }, options.delayMs ?? 15 * 60_000);
  timer.unref?.();
}
