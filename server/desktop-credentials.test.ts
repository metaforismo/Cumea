import { describe, expect, it } from "vitest";

import {
  applyDesktopCredential,
  consumeDesktopCredentialEnvironment,
  hasCredentialFields,
  overlayDesktopCredentials,
  providerCredentialEnvironment,
  sanitizeManagedInstanceEnvironment,
  stripCredentialFields,
} from "./desktop-credentials.ts";

describe("desktop credential boundary", () => {
  it("consumes and deletes bootstrap and ambient aliases before providers load", () => {
    const environment: NodeJS.ProcessEnv = {
      PATH: "/bin",
      cumea_desktop_credentials_managed: "1",
      Cumea_Desktop_Xai_Key: " xai-secret ",
      cumea_desktop_composio_key: "connect-secret",
      CUMEA_DESKTOP_COMPOSIO_API_KEY: "project-secret",
      Cumea_Desktop_Box_Token: "box-secret",
      xai_api_key: "ambient-xai",
      Box_Token: "ambient-box",
      composio_key: "ambient-connect",
      Composio_Api_Key: "ambient-project",
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

  it("rejects malformed and oversized credential values", () => {
    expect(() => applyDesktopCredential({}, "box", "line\nbreak")).toThrow(
      /invalid characters/,
    );
    expect(applyDesktopCredential({}, "box", "x".repeat(2_048)).box).toHaveLength(2_048);
    expect(() => applyDesktopCredential({}, "box", "x".repeat(2_049))).toThrow(
      /credential value is too long/,
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

  it("removes credential aliases from plaintext managed instance environments", () => {
    expect(
      sanitizeManagedInstanceEnvironment({
        PATH: "/custom/bin",
        FEATURE_FLAG: "1",
        xai_api_key: "plaintext-xai",
        Box_Token: "plaintext-box",
        COMPOSIO_KEY: "plaintext-connect",
        composio_api_key: "plaintext-project",
        Cumea_Desktop_Xai_Key: "bootstrap-xai",
        cumea_desktop_credentials_managed: "1",
      }),
    ).toEqual({ PATH: "/custom/bin", FEATURE_FLAG: "1" });
  });

  it("mounts credentials only into the owning provider driver", () => {
    const credentials = { xai: "xai-secret", box: "box-secret" };
    expect(providerCredentialEnvironment("grok", credentials)).toEqual({
      XAI_API_KEY: "xai-secret",
    });
    expect(providerCredentialEnvironment("boxAgent", credentials)).toEqual({
      BOX_TOKEN: "box-secret",
    });
    for (const driver of ["grokAgent", "geminiAgent", "claudeAgent", "codex", "fake"]) {
      expect(providerCredentialEnvironment(driver, credentials)).toEqual({});
    }
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
