import { readFileSync, writeFileSync } from "node:fs";

const file = "README.md";
let text = readFileSync(file, "utf8");
const needle = `The renderer owns no provider transport. Commands cross the local API, providers emit one canonical\nevent stream, and the UI folds that stream into visible conversation state.\n`;
const replacement = `${needle}\nPackaged desktop startup keeps the renderer on the stable private origin \`http://127.0.0.1:8799\`.\nElectron serves the built UI from its own loopback gateway, starts the API-only harness on an\nOS-assigned private loopback port, and attaches that port only after a versioned UtilityProcess\nreadiness message matches the exact child PID. The packaged harness therefore does not expose a\nsecond renderer origin or rely on fixed private fallback ports. Source development still uses the\nfixed \`:5199\` UI and \`:8799\` harness pair described above.\n`;
const first = text.indexOf(needle);
if (first < 0 || first !== text.lastIndexOf(needle)) {
  throw new Error("expected exactly one architecture summary in README");
}
text = text.replace(needle, replacement);
writeFileSync(file, text);
