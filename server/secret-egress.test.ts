import { describe, expect, it } from "vitest";
import { configSecretValues, SecretCatalog, sensitiveEnvironmentValues } from "./secret-egress.ts";

describe("SecretCatalog", () => {
  it("redacts exact configured credentials and high-confidence tokens without common-word false positives", () => {
    const catalog = new SecretCatalog();
    const sentinel = "provider-sentinel-8fT3qP0z";
    catalog.replace([sentinel, "short"]);

    expect(catalog.redactText(`failure reflected ${sentinel}`)).toBe("failure reflected [REDACTED]");
    expect(catalog.redactText("short ordinary model workspace")).toBe("short ordinary model workspace");
    expect(catalog.redactText("Bearer Abcdefghijklmnop123456")).toBe("[REDACTED]");
    expect(catalog.redactText("xai-not-enough")).toBe("xai-not-enough");
    expect(catalog.redactText("development workspace ordinary")).toBe("development workspace ordinary");
    catalog.replace(["aaaaaaaa"]);
    expect(catalog.redactText("known=aaaaaaaa")).toBe("known=[REDACTED]");
  });

  it("atomically drops revoked credentials on replacement", () => {
    const catalog = new SecretCatalog();
    catalog.replace(["old-secret-sentinel"]);
    expect(catalog.redactText("old-secret-sentinel")).toBe("[REDACTED]");
    catalog.replace(["new-secret-sentinel"]);
    expect(catalog.redactText("old-secret-sentinel")).toBe("old-secret-sentinel");
    expect(catalog.redactText("new-secret-sentinel")).toBe("[REDACTED]");
  });

  it("removes raw/cause payloads, handles cycles, and bounds adversarial text", () => {
    const catalog = new SecretCatalog();
    catalog.replace(["sentinel-secret-value"]);
    const cyclic: Record<string, unknown> = {
      message: "sentinel-secret-value",
      raw: { body: "sentinel-secret-value" },
      cause: new Error("sentinel-secret-value"),
    };
    cyclic.self = cyclic;
    const safe = catalog.redactValue(cyclic) as Record<string, unknown>;
    expect(safe).toEqual({ message: "[REDACTED]", self: "[omitted]" });
    expect(catalog.redactText("a".repeat(300_000))).toHaveLength(300_000);
  });

  it("redacts encoded variants without changing unrelated large content", () => {
    const catalog = new SecretCatalog();
    const secret = "credential+/sentinel-123";
    catalog.replace([secret]);
    expect(catalog.redactText(`url=${encodeURIComponent(secret)}`)).toBe("url=[REDACTED]");
    expect(catalog.redactText(`json=${JSON.stringify(secret)}`)).toBe('json="[REDACTED]"');
    expect(catalog.redactText(`base64=${Buffer.from(secret).toString("base64")}`)).toBe("base64=[REDACTED]");
    expect(catalog.redactText(`\u001b[31m${secret}\u001b[0m`)).toBe("[REDACTED]");
  });

  it("inventories only explicit secret config and sensitive environment keys", () => {
    expect(configSecretValues({
      xai: { key: "xai-secret-12345678", url: "https://example.test/model" },
      profile: { name: "ordinary-person", email: "person@example.test" },
      instances: {
        acp: { driver: "codex", environment: { API_TOKEN: "adapter-secret-123", MODEL: "model-public" } },
      },
    })).toEqual(["xai-secret-12345678", "adapter-secret-123"]);
    expect(sensitiveEnvironmentValues({ SESSION_SECRET: "session-secret-123", PATH: "/usr/bin" }))
      .toEqual(["session-secret-123"]);
  });

  it("returns safe bounded error messages without serializing causes", () => {
    const catalog = new SecretCatalog();
    catalog.replace(["provider-secret-123456"]);
    const error = new Error("upstream reflected provider-secret-123456", {
      cause: { body: "provider-secret-123456" },
    });
    expect(catalog.safeError(error)).toBe("upstream reflected [REDACTED]");
  });

  it("redacts every prompt-bearing provider field but preserves the explicit integration destination", () => {
    const catalog = new SecretCatalog();
    const secret = "configured-provider-secret-789";
    catalog.replace([secret]);
    const request = catalog.redactProviderInput({
      text: `user typed ${secret}`,
      system: `memory reflected ${secret}`,
      transcript: [
        { role: "user", text: `legacy turn ${secret}` },
        { role: "assistant", text: `assistant echo ${secret}` },
      ],
      integrations: { composio: { key: secret } },
    });
    expect(JSON.stringify({ text: request.text, system: request.system, transcript: request.transcript })).not.toContain(secret);
    expect(request.integrations.composio.key).toBe(secret);
  });
});
