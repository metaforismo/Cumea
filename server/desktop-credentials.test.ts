import { describe, expect, it } from "vitest";

import {
  applyDesktopCredential,
  consumeDesktopCredentialEnvironment,
  overlayDesktopCredentials,
  stripCredentialFields,
} from "./desktop-credentials.ts";

describe("desktop credential boundary", () => {
  it("consumes and deletes per-boot secrets before providers can inherit them", () => {
    const environment: NodeJS.ProcessEnv = {
      PATH: "/bin",
      CUMEA_DESKTOP_CREDENTIALS_MANAGED: "1",
      CUMEA_DESKTOP_CREDENTIAL_TOKEN: "a".repeat(64),
      CUMEA_DESKTOP_XAI_KEY: " xai-secret ",
      CUMEA_DESKTOP_COMPOSIO_KEY: "connect-secret",
      CUMEA_DESKTOP_COMPOSIO_API_KEY: "project-secret",
      CUMEA_DESKTOP_BOX_TOKEN: "box-secret",
    };

    const result = consumeDesktopCredentialEnvironment(environment);
    expect(result).toEqual({
      managed: true,
      token: "a".repeat(64),
      credentials: {
        xai: "xai-secret",
        composio: "connect-secret",
        composioApi: "project-secret",
        box: "box-secret",
      },
    });
    expect(environment).toEqual({ PATH: "/bin" });
  });

  it("rejects malformed managed bootstrap tokens and credential values", () => {
    expect(() =>
      consumeDesktopCredentialEnvironment({
        CUMEA_DESKTOP_CREDENTIALS_MANAGED: "1",
        CUMEA_DESKTOP_CREDENTIAL_TOKEN: "short",
      }),
    ).toThrow(/per-boot token/);
    expect(() => applyDesktopCredential({}, "box", "line\nbreak")).toThrow(
      /invalid characters/,
    );
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
