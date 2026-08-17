import { describe, expect, it } from "vitest";

import {
  applyDesktopCredential,
  consumeDesktopCredentialEnvironment,
  hasCredentialFields,
  overlayDesktopCredentials,
  stripCredentialFields,
} from "./desktop-credentials.ts";

describe("desktop credential boundary", () => {
  it("consumes and deletes bootstrap secrets before providers can inherit them", () => {
    const environment: NodeJS.ProcessEnv = {
      PATH: "/bin",
      CUMEA_DESKTOP_CREDENTIALS_MANAGED: "1",
      CUMEA_DESKTOP_XAI_KEY: " xai-secret ",
      CUMEA_DESKTOP_COMPOSIO_KEY: "connect-secret",
      CUMEA_DESKTOP_COMPOSIO_API_KEY: "project-secret",
      CUMEA_DESKTOP_BOX_TOKEN: "box-secret",
    };

    const result = consumeDesktopCredentialEnvironment(environment);
    expect(result).toEqual({
      managed: true,
      credentials: {
        xai: "xai-secret",
        composio: "connect-secret",
        composioApi: "project-secret",
        box: "box-secret",
      },
    });
    expect(environment).toEqual({ PATH: "/bin" });
  });

  it("rejects malformed credential values", () => {
    expect(() => applyDesktopCredential({}, "box", "line\nbreak")).toThrow(
      /invalid characters/,
    );
  });

  it("detects every credential-shaped config patch, including clears", () => {
    expect(hasCredentialFields({ xai: { key: "secret" } })).toBe(true);
    expect(hasCredentialFields({ composio: { key: null } })).toBe(true);
    expect(hasCredentialFields({ composio: { apiKey: "" } })).toBe(true);
    expect(hasCredentialFields({ box: { token: undefined } })).toBe(true);
    expect(hasCredentialFields({ xai: { url: "https://example.test" } })).toBe(false);
    expect(hasCredentialFields({ profile: { name: "Francesco" } })).toBe(false);
  });

  it("applies replacement and clear operations without mutating the current state", () => {
    const current = { composio: "old", box: "box" };
    const replaced = applyDesktopCredential(current, "composio", "new");
    const cleared = applyDesktopCredential(replaced, "box", null);
    expect(current).toEqual({ composio: "old", box: "box" });
    expect(replaced).toEqual({ composio: "new", box: "box" });
    expect(cleared).toEqual({ composio: "new" });
  });

  it("overlays in-memory credentials and strips only secrets from disk shapes", () => {
    const base = {
      xai: { key: "plaintext", url: "https://x.example" },
      composio: {
        key: "plaintext-connect",
        apiKey: "plaintext-project",
        url: "https://c.example",
      },
      box: { token: "plaintext-box" },
      profile: { name: "Francesco" },
    };
    expect(
      overlayDesktopCredentials(stripCredentialFields(base), {
        xai: "secure-xai",
        composio: "secure-connect",
        composioApi: "secure-project",
        box: "secure-box",
      }),
    ).toEqual({
      xai: { key: "secure-xai", url: "https://x.example" },
      composio: {
        key: "secure-connect",
        apiKey: "secure-project",
        url: "https://c.example",
      },
      box: { token: "secure-box" },
      profile: { name: "Francesco" },
    });
    expect(stripCredentialFields(base)).toEqual({
      xai: { url: "https://x.example" },
      composio: { url: "https://c.example" },
      box: {},
      profile: { name: "Francesco" },
    });
  });
});
