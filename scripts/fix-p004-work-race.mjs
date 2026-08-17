import { readFileSync, writeFileSync } from "node:fs";

const path = "src/state/store.tsx";
let source = readFileSync(path, "utf8");
function replaceOnce(needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0 || first !== source.lastIndexOf(needle)) throw new Error(`${label}: expected one match`);
  source = `${source.slice(0, first)}${replacement}${source.slice(first + needle.length)}`;
}

replaceOnce(
  '  const workspaceCompleteRef = useRef(false);\n',
  '  const workspaceCompleteRef = useRef(false);\n  const bootstrapReadyRef = useRef(false);\n  const workspaceReloadInFlightRef = useRef(false);\n',
  "bootstrap/work refs",
);

replaceOnce(
  `  const showError = useCallback((error: unknown) => {\n    rawDispatch({ type: "error", message: error instanceof Error ? error.message : String(error) });\n    setTimeout(() => rawDispatch({ type: "error", message: null }), 6000);\n  }, []);\n`,
  `  const showError = useCallback((error: unknown) => {\n    rawDispatch({ type: "error", message: error instanceof Error ? error.message : String(error) });\n    setTimeout(() => rawDispatch({ type: "error", message: null }), 6000);\n  }, []);\n\n  const loadFullWorkspace = useCallback(() => {\n    if (workspaceReloadInFlightRef.current) return;\n    workspaceReloadInFlightRef.current = true;\n    void api("/api/work")\n      .then(({ workspace }) => {\n        workspaceCompleteRef.current = true;\n        rawDispatch({ type: "workspaceHydrated", workspace });\n      })\n      .catch(showError)\n      .finally(() => {\n        workspaceReloadInFlightRef.current = false;\n      });\n  }, [showError]);\n`,
  "full workspace loader",
);

replaceOnce(
  `        case "toggleWork": {\n          const opening = action.open ?? !stateRef.current.workOpen;\n          if (opening && !workspaceCompleteRef.current) {\n            api("/api/work")\n              .then(({ workspace }) => {\n                workspaceCompleteRef.current = true;\n                rawDispatch({ type: "workspaceHydrated", workspace });\n              })\n              .catch(showError);\n          }\n          break;\n        }\n`,
  `        case "toggleWork": {\n          const opening = action.open ?? !stateRef.current.workOpen;\n          if (opening && bootstrapReadyRef.current && !workspaceCompleteRef.current) {\n            loadFullWorkspace();\n          }\n          break;\n        }\n`,
  "toggle Work lazy load",
);

replaceOnce(
  '  }, [showError]);\n\n  // ── atomic bootstrap + cursor-aware SSE fold',
  '  }, [showError, loadFullWorkspace]);\n\n  // ── atomic bootstrap + cursor-aware SSE fold',
  "dispatch dependencies",
);

replaceOnce(
  `          const materialized = materializeDesktopBootstrap(snapshot);\n          workspaceCompleteRef.current = materialized.workspaceComplete;\n          rawDispatch({`,
  `          const materialized = materializeDesktopBootstrap(snapshot);\n          workspaceCompleteRef.current = materialized.workspaceComplete;\n          bootstrapReadyRef.current = true;\n          rawDispatch({`,
  "bootstrap readiness latch",
);

replaceOnce(
  `          });\n          lastCursor = snapshot.eventCursor;\n          const pending = framesAfterCursor(buffered, lastCursor);`,
  `          });\n          if (stateRef.current.workOpen && !materialized.workspaceComplete) loadFullWorkspace();\n          lastCursor = snapshot.eventCursor;\n          const pending = framesAfterCursor(buffered, lastCursor);`,
  "post-bootstrap Work catch-up",
);

for (const invariant of [
  "bootstrapReadyRef.current",
  "workspaceReloadInFlightRef.current",
  "loadFullWorkspace();",
  "stateRef.current.workOpen && !materialized.workspaceComplete",
]) {
  if (!source.includes(invariant)) throw new Error(`missing Work race invariant: ${invariant}`);
}
writeFileSync(path, source);
