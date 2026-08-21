#!/usr/bin/env node

// Reproducible, synthetic fixture used only for Cumea's own screenshots.
// It refuses to touch an existing data directory so a real user profile can
// never be overwritten by a documentation command.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const target = process.argv[2] ? resolve(process.argv[2]) : null;
if (!target) throw new Error("usage: node scripts/seed-screenshot-data.mjs <new-data-directory>");
if (existsSync(target)) throw new Error(`refusing to overwrite existing directory: ${target}`);

process.env.CUMEA_DATA_DIR = target;
mkdirSync(target, { recursive: false, mode: 0o700 });

const [{ saveConfig }, { Store }] = await Promise.all([
  import("../dist-server/config.js"),
  import("../dist-server/store.js"),
]);

saveConfig({ profile: { name: "Alex Morgan", email: "" } });

const store = new Store(() => ({ instanceId: "codex", model: "gpt-5.6" }));
const now = Date.now();
const minute = 60_000;

const specs = [
  {
    key: "chief",
    name: "Chief of Staff",
    title: "Keeps the team aligned",
    description: "Coordinates launch work, decisions, handoffs, and the daily brief.",
    color: "teal",
    avatar: { kind: "mote", shapeId: "drop", color: "#16a79d", motion: "playful" },
    unread: false,
    messages: [
      { role: "bot", kind: "text", text: "Morning briefing:\n\n✓ **Desktop** → packaged server healthy · local data only\n✓ **Mobile** → agents, chat, Needs you, and routines aligned\n✓ **Models** → Codex, Claude, Grok, Gemini, or any ACP profile\n\nTwo things need you today: approve the launch copy and choose the release window. Everything else is moving.", at: now - 74 * minute },
      { role: "user", kind: "text", text: "Pull the launch together and keep the specialists in sync.", at: now - 18 * minute },
      { role: "bot", kind: "text", text: "On it — I handed packaging to Developer, the launch narrative to Content, and the final source check to Research.", at: now - 17 * minute },
      { role: "bot", kind: "handoff", handoff: { fromBotId: "chief", fromName: "Chief of Staff", toBotId: "developer", toName: "Developer", prompt: "Verify the macOS package and server startup.", status: "completed", reply: "Package verified; runtime health check passed." }, at: now - 11 * minute },
      { role: "bot", kind: "text", text: "Launch check complete:\n\n✓ **Package** → clean install starts without a port false-positive\n✓ **Brand** → new rounded icon applied across desktop, web, and mobile\n✓ **Privacy** → no provider credentials are copied to the phone\n\nThe release draft is ready for your review.", at: now - 7 * minute },
      { role: "bot", kind: "options", card: { title: "Publish the launch thread?", subtitle: "Nothing leaves your account until you approve it.", options: ["Approve", "Hold", "Review copy"], requestId: "demo-launch-approval", requestType: "question", tool: "x.com" }, at: now - 4 * minute },
    ],
  },
  {
    key: "inbox",
    name: "Inbox Manager",
    title: "Email and follow-up",
    description: "Triage, drafts, follow-ups, and quiet-account alerts.",
    color: "blue",
    avatar: { kind: "mote", shapeId: "soft", color: "#2f8de3", motion: "calm" },
    unread: true,
    messages: [
      { role: "bot", kind: "text", text: "Inbox at zero. Five thoughtful drafts are parked for tomorrow; nothing was sent without approval.", at: now - 42 * minute },
    ],
  },
  {
    key: "research",
    name: "Research Lead",
    title: "Signals and synthesis",
    description: "Finds evidence, compares sources, and hands concise findings to the team.",
    color: "orange",
    avatar: { kind: "mote", shapeId: "peak", color: "#f56a16", motion: "playful" },
    unread: false,
    messages: [
      { role: "bot", kind: "text", text: "Daily AI scan is ready: 24 sources checked, 6 signals kept, 2 handed to Content for the newsletter.", at: now - 63 * minute },
    ],
  },
  {
    key: "developer",
    name: "Developer",
    title: "Builds apps and systems",
    description: "Implements, tests, packages, and coordinates coding agents through ACP.",
    color: "purple",
    avatar: { kind: "mote", shapeId: "tile", color: "#7651d6", motion: "kinetic" },
    unread: false,
    messages: [
      { role: "bot", kind: "text", text: "macOS package verified. The agent server starts from a clean install and the mobile companion still typechecks and exports.", at: now - 12 * minute },
    ],
  },
  {
    key: "content",
    name: "Content Studio",
    title: "Launch copy and social",
    description: "Turns shipped work into clear, human launch material.",
    color: "pink",
    avatar: { kind: "mote", shapeId: "ripple", color: "#d72879", motion: "playful" },
    unread: false,
    messages: [
      { role: "bot", kind: "text", text: "The launch post is drafted in your voice and credits the open-source projects that helped Cumea get started.", at: now - 9 * minute },
    ],
  },
  {
    key: "quick",
    name: "Release Scout",
    title: "Temporary release check",
    description: "A quick bot that disappears after the audit is safely complete.",
    color: "green",
    avatar: { kind: "mote", shapeId: "capsule", color: "#19ae7a", motion: "calm" },
    lifecycle: { kind: "temporary", expiresAt: now + 22 * 60 * minute },
    unread: false,
    messages: [
      { role: "bot", kind: "text", text: "Release scan complete. No blocking issue found; I can be kept permanently or expire after the handoff.", at: now - 3 * minute },
    ],
  },
];

const created = new Map();
for (const spec of [...specs].reverse()) {
  const bot = store.createBot(spec.lifecycle ? { lifecycle: spec.lifecycle } : {});
  store.patchBot(bot.id, {
    name: spec.name,
    title: spec.title,
    description: spec.description,
    color: spec.color,
    avatar: spec.avatar,
    unread: spec.unread,
    notifications: true,
    modelSelection: { instanceId: "codex", model: "gpt-5.6" },
  });
  created.set(spec.key, bot);
}

for (const spec of specs) {
  const bot = created.get(spec.key);
  const ids = {
    chief: created.get("chief").id,
    developer: created.get("developer").id,
  };
  const messages = spec.messages.map((message, index) => ({
    ...message,
    id: `${spec.key}-message-${index + 1}`,
    parentId: index ? `${spec.key}-message-${index}` : null,
    ...(message.handoff ? {
      handoff: {
        ...message.handoff,
        fromBotId: ids.chief,
        toBotId: ids.developer,
      },
    } : {}),
  }));
  writeFileSync(
    `${target}/messages-${bot.threadId}.json`,
    `${JSON.stringify({ messages, activeLeafId: messages.at(-1)?.id ?? null }, null, 2)}\n`,
    { mode: 0o600 },
  );
}

console.log(JSON.stringify({ dataDir: target, bots: specs.length, selectedBotId: created.get("chief").id }, null, 2));
