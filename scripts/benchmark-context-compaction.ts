import { performance } from "node:perf_hooks";
import { compactReplayContext } from "../server/context-compaction.ts";

const history = Array.from({ length: 2_000 }, (_, index) => ({ id: `message-${index}`, role: index % 2 === 0 ? "user" as const : "assistant" as const, text: `structural sample ${index} ${"🙂".repeat(80)}`, at: index + 1 }));
const start = performance.now();
let submittedBytes = 0;
for (let index = 0; index < 1_000; index += 1) submittedBytes += compactReplayContext(history).stats.submittedBytes;
console.log(JSON.stringify({ label: "structural-only; not an accuracy, token, cost, or provider benchmark", iterations: 1_000, elapsedMs: performance.now() - start, submittedBytes }));
