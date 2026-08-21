import { describe, expect, it } from "vitest";

import { minimalProviderEnvironment, stripManagedCredentials } from "./provider-environment.ts";

describe("provider child environments", () => {
  it("keeps only host discovery, locale, Windows and TLS variables for minimal CLIs", () => {
    const output = minimalProviderEnvironment({
      PATH: "/bin",
      home: "/Users/example",
      TMPDIR: "/tmp/example",
      LANG: "en_US.UTF-8",
      LC_MESSAGES: "en_US.UTF-8",
      XDG_CONFIG_HOME: "/config",
      SystemRoot: "C:\\Windows",
      AppData: "C:\\Users\\example\\AppData\\Roaming",
      SSL_CERT_FILE: "/etc/certs.pem",
      NODE_EXTRA_CA_CERTS: "/etc/company.pem",
      HTTP_PROXY: "https://name:password@proxy.example",
      XDG_RUNTIME_DIR: "/run/user/501",
      SSH_AUTH_SOCK: "/tmp/agent.sock",
      BOX_TOKEN: "box-secret",
      COMPOSIO_KEY: "connect-secret",
      xai_api_key: "xai-secret",
      CUSTOM_SECRET: "custom-secret",
      CUMEA_MEMORY_CAPABILITY: "capability",
    });

    expect(output).toMatchObject({
      PATH: "/bin",
      HOME: "/Users/example",
      TMPDIR: "/tmp/example",
      LANG: "en_US.UTF-8",
      LC_MESSAGES: "en_US.UTF-8",
      XDG_CONFIG_HOME: "/config",
      SYSTEMROOT: "C:\\Windows",
      APPDATA: "C:\\Users\\example\\AppData\\Roaming",
      SSL_CERT_FILE: "/etc/certs.pem",
      NODE_EXTRA_CA_CERTS: "/etc/company.pem",
    });
    expect(output).not.toHaveProperty("HTTP_PROXY");
    expect(output).not.toHaveProperty("XDG_RUNTIME_DIR");
    expect(output).not.toHaveProperty("SSH_AUTH_SOCK");
    expect(output).not.toHaveProperty("BOX_TOKEN");
    expect(output).not.toHaveProperty("COMPOSIO_KEY");
    expect(output).not.toHaveProperty("xai_api_key");
    expect(output).not.toHaveProperty("CUSTOM_SECRET");
    expect(output).not.toHaveProperty("CUMEA_MEMORY_CAPABILITY");
  });

  it("strips managed credentials case-insensitively and preserves only an explicit owner", () => {
    const environment = {
      box_token: "box-secret",
      XAI_API_KEY: "xai-secret",
      COMPOSIO_API_KEY: "composio-secret",
      COMPOSIO_KEY: "connect-secret",
      EXPO_ACCESS_TOKEN: "expo-secret",
      cumea_memory_capability: "memory-capability",
      CUMEA_PERMISSION_BROKER_SECRET: "broker-secret",
      HOME: "/home/example",
    };
    stripManagedCredentials(environment, ["BOX_TOKEN"]);
    expect(environment).toEqual({ box_token: "box-secret", HOME: "/home/example" });
  });
});
