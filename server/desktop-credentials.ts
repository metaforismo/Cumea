export const DESKTOP_CREDENTIAL_SECTIONS = [
  "xai",
  "composio",
  "composioApi",
  "box",
] as const;

export type DesktopCredentialSection = (typeof DESKTOP_CREDENTIAL_SECTIONS)[number];
export type DesktopCredentials = Partial<Record<DesktopCredentialSection, string>>;

const ENV_FIELDS: Record<DesktopCredentialSection, string> = {
  xai: "CUMEA_DESKTOP_XAI_KEY",
  composio: "CUMEA_DESKTOP_COMPOSIO_KEY",
  composioApi: "CUMEA_DESKTOP_COMPOSIO_API_KEY",
  box: "CUMEA_DESKTOP_BOX_TOKEN",
};

const MANAGED_ENV = "CUMEA_DESKTOP_CREDENTIALS_MANAGED";
const MAX_CREDENTIAL_LENGTH = 8_192;

export interface DesktopCredentialBootstrap {
  managed: boolean;
  credentials: DesktopCredentials;
}

export interface SecretConfigShape {
  xai?: { key?: string; url?: string };
  composio?: { key?: string; apiKey?: string; url?: string };
  box?: { token?: string };
}

function ownRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function isDesktopCredentialSection(value: unknown): value is DesktopCredentialSection {
  return typeof value === "string" &&
    (DESKTOP_CREDENTIAL_SECTIONS as readonly string[]).includes(value);
}

export function normalizeDesktopCredentialValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error("credential value must be text or null");
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_CREDENTIAL_LENGTH) throw new Error("credential value is too long");
  if (/[\u0000\r\n]/.test(trimmed)) throw new Error("credential value contains invalid characters");
  return trimmed;
}

export function applyDesktopCredential(
  current: DesktopCredentials,
  section: DesktopCredentialSection,
  value: unknown,
): DesktopCredentials {
  const normalized = normalizeDesktopCredentialValue(value);
  const next = { ...current };
  if (normalized === null) delete next[section];
  else next[section] = normalized;
  return next;
}

export function consumeDesktopCredentialEnvironment(
  environment: NodeJS.ProcessEnv,
): DesktopCredentialBootstrap {
  const managed = environment[MANAGED_ENV] === "1";
  const credentials: DesktopCredentials = {};

  if (managed) {
    for (const section of DESKTOP_CREDENTIAL_SECTIONS) {
      const normalized = normalizeDesktopCredentialValue(environment[ENV_FIELDS[section]]);
      if (normalized !== null) credentials[section] = normalized;
    }
  }

  // These values must never reach provider child processes through inherited
  // environment. The server keeps only the validated in-memory copy above.
  delete environment[MANAGED_ENV];
  for (const field of Object.values(ENV_FIELDS)) delete environment[field];

  return { managed, credentials };
}

export function overlayDesktopCredentials<T extends SecretConfigShape>(
  config: T,
  credentials: DesktopCredentials,
): T {
  const next = structuredClone(config);
  const xai = ownRecord(next.xai);
  const composio = ownRecord(next.composio);
  const box = ownRecord(next.box);

  if (credentials.xai) xai.key = credentials.xai;
  else delete xai.key;
  if (credentials.composio) composio.key = credentials.composio;
  else delete composio.key;
  if (credentials.composioApi) composio.apiKey = credentials.composioApi;
  else delete composio.apiKey;
  if (credentials.box) box.token = credentials.box;
  else delete box.token;

  next.xai = xai as T["xai"];
  next.composio = composio as T["composio"];
  next.box = box as T["box"];
  return next;
}

/** Remove only credential fields while preserving non-secret endpoint and
 * future section metadata. Used as a fail-safe before managed desktop config
 * is persisted to disk. */
export function stripCredentialFields<T extends SecretConfigShape>(config: T): T {
  const next = structuredClone(config);
  if (next.xai) delete next.xai.key;
  if (next.composio) {
    delete next.composio.key;
    delete next.composio.apiKey;
  }
  if (next.box) delete next.box.token;
  return next;
}
