import assert from "node:assert/strict";
import test from "node:test";
import { classifyServerFailure, serverCandidatePorts, startupErrorPage } from "./server-startup.mjs";

test("keeps the stable ports and adds unique dynamic fallbacks", () => {
  let next = 50_000;
  const ports = serverCandidatePorts(4, () => next++);
  assert.deepEqual(ports.slice(0, 3), [8799, 18799, 28799]);
  assert.equal(new Set(ports).size, 7);
  assert.ok(ports.slice(3).every((port) => port >= 49_152 && port < 65_534));
});

test("distinguishes a missing packaged dependency from a port conflict", () => {
  assert.deepEqual(
    classifyServerFailure("Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'jszip' imported from index.js"),
    { kind: "missing-runtime", detail: "The packaged server is missing its jszip runtime dependency." },
  );
  assert.equal(classifyServerFailure("listen EADDRINUSE: address already in use").kind, "port-in-use");
});

test("renders a bounded diagnostic without injecting markup", () => {
  const page = decodeURIComponent(startupErrorPage({ kind: "server-exited", detail: "<script>bad()</script>" }).split(",", 2)[1]);
  assert.match(page, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(page, /<script>bad\(\)<\/script>/);
});
