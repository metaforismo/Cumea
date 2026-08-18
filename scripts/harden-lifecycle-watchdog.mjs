import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(path, needle, replacement, label) {
  const source = readFileSync(path, "utf8");
  const first = source.indexOf(needle);
  if (first < 0 || first !== source.lastIndexOf(needle)) throw new Error(`${label}: expected one match`);
  writeFileSync(path, source.slice(0, first) + replacement + source.slice(first + needle.length));
}

replaceOnce(
  "server/index.ts",
  '  const { projections, alerts } = lifecycleWatchdog.tick();\n  let changed = false;\n  for (const value of projections) changed = workspace.setRunLifecycle(value.runId, value) || changed;\n  for (const alert of alerts) changed = workspace.markLifecycleAttention(alert.runId, alert) || changed;',
  '  const { projections, alerts } = lifecycleWatchdog.tick();\n  let changed = false;\n  for (const value of projections) {\n    const current = workspace.run(value.runId)?.lifecycle;\n    const semanticChange =\n      !current ||\n      current.state !== value.state ||\n      current.waitingSince !== value.waitingSince ||\n      current.reason !== value.reason;\n    if (semanticChange) changed = workspace.setRunLifecycle(value.runId, value) || changed;\n  }\n  for (const alert of alerts) changed = workspace.markLifecycleAttention(alert.runId, alert) || changed;',
  "semantic-only timer persistence",
);
replaceOnce(
  "src/components/WorkPanel.tsx",
  '              <span className="text-ink-secondary">Last signal {relativeTime(run.lifecycle.lastActivityAt)}</span>\n              {run.lifecycle.reason ?',
  '              <span className="text-ink-secondary">\n                {run.lifecycle.state === "working"\n                  ? "Runtime active"\n                  : run.lifecycle.state === "waiting" && run.lifecycle.waitingSince\n                    ? `Waiting ${relativeTime(run.lifecycle.waitingSince)}`\n                    : `Last signal ${relativeTime(run.lifecycle.lastActivityAt)}`}\n              </span>\n              {run.lifecycle.reason ?',
  "truthful lifecycle timestamp label",
);

replaceOnce(
  "server/workspace.test.ts",
  '  it("enforces persistent attachment count and byte quotas per bot", () => {',
  `  it("keeps provider attention separate from watchdog recovery state", () => {
    const store = new WorkspaceStore();
    const task = store.createTask({ botId: "bot-1", prompt: "Long task" });
    const run = store.createRun(task.id);
    store.setRunLifecycle(run.id, {
      threadId: "thread-1",
      runId: run.id,
      state: "no_signal",
      lastActivityAt: 1_000,
    });
    store.markLifecycleAttention(run.id, {
      threadId: "thread-1",
      runId: run.id,
      kind: "no_signal",
      title: "No signal",
      observedAt: 2_000,
    });
    expect(store.run(run.id)).toMatchObject({ status: "needs_attention", attentionKind: "lifecycle" });

    store.markNeedsAttention(run.id, "Approve send?", "request-1");
    expect(store.run(run.id)).toMatchObject({ status: "needs_attention", attentionKind: "provider" });
    expect(store.run(run.id)?.lifecycleAlert).toBeUndefined();

    store.setRunLifecycle(run.id, {
      threadId: "thread-1",
      runId: run.id,
      state: "working",
      lastActivityAt: 3_000,
    });
    expect(store.run(run.id)).toMatchObject({ status: "needs_attention", attentionKind: "provider" });
    store.resumeRun(run.id, "request-1", false);
    expect(store.run(run.id)).toMatchObject({ status: "running", attentionKind: undefined });
  });

  it("auto-clears recovered silence alerts but keeps repeated-effect alerts visible", () => {
    const store = new WorkspaceStore();
    const firstTask = store.createTask({ botId: "bot-1", prompt: "Silent task" });
    const firstRun = store.createRun(firstTask.id);
    store.markLifecycleAttention(firstRun.id, {
      threadId: "thread-1", runId: firstRun.id, kind: "dead", title: "No runtime signal", observedAt: 1_000,
    });
    store.setRunLifecycle(firstRun.id, {
      threadId: "thread-1", runId: firstRun.id, state: "working", lastActivityAt: 2_000,
    });
    expect(store.run(firstRun.id)).toMatchObject({ status: "running", attentionKind: undefined });
    expect(store.run(firstRun.id)?.steps.at(-1)).toMatchObject({ kind: "lifecycle", status: "completed" });

    const secondTask = store.createTask({ botId: "bot-1", prompt: "Loop task" });
    const secondRun = store.createRun(secondTask.id);
    store.markLifecycleAttention(secondRun.id, {
      threadId: "thread-2", runId: secondRun.id, kind: "repeated_effect", title: "Repeated action", observedAt: 3_000, repeatCount: 6,
    });
    store.setRunLifecycle(secondRun.id, {
      threadId: "thread-2", runId: secondRun.id, state: "working", lastActivityAt: 4_000,
    });
    expect(store.run(secondRun.id)).toMatchObject({ status: "needs_attention", attentionKind: "lifecycle" });
    expect(store.run(secondRun.id)?.lifecycleAlert?.kind).toBe("repeated_effect");
  });

  it("enforces persistent attachment count and byte quotas per bot", () => {`,
  "workspace lifecycle ownership tests",
);
