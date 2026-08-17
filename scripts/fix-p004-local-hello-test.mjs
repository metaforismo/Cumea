import { readFileSync, writeFileSync } from "node:fs";

const path = "server/index.test.ts";
let source = readFileSync(path, "utf8");
const needle = `    const eventStream = await openEventStream(auth);\n    expect(await eventStream.next()).toEqual({ kind: "hello" });\n    const localEventStream = await openEventStream({}, BASE);\n    expect(await localEventStream.next()).toEqual({ kind: "hello" });\n`;
const replacement = `    const eventStream = await openEventStream(auth);\n    expect(await eventStream.next()).toEqual({ kind: "hello" });\n    const localEventStream = await openEventStream({}, BASE);\n    const localHello = await localEventStream.next();\n    expect(localHello).toMatchObject({ kind: "hello" });\n    expect(Number.isSafeInteger(localHello.eventCursor)).toBe(true);\n    expect(localHello.eventCursor).toBeGreaterThanOrEqual(0);\n`;
const first = source.indexOf(needle);
if (first < 0 || first !== source.lastIndexOf(needle)) throw new Error("local hello assertion: expected one match");
source = source.replace(needle, replacement);
writeFileSync(path, source);
