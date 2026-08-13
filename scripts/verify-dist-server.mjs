import { execFileSync } from "node:child_process";

const status = execFileSync(
  "git",
  ["status", "--porcelain=v1", "--untracked-files=all", "--", "dist-server"],
  { encoding: "utf8" },
).trim();

if (status) {
  console.error("dist-server is out of sync with server source after pnpm build:server:");
  console.error(status);
  console.error("Regenerate dist-server and commit only the corresponding generated output.");
  process.exitCode = 1;
} else {
  console.log("dist-server matches the committed server source.");
}
