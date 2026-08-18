import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(path, needle, replacement, label) {
  const source = readFileSync(path, "utf8");
  const first = source.indexOf(needle);
  if (first < 0 || first !== source.lastIndexOf(needle)) throw new Error(`${label}: expected one match`);
  writeFileSync(path, source.slice(0, first) + replacement + source.slice(first + needle.length));
}

// ── durable Work model ─────────────────────────────────────────────────
replaceOnce(
  "server/workspace.ts",
  'import { newId } from "./contracts.ts";\n',
  'import { newId } from "./contracts.ts";\nimport type { RunLifecycleAlert, RunLifecycleProjection } from "./lifecycle-watchdog.ts";\n',
  "workspace lifecycle import",
);
replaceOnce(
  "server/workspace.ts",
  'export type StepStatus = "running" | "needs_attention" | "completed" | "failed" | "denied";\n',
  'export type StepStatus = "running" | "needs_attention" | "completed" | "failed" | "denied";\nexport type RunAttentionKind = "provider" | "lifecycle";\n',
  "attention kind type",
);
replaceOnce(
  "server/workspace.ts",
  '  kind: "tool" | "approval" | "handoff";\n',
  '  kind: "tool" | "approval" | "handoff" | "lifecycle";\n',
  "lifecycle step kind",
);
replaceOnce(
  "server/workspace.ts",
  '  status: RunStatus;\n  steps: RunStep[];\n  artifacts: RunArtifact[];\n  startedAt: number;\n  completedAt?: number;\n  error?: string;\n}',
  '  status: RunStatus;\n  steps: RunStep[];\n  artifacts: RunArtifact[];\n  startedAt: number;\n  completedAt?: number;\n  error?: string;\n  attentionKind?: RunAttentionKind;\n  lifecycle?: Omit<RunLifecycleProjection, "threadId" | "runId">;\n  lifecycleAlert?: Omit<RunLifecycleAlert, "threadId" | "runId">;\n}',
  "RunRecord lifecycle fields",
);

const lifecycleMethods = `
  setRunLifecycle(runId: string, projection: RunLifecycleProjection): boolean {
    const run = this.run(runId);
    if (!run || run.completedAt !== undefined || projection.runId !== runId) return false;
    const next = {
      state: projection.state,
      lastActivityAt: projection.lastActivityAt,
      ...(projection.waitingSince !== undefined ? { waitingSince: projection.waitingSince } : {}),
      ...(projection.reason ? { reason: projection.reason } : {}),
      ...(projection.repeatCount !== undefined ? { repeatCount: projection.repeatCount } : {}),
    };
    const previous = run.lifecycle;
    const lifecycleChanged = JSON.stringify(previous ?? null) !== JSON.stringify(next);
    if (lifecycleChanged) run.lifecycle = next;

    let attentionChanged = false;
    if (
      run.attentionKind === "lifecycle" &&
      run.lifecycleAlert?.kind !== "repeated_effect" &&
      (projection.state === "working" || projection.state === "waiting")
    ) {
      const step = [...run.steps].reverse().find((candidate) => candidate.kind === "lifecycle" && candidate.status === "needs_attention");
      if (step) {
        step.status = "completed";
        step.completedAt = Date.now();
      }
      run.attentionKind = undefined;
      run.lifecycleAlert = undefined;
      if (run.status === "needs_attention") run.status = "running";
      const task = this.data.tasks.find((candidate) => candidate.id === run.taskId);
      if (task?.status === "needs_attention") {
        task.status = "running";
        task.updatedAt = Date.now();
      }
      attentionChanged = true;
    }
    if (lifecycleChanged || attentionChanged) this.save();
    return lifecycleChanged || attentionChanged;
  }

  markLifecycleAttention(runId: string, alert: RunLifecycleAlert): boolean {
    const run = this.run(runId);
    if (!run || run.completedAt !== undefined || alert.runId !== runId) return false;
    // A real provider ask owns attention while it is unresolved. The watchdog
    // is advisory and must never replace an approval/question boundary.
    if (run.attentionKind === "provider") return false;
    if (
      run.attentionKind === "lifecycle" &&
      run.lifecycleAlert?.kind === alert.kind &&
      run.lifecycleAlert.title === alert.title
    ) return false;

    if (run.attentionKind === "lifecycle") {
      const prior = [...run.steps].reverse().find((candidate) => candidate.kind === "lifecycle" && candidate.status === "needs_attention");
      if (prior) {
        prior.status = "completed";
        prior.completedAt = Date.now();
      }
    }
    run.attentionKind = "lifecycle";
    run.lifecycleAlert = {
      kind: alert.kind,
      title: alert.title,
      observedAt: alert.observedAt,
      ...(alert.signature ? { signature: alert.signature } : {}),
      ...(alert.repeatCount !== undefined ? { repeatCount: alert.repeatCount } : {}),
    };
    run.status = "needs_attention";
    const task = this.data.tasks.find((candidate) => candidate.id === run.taskId);
    if (task) {
      task.status = "needs_attention";
      task.updatedAt = Date.now();
    }
    run.steps.push({
      id: newId(),
      itemId: \`lifecycle:\${alert.kind}:\${alert.observedAt}\`,
      kind: "lifecycle",
      title: alert.title,
      status: "needs_attention",
      startedAt: alert.observedAt,
    });
    this.save();
    return true;
  }

`;
replaceOnce(
  "server/workspace.ts",
  '  addStep(runId: string, input: Pick<RunStep, "kind" | "title"> & { itemId?: string; status?: StepStatus }): RunStep | null {',
  lifecycleMethods + '  addStep(runId: string, input: Pick<RunStep, "kind" | "title"> & { itemId?: string; status?: StepStatus }): RunStep | null {',
  "workspace lifecycle methods",
);
replaceOnce(
  "server/workspace.ts",
  '  markNeedsAttention(runId: string, title: string, itemId?: string) {\n    const run = this.run(runId);\n    if (!run) return;\n    run.status = "needs_attention";',
  '  markNeedsAttention(runId: string, title: string, itemId?: string) {\n    const run = this.run(runId);\n    if (!run) return;\n    if (run.attentionKind === "lifecycle") {\n      const lifecycleStep = [...run.steps].reverse().find((candidate) => candidate.kind === "lifecycle" && candidate.status === "needs_attention");\n      if (lifecycleStep) { lifecycleStep.status = "completed"; lifecycleStep.completedAt = Date.now(); }\n      run.lifecycleAlert = undefined;\n    }\n    run.attentionKind = "provider";\n    run.status = "needs_attention";',
  "provider attention ownership",
);
replaceOnce(
  "server/workspace.ts",
  '    if (!denied) {\n      run.status = "running";',
  '    if (!denied) {\n      run.attentionKind = undefined;\n      run.status = "running";',
  "provider attention release",
);
replaceOnce(
  "server/workspace.ts",
  '    run.status = ok ? "completed" : error === "interrupted" ? "cancelled" : "failed";\n    run.completedAt = now;',
  '    run.status = ok ? "completed" : error === "interrupted" ? "cancelled" : "failed";\n    run.completedAt = now;\n    run.attentionKind = undefined;\n    run.lifecycleAlert = undefined;\n    run.lifecycle = undefined;',
  "completed run lifecycle cleanup",
);

// ── renderer Work types / UX ──────────────────────────────────────────
replaceOnce(
  "src/state/store.tsx",
  '  kind: "tool" | "approval" | "handoff";\n',
  '  kind: "tool" | "approval" | "handoff" | "lifecycle";\n',
  "renderer lifecycle step kind",
);
replaceOnce(
  "src/state/store.tsx",
  '  completedAt?: number;\n  error?: string;\n}',
  '  completedAt?: number;\n  error?: string;\n  attentionKind?: "provider" | "lifecycle";\n  lifecycle?: { state: "working" | "waiting" | "no_signal" | "dead"; lastActivityAt: number; waitingSince?: number; reason?: string; repeatCount?: number };\n  lifecycleAlert?: { kind: "no_signal" | "dead" | "repeated_effect"; title: string; observedAt: number; repeatCount?: number };\n}',
  "renderer run lifecycle fields",
);

replaceOnce(
  "src/components/WorkPanel.tsx",
  '          {run?.steps.length ? (',
  '          {run?.lifecycle && (\n            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">\n              <span className={cn("rounded-full px-2 py-0.5", run.lifecycle.state === "working" ? "bg-accent/10 text-accent" : run.lifecycle.state === "waiting" ? "bg-warning/10 text-warning" : "bg-danger/10 text-danger")}>\n                {run.lifecycle.state.replace("_", " ")}\n              </span>\n              <span className="text-ink-secondary">Last signal {relativeTime(run.lifecycle.lastActivityAt)}</span>\n              {run.lifecycle.reason ? <span className="w-full text-ink-secondary">{run.lifecycle.reason}</span> : null}\n            </div>\n          )}\n          {run?.lifecycleAlert && (\n            <div className="mt-3 rounded-lg border border-warning/30 bg-warning/5 px-2.5 py-2 text-[11px] text-warning">\n              <div className="font-medium">{run.lifecycleAlert.title}</div>\n              <div className="mt-1 text-ink-secondary">Cumea did not stop the agent automatically. Open its chat to steer it or stop the current turn.</div>\n            </div>\n          )}\n          {run?.steps.length ? (',
  "Work lifecycle projection",
);
replaceOnce(
  "src/components/WorkPanel.tsx",
  '  const failed = state.workspace.tasks.filter((task) => task.status === "failed").slice(-8).reverse();\n  if (!pending.length && !failed.length) {',
  '  const lifecycle = state.workspace.tasks.filter((task) => {\n    if (task.status !== "needs_attention") return false;\n    const run = state.workspace.runs.find((candidate) => candidate.id === task.latestRunId);\n    return run?.attentionKind === "lifecycle";\n  }).slice(-8).reverse();\n  const failed = state.workspace.tasks.filter((task) => task.status === "failed").slice(-8).reverse();\n  if (!pending.length && !lifecycle.length && !failed.length) {',
  "Needs You lifecycle list",
);
replaceOnce(
  "src/components/WorkPanel.tsx",
  '      {failed.length > 0 && (\n        <div>\n          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">Failed runs</div>',
  '      {lifecycle.length > 0 && (\n        <div>\n          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">Agent recovery</div>\n          <div className="space-y-2">{lifecycle.map((task) => <TaskCard key={task.id} task={task} />)}</div>\n        </div>\n      )}\n      {failed.length > 0 && (\n        <div>\n          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">Failed runs</div>',
  "Needs You lifecycle cards",
);

// ── remote/mobile structural Work projection ──────────────────────────
replaceOnce(
  "server/mobile.ts",
  'const STEP_KINDS = new Set(["tool", "approval", "handoff"]);',
  'const STEP_KINDS = new Set(["tool", "approval", "handoff", "lifecycle"]);',
  "mobile lifecycle step kind",
);
replaceOnce(
  "server/mobile.ts",
  '      ...(numberValue(run.completedAt) !== undefined ? { completedAt: numberValue(run.completedAt) } : {}),\n    }];',
  '      ...(numberValue(run.completedAt) !== undefined ? { completedAt: numberValue(run.completedAt) } : {}),\n      ...(["provider", "lifecycle"].includes(String(run.attentionKind)) ? { attentionKind: run.attentionKind } : {}),\n      ...(recordValue(run.lifecycle) && ["working", "waiting", "no_signal", "dead"].includes(String(recordValue(run.lifecycle)!.state)) ? { lifecycle: {\n        state: String(recordValue(run.lifecycle)!.state),\n        ...(numberValue(recordValue(run.lifecycle)!.lastActivityAt) !== undefined ? { lastActivityAt: numberValue(recordValue(run.lifecycle)!.lastActivityAt) } : {}),\n        ...(numberValue(recordValue(run.lifecycle)!.waitingSince) !== undefined ? { waitingSince: numberValue(recordValue(run.lifecycle)!.waitingSince) } : {}),\n        ...(stringValue(recordValue(run.lifecycle)!.reason, 180) ? { reason: stringValue(recordValue(run.lifecycle)!.reason, 180) } : {}),\n      } } : {}),\n    }];',
  "mobile lifecycle run projection",
);

// ── harness watchdog wiring ────────────────────────────────────────────
replaceOnce(
  "server/index.ts",
  'import { PairingStore } from "./pairing.ts";\n',
  'import { PairingStore } from "./pairing.ts";\nimport { LifecycleWatchdog, type RunLifecycleAlert, type RunLifecycleProjection } from "./lifecycle-watchdog.ts";\n',
  "watchdog import",
);
replaceOnce(
  "server/index.ts",
  'const workspace = new WorkspaceStore();\nconst pairing = new PairingStore();',
  'const workspace = new WorkspaceStore();\nconst lifecycleWatchdog = new LifecycleWatchdog();\nconst pairing = new PairingStore();',
  "watchdog instance",
);

const lifecycleHelpers = `
function syncLifecycleProjection(value: RunLifecycleProjection | null) {
  if (!value) return;
  if (workspace.setRunLifecycle(value.runId, value)) broadcastWorkspace();
}

function surfaceLifecycleAlert(alert: RunLifecycleAlert | null) {
  if (!alert) return;
  if (workspace.markLifecycleAttention(alert.runId, alert)) broadcastWorkspace();
}

function signalLifecycle(threadId: string) {
  const before = lifecycleWatchdog.get(threadId);
  const after = lifecycleWatchdog.signal(threadId);
  if (before?.state !== after?.state) syncLifecycleProjection(after);
}

`;
replaceOnce(
  "server/index.ts",
  '// ── server-side event folding (upstream\'s ingestion worker, miniature) ──',
  lifecycleHelpers + '// ── server-side event folding (upstream\'s ingestion worker, miniature) ──',
  "lifecycle helpers",
);

replaceOnce(
  "server/index.ts",
  '  const bot = store.botByThread(event.threadId);\n  if (!bot) return;\n\n  const pushMessage',
  '  const bot = store.botByThread(event.threadId);\n  if (!bot) return;\n\n  const lifecycleRunId = activeRunByThread.get(event.threadId);\n  if (lifecycleRunId) {\n    if (event.type === "request.opened" && event.requestId) {\n      syncLifecycleProjection(lifecycleWatchdog.openWait(event.threadId, event.requestId, event.summary));\n    } else if (event.type === "request.resolved" && event.requestId) {\n      syncLifecycleProjection(lifecycleWatchdog.resolveWait(event.threadId, event.requestId));\n    } else if (event.type === "item.started" && event.itemType === "tool" && event.title?.trim()) {\n      const before = lifecycleWatchdog.get(event.threadId);\n      const alert = lifecycleWatchdog.recordEffect(event.threadId, event.title);\n      const after = lifecycleWatchdog.get(event.threadId);\n      if (before?.state !== after?.state) syncLifecycleProjection(after);\n      surfaceLifecycleAlert(alert);\n    } else if (event.type !== "turn.completed") {\n      signalLifecycle(event.threadId);\n    }\n  }\n\n  const pushMessage',
  "runtime event watchdog fold",
);

replaceOnce(
  "server/index.ts",
  '    const run = workspace.createRun(task.id);\n    runId = run.id;\n    broadcastWorkspace();',
  '    const run = workspace.createRun(task.id);\n    runId = run.id;\n    syncLifecycleProjection(lifecycleWatchdog.start(bot.threadId, run.id));\n    broadcastWorkspace();',
  "start tracked lifecycle",
);
replaceOnce(
  "server/index.ts",
  '    if (runId) workspace.completeRun(runId, false, message);\n    broadcastWorkspace();',
  '    if (runId) { workspace.completeRun(runId, false, message); lifecycleWatchdog.stop(bot.threadId); }\n    broadcastWorkspace();',
  "unavailable instance watchdog stop",
);
replaceOnce(
  "server/index.ts",
  '        workspace.completeRun(runId, false, message);\n        activeRunByThread.delete(bot.threadId);\n        broadcastWorkspace();',
  '        workspace.completeRun(runId, false, message);\n        activeRunByThread.delete(bot.threadId);\n        lifecycleWatchdog.stop(bot.threadId);\n        broadcastWorkspace();',
  "background failure watchdog stop",
);
replaceOnce(
  "server/index.ts",
  '        workspace.completeRun(runId, event.ok, event.stopReason || (event.ok ? undefined : "Provider run failed"));\n        activeRunByThread.delete(event.threadId);\n        broadcastWorkspace();',
  '        workspace.completeRun(runId, event.ok, event.stopReason || (event.ok ? undefined : "Provider run failed"));\n        activeRunByThread.delete(event.threadId);\n        lifecycleWatchdog.stop(event.threadId);\n        broadcastWorkspace();',
  "turn completion watchdog stop",
);
replaceOnce(
  "server/index.ts",
  '        workspace.completeRun(runId, false, "Providers reloaded while the task was running.");\n        activeRunByThread.delete(bot.threadId);',
  '        workspace.completeRun(runId, false, "Providers reloaded while the task was running.");\n        activeRunByThread.delete(bot.threadId);\n        lifecycleWatchdog.stop(bot.threadId);',
  "reload watchdog stop",
);
replaceOnce(
  "server/index.ts",
  '        workspace.completeRun(runId, false, "interrupted");\n        activeRunByThread.delete(bot.threadId);\n      }\n      clearThreadEventState(bot.threadId);',
  '        workspace.completeRun(runId, false, "interrupted");\n        activeRunByThread.delete(bot.threadId);\n      }\n      lifecycleWatchdog.stop(bot.threadId);\n      clearThreadEventState(bot.threadId);',
  "delete watchdog stop",
);

replaceOnce(
  "server/index.ts",
  'const routineTimer = setInterval(() => void dispatchDueRoutines(), 30_000);\nroutineTimer.unref();',
  'const routineTimer = setInterval(() => void dispatchDueRoutines(), 30_000);\nroutineTimer.unref();\n\nconst lifecycleTimer = setInterval(() => {\n  const { projections, alerts } = lifecycleWatchdog.tick();\n  let changed = false;\n  for (const value of projections) changed = workspace.setRunLifecycle(value.runId, value) || changed;\n  for (const alert of alerts) changed = workspace.markLifecycleAttention(alert.runId, alert) || changed;\n  if (changed) broadcastWorkspace();\n}, 15_000);\nlifecycleTimer.unref();',
  "watchdog interval",
);
replaceOnce(
  "server/index.ts",
  '    clearInterval(routineTimer);\n    clearTimeout(initialRoutineTimer);',
  '    clearInterval(routineTimer);\n    clearInterval(lifecycleTimer);\n    clearTimeout(initialRoutineTimer);',
  "watchdog shutdown",
);

for (const [path, needles] of Object.entries({
  "server/workspace.ts": ["markLifecycleAttention", 'attentionKind?: RunAttentionKind', 'kind: "tool" | "approval" | "handoff" | "lifecycle"'],
  "server/index.ts": ["LifecycleWatchdog", "lifecycleTimer", "openWait(event.threadId", "recordEffect(event.threadId"],
  "src/components/WorkPanel.tsx": ["Agent recovery", "Cumea did not stop the agent automatically"],
  "server/mobile.ts": ['"lifecycle"', "attentionKind"],
})) {
  const source = readFileSync(path, "utf8");
  for (const needle of needles) if (!source.includes(needle)) throw new Error(`${path}: missing ${needle}`);
}
