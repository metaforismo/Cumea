import assert from "node:assert/strict";
import test from "node:test";
import {
  HANDOFF_FIELD_LIMITS,
  handoffStatusLabel,
  isHandoffTargetVisible,
  parseProjectedHandoff,
} from "./handoff.ts";

const projected = (overrides = {}) => ({
  fromBotId: "agent-from",
  fromName: "Research",
  toBotId: "agent-to",
  toName: "Writer",
  prompt: "Turn these findings into a brief.",
  status: "requested",
  ...overrides,
});

test("parseProjectedHandoff preserves only a complete server-projected handoff", () => {
  assert.deepEqual(parseProjectedHandoff(projected({ reply: "Draft ready.", privateProviderPayload: "never copy this" })), {
    fromAgentId: "agent-from",
    fromName: "Research",
    toAgentId: "agent-to",
    toName: "Writer",
    prompt: "Turn these findings into a brief.",
    status: "requested",
    result: "Draft ready.",
  });
  for (const field of ["fromBotId", "fromName", "toBotId", "toName", "prompt", "status"]) {
    assert.equal(parseProjectedHandoff(projected({ [field]: undefined })), undefined);
  }
  assert.equal(parseProjectedHandoff(undefined), undefined);
  assert.equal(parseProjectedHandoff(projected({ status: "running" })), undefined);
  assert.equal(parseProjectedHandoff(projected({ toBotId: "x".repeat(HANDOFF_FIELD_LIMITS.agentId + 1) })), undefined);
  assert.equal(parseProjectedHandoff(projected({ toBotId: "agent to" })), undefined);
});

test("parseProjectedHandoff strips controls and bounds long host content", () => {
  const handoff = parseProjectedHandoff(projected({
    fromName: "  Research\u0000\u0085\u202e\n Agent\u2066  ",
    prompt: `  ${"p".repeat(HANDOFF_FIELD_LIMITS.prompt + 20)}  `,
    reply: `result\u061c\u200e\u200f\u2028\u2029${"r".repeat(HANDOFF_FIELD_LIMITS.result + 20)}`,
  }));
  assert.ok(handoff);
  assert.equal(handoff.fromName, "Research Agent");
  assert.equal(handoff.prompt.length, HANDOFF_FIELD_LIMITS.prompt);
  assert.equal(handoff.result?.includes("\u061c"), false);
  assert.equal(handoff.result?.includes("\u200e"), false);
  assert.equal(Array.from(handoff.result ?? "").length, HANDOFF_FIELD_LIMITS.result);
});

test("parseProjectedHandoff truncates on Unicode code-point boundaries", () => {
  const handoff = parseProjectedHandoff(projected({
    prompt: `${"p".repeat(HANDOFF_FIELD_LIMITS.prompt - 1)}😀trailing`,
  }));
  assert.ok(handoff);
  assert.equal(Array.from(handoff.prompt).length, HANDOFF_FIELD_LIMITS.prompt);
  assert.equal(handoff.prompt.endsWith("😀"), true);
  assert.equal(handoff.prompt.includes("�"), false);
});

test("handoff presentation names every status without relying on color", () => {
  assert.equal(handoffStatusLabel("requested"), "Waiting for response");
  assert.equal(handoffStatusLabel("completed"), "Completed");
  assert.equal(handoffStatusLabel("failed"), "Failed");
});

test("handoff target is actionable only while the destination agent is visible", () => {
  const handoff = parseProjectedHandoff(projected());
  assert.ok(handoff);
  assert.equal(isHandoffTargetVisible(handoff, new Set(["agent-to"])), true);
  assert.equal(isHandoffTargetVisible(handoff, new Set(["agent-from"])), false);
  assert.equal(isHandoffTargetVisible(handoff, new Set()), false);
});
