import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(text, needle, replacement, label) {
  const first = text.indexOf(needle);
  if (first < 0 || first !== text.lastIndexOf(needle)) throw new Error(`${label}: expected one match`);
  return `${text.slice(0, first)}${replacement}${text.slice(first + needle.length)}`;
}

{
  const file = "src/lib/startup-api.ts";
  let text = readFileSync(file, "utf8");
  text = replaceOnce(
    text,
    `const RETRYABLE_GATEWAY_STATES = new Map([\n  ["starting", "agent host is starting"],\n  ["restarting", "agent host is restarting"],\n]);\n`,
    `const RETRYABLE_GATEWAY_STATES = new Map([\n  ["starting", "agent host is starting"],\n  ["restarting", "agent host is restarting"],\n]);\nconst RETRYABLE_METHODS = new Set(["GET", "HEAD", "PUT"]);\n`,
    "retryable method set",
  );
  text = replaceOnce(
    text,
    `  const fetchImpl = options.fetchImpl ?? fetch;\n  const now = options.now ?? (() => performance.now());`,
    `  const method = String(init.method ?? "GET").toUpperCase();\n  const fetchImpl = options.fetchImpl ?? fetch;\n  const now = options.now ?? (() => performance.now());`,
    "request method normalization",
  );
  text = replaceOnce(
    text,
    `      response.status === 503 &&\n      gatewayState !== null &&\n      RETRYABLE_GATEWAY_STATES.get(gatewayState) === message;`,
    `      RETRYABLE_METHODS.has(method) &&\n      response.status === 503 &&\n      gatewayState !== null &&\n      RETRYABLE_GATEWAY_STATES.get(gatewayState) === message;`,
    "method-gated retry",
  );
  writeFileSync(file, text);
}

{
  const file = "src/lib/startup-api.test.ts";
  let text = readFileSync(file, "utf8");
  const marker = `  it("does not retry the terminal harness failure state", async () => {`;
  const insert = `  it("never retries a signed non-idempotent POST", async () => {\n    let calls = 0;\n    await expect(\n      startupApi(\n        "/api/create",\n        { method: "POST" },\n        {\n          fetchImpl: async () => {\n            calls += 1;\n            return jsonResponse(\n              503,\n              { error: "agent host is starting" },\n              { "x-cumea-desktop-state": "starting" },\n            );\n          },\n          sleepImpl: async () => {\n            throw new Error("must not sleep");\n          },\n        },\n      ),\n    ).rejects.toThrow("agent host is starting");\n    expect(calls).toBe(1);\n  });\n\n`;
  text = replaceOnce(text, marker, `${insert}${marker}`, "POST non-retry test");
  writeFileSync(file, text);
}
