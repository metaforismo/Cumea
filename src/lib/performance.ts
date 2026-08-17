const ALLOWED_MARKS = new Set([
  "cumea:renderer:entry-evaluated",
  "cumea:renderer:render-start",
  "cumea:renderer:render-submitted",
  "cumea:renderer:shell-committed",
  "cumea:renderer:shell-painted",
  "cumea:renderer:transport-connected",
  "cumea:renderer:shell-usable-committed",
  "cumea:renderer:shell-usable-painted",
]);

function publish(name: string, startTime: number) {
  window.cumea?.performanceMark({
    name,
    timeOrigin: performance.timeOrigin,
    startTime,
  });
}

export function markOnce(name: string): boolean {
  if (!ALLOWED_MARKS.has(name) || performance.getEntriesByName(name).length > 0) return false;
  performance.mark(name);
  const entry = performance.getEntriesByName(name, "mark")[0];
  if (entry) publish(name, entry.startTime);
  return true;
}

/** Schedule a mark after the browser has had an opportunity to paint twice.
 * The returned cleanup prevents a stale StrictMode/unmount callback. */
export function markAfterPaint(name: string): () => void {
  let firstFrame = 0;
  let secondFrame = 0;
  firstFrame = window.requestAnimationFrame(() => {
    secondFrame = window.requestAnimationFrame(() => markOnce(name));
  });
  return () => {
    window.cancelAnimationFrame(firstFrame);
    window.cancelAnimationFrame(secondFrame);
  };
}
