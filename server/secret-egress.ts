import type { AppConfig } from "./config.ts";

const REDACTED = "[REDACTED]";
const MIN_EXACT_LENGTH = 8;
const MAX_SECRET_LENGTH = 4_096;
const MAX_CATALOG_ENTRIES = 128;
const MAX_CATALOG_BYTES = 64 * 1024;
const MAX_VALUE_DEPTH = 8;
const MAX_COLLECTION_ENTRIES = 512;

const SENSITIVE_ENV_KEY = /(?:^|_)(?:API_?KEY|AUTH|BEARER|COOKIE|CREDENTIAL|PASSWORD|PRIVATE_?KEY|SECRET|SESSION|TOKEN)(?:$|_)/i;

// These patterns intentionally require credential-specific syntax and useful
// entropy. Generic long words/base64 are not credentials and stay readable.
const HIGH_CONFIDENCE_PATTERNS: readonly RegExp[] = [
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/-]{16,}={0,2}(?=$|[^A-Za-z0-9._~+\/-])/gi,
  /\b(?:xai-|sk-|ck_|ak_|gh[pousr]_|github_pat_|cumea_device_)[A-Za-z0-9._~-]{12,}\b/g,
  /\b(?:ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,200}\]/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
];

function eligibleSecret(value: unknown): value is string {
  return typeof value === "string" && value.length >= MIN_EXACT_LENGTH && value.length <= MAX_SECRET_LENGTH && !/^\s+$/.test(value);
}

/** Extract only explicitly credential-bearing configuration fields. */
export function configSecretValues(config: AppConfig): string[] {
  const values: unknown[] = [config.xai?.key, config.composio?.key, config.composio?.apiKey, config.box?.token];
  for (const instance of Object.values(config.instances ?? {})) {
    for (const [key, value] of Object.entries(instance.environment ?? {})) {
      if (SENSITIVE_ENV_KEY.test(key)) values.push(value);
    }
  }
  return values.filter(eligibleSecret);
}

export function sensitiveEnvironmentValues(environment: Record<string, string> | undefined): string[] {
  if (!environment) return [];
  return Object.entries(environment)
    .filter(([key]) => SENSITIVE_ENV_KEY.test(key))
    .map(([, value]) => value)
    .filter(eligibleSecret);
}

/**
 * Atomic, bounded snapshot of known credentials used at all egress boundaries.
 * Values are never hashed: a digest of a weak secret would itself be a useful
 * offline oracle. Callers replace the snapshot after every credential change.
 */
export class SecretCatalog {
  private snapshot: readonly string[] = [];
  private exactPattern: RegExp | null = null;
  private saturated = false;

  replace(sources: Iterable<string | null | undefined>): void {
    const unique = new Set<string>();
    let bytes = 0;
    let saturated = false;
    for (const value of sources) {
      if (!eligibleSecret(value)) continue;
      if (unique.has(value)) continue;
      const valueBytes = Buffer.byteLength(value, "utf8");
      if (bytes + valueBytes > MAX_CATALOG_BYTES || unique.size >= MAX_CATALOG_ENTRIES) {
        saturated = true;
        continue;
      }
      unique.add(value);
      bytes += valueBytes;
    }
    this.snapshot = Object.freeze([...unique].sort((a, b) => b.length - a.length));
    const variants = this.snapshot.flatMap((secret) => [
      secret,
      encodeURIComponent(secret),
      Buffer.from(secret, "utf8").toString("base64"),
    ]).filter((value, index, all) => all.indexOf(value) === index)
      .sort((a, b) => b.length - a.length)
      .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    this.exactPattern = variants.length ? new RegExp(variants.join("|"), "g") : null;
    this.saturated = saturated;
  }

  get size(): number {
    return this.snapshot.length;
  }

  redactText(input: string): string {
    if (!input) return input;
    if (this.saturated) return "[content withheld: secret catalog capacity exceeded]";
    let output = input.replace(/\u001b\[[0-?]*[ -\/]*[@-~]/g, "");
    if (this.exactPattern) output = output.replace(this.exactPattern, REDACTED);
    for (const pattern of HIGH_CONFIDENCE_PATTERNS) output = output.replace(pattern, REDACTED);
    return output;
  }

  redactValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
    if (typeof value === "string") return this.redactText(value);
    if (value === null || typeof value !== "object") return value;
    if (depth >= MAX_VALUE_DEPTH || seen.has(value)) return "[omitted]";
    seen.add(value);
    if (Array.isArray(value)) {
      return value.slice(0, MAX_COLLECTION_ENTRIES).map((item) => this.redactValue(item, depth + 1, seen));
    }
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value).slice(0, MAX_COLLECTION_ENTRIES)) {
      // Runtime adapter payloads are diagnostic-only and can contain arbitrary
      // provider request/response objects. They are never a public contract.
      if (key === "raw" || key === "cause") continue;
      output[key] = this.redactValue(item, depth + 1, seen);
    }
    return output;
  }

  safeError(error: unknown, fallback = "The operation failed."): string {
    const message = error instanceof Error ? error.message : typeof error === "string" ? error : fallback;
    const safe = this.redactText(message).trim();
    return safe || fallback;
  }

  /** Final provider boundary. Integration credentials remain untouched because
   * their adapter is the only intended destination; all prompt-bearing fields
   * are rebuilt from redacted strings immediately before dispatch. */
  redactProviderInput<T extends {
    text: string;
    system?: string;
    transcript?: Array<{ text: string } & Record<string, unknown>>;
  }>(input: T): T {
    return {
      ...input,
      text: this.redactText(input.text),
      ...(input.system === undefined ? {} : { system: this.redactText(input.system) }),
      ...(input.transcript === undefined ? {} : {
        transcript: input.transcript.map((message) => ({ ...message, text: this.redactText(message.text) })),
      }),
    } as T;
  }
}
