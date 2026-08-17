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
const GENERIC_CREDENTIAL_ENV_FIELDS = [
  "XAI_API_KEY",
  "BOX_TOKEN",
  "COMPOSIO_KEY",
  "COMPOSIO_API_KEY",
] as const;
const MANAGED_INSTANCE_ENV_FIELDS = new Set(
  [
    MANAGED_ENV,
    ...Object.values(ENV_FIELDS),
    ...GENERIC_CREDENTIAL_ENV_FIELDS,
  ].map((name) => name.toUpperCase()),
);
// Keep the complete managed bootstrap comfortably below Windows' aggregate
// process-environment limit even when the parent already has a large PATH.
const MAX_CREDENTIAL_LENGTH = 2_048;

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

/** Windows environment names are case-insensitive, but an env object passed
 * through JavaScript can contain differently-cased aliases. Consume and
 * delete every alias before another child process can inherit it. */
function takeEnvironmentValue(
  environment: NodeJS.ProcessEnv,
  expectedName: string,
): string | undefined {
  const expected = expectedName.toUpperCase();
  let selected: string | undefined;
  for (const name of Object.keys(environment)) {
    if (name.toUpperCase() !== expected) continue;
    if (selected === undefined) selected = environment[name];
    delete environment[name];
  }
  return selected;
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
  const managed = takeEnvironmentValue(environment, MANAGED_ENV) === "1";
  const credentials: DesktopCredentials = {};

  for (const section of DESKTOP_CREDENTIAL_SECTIONS) {
    const raw = takeEnvironmentValue(environment, ENV_FIELDS[section]);
    if (!managed) continue;
    const normalized = normalizeDesktopCredentialValue(raw);
    if (normalized !== null) credentials[section] = normalized;
  }

  if (managed) {
    // Electron removes the expected uppercase names before spawning the
    // harness. This second boundary also removes differently-cased aliases
    // and prevents generic ambient credentials from reaching provider children.
    for (const field of GENERIC_CREDENTIAL_ENV_FIELDS) {
      takeEnvironmentValue(environment, field);
    }
  }

  return { managed, credentials };
}

/** Credential-shaped fields sent to the ordinary config API are an invalid
 * transport in managed desktop mode, even when the value is null/empty. */
export function hasCredentialFields(value: unknown): boolean {
  const config = ownRecord(value);
  const xai = ownRecord(config.xai);
  const composio = ownRecord(config.composio);
  const box = ownRecord(config.box);
  return (
    Object.hasOwn(xai, "key") ||
    Object.hasOwn(composio, "key") ||
    Object.hasOwn(composio, "apiKey") ||
    Object.hasOwn(box, "token")
  );
}

/** Advanced instance environments remain available for non-secret settings,
 * but packaged managed mode ignores credential aliases from plaintext disk.
 * The OS vault is the only source allowed to populate those names. */
export function sanitizeManagedInstanceEnvironment(
  environment: Record<string, string> | undefined,
): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [name, value] of Object.entries(environment ?? {})) {
    if (!MANAGED_INSTANCE_ENV_FIELDS.has(name.toUpperCase())) sanitized[name] = value;
  }
  return sanitized;
}

/** Process environments receive only credentials owned by their driver.
 * Composio credentials use a separate, explicitly capability-gated MCP
 * integration rather than this generic provider environment path. */
export function providerCredentialEnvironment(
  driverKind: string,
  credentials: Pick<DesktopCredentials, "xai" | "box">,
): Record<string, string> {
  if (driverKind === "grok" && credentials.xai) {
    return { XAI_API_KEY: credentials.xai };
  }
  if (driverKind === "boxAgent" && credentials.box) {
    return { BOX_TOKEN: credentials.box };
  }
  return {};
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
