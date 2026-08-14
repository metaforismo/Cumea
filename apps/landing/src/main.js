import "./styles.css";
const heroShot = "/product-shots/hero.png";
const computerShot = "/product-shots/computer-panel.png";
const approvalShot = "/product-shots/approval-card.png";
const modelShot = "/product-shots/model-picker.png";
const marketplaceShot = "/product-shots/marketplace.png";

const DEFAULT_REPOSITORY = "https://github.com/metaforismo/Cumea";

function normalizeHttpsUrl(value) {
  if (!value) return null;

  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString().replace(/\/$/, "") : null;
  } catch {
    return null;
  }
}

const repositoryUrl = normalizeHttpsUrl(import.meta.env.VITE_CUMEA_GITHUB_URL) ?? DEFAULT_REPOSITORY;
const cloneCommand = `git clone ${repositoryUrl}.git`;

document.querySelectorAll("[data-repository-link]").forEach((link) => {
  const originalUrl = new URL(link.href);
  const originalRepository = new URL(DEFAULT_REPOSITORY);
  link.href = `${repositoryUrl}${originalUrl.pathname.slice(originalRepository.pathname.length)}${originalUrl.search}${originalUrl.hash}`;
});

document.querySelectorAll("[data-release-link]").forEach((link) => {
  link.href = `${repositoryUrl}/releases/tag/v0.1.0`;
});

const commandButton = document.querySelector("[data-copy-command]");
const commandCode = commandButton?.querySelector("code");
const copyLabel = commandButton?.querySelector("[data-copy-label]");
const copyToast = document.querySelector("[data-copy-toast]");
let resetTimer;

if (commandCode) commandCode.textContent = cloneCommand;

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.className = "clipboard-fallback";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("copy unavailable");
}

commandButton?.addEventListener("click", async () => {
  try {
    await copyText(cloneCommand);
    if (copyLabel) copyLabel.textContent = "Copied";
    copyToast?.classList.add("visible");
    window.clearTimeout(resetTimer);
    resetTimer = window.setTimeout(() => {
      if (copyLabel) copyLabel.textContent = "Copy";
      copyToast?.classList.remove("visible");
    }, 1800);
  } catch {
    if (copyLabel) copyLabel.textContent = "Unavailable";
  }
});

const ICONS = {
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  mic: '<path d="M12 19v3"/><path d="M8 22h8"/><rect width="6" height="13" x="9" y="2" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/>',
  "arrow-up": '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
  power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  loader: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
  sparkles:
    '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>',
  image:
    '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
};

function icon(name, size = 16) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", name === "arrow-up" ? "2.4" : "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = ICONS[name];
  return svg;
}

const MOTE_SHAPES = [
  { id: "orb", label: "Orb", description: "Balanced and calm", path: "M 160 54 C 173.52 54 188.07 56.89 200.56 62.07 C 213.06 67.24 225.39 75.49 234.95 85.05 C 244.51 94.61 252.76 106.94 257.93 119.44 C 263.11 131.93 266 146.48 266 160 C 266 173.52 263.11 188.07 257.93 200.56 C 252.76 213.06 244.51 225.39 234.95 234.95 C 225.39 244.51 213.06 252.76 200.56 257.93 C 188.07 263.11 173.52 266 160 266 C 146.48 266 131.93 263.11 119.44 257.93 C 106.94 252.76 94.61 244.51 85.05 234.95 C 75.49 225.39 67.24 213.06 62.07 200.56 C 56.89 188.07 54 173.52 54 160 C 54 146.48 56.89 131.93 62.07 119.44 C 67.24 106.94 75.49 94.61 85.05 85.05 C 94.61 75.49 106.94 67.24 119.44 62.07 C 131.93 56.89 146.48 54 160 54 Z" },
  { id: "soft", label: "Soft", description: "Organic and uneven", path: "M 160 54.49 C 174.22 55.33 189.14 60.94 201.52 67.05 C 213.9 73.15 224.63 81.99 234.29 91.11 C 243.96 100.23 253.04 110.29 259.52 121.77 C 266.01 133.26 272.11 146.84 273.19 160 C 274.27 173.16 271.84 188.64 265.99 200.71 C 260.13 212.77 249.01 224.11 238.08 232.4 C 227.15 240.7 213.43 246.12 200.41 250.47 C 187.4 254.82 173.85 257.65 160 258.49 C 146.15 259.33 130.88 259.37 117.33 255.52 C 103.79 251.66 88.91 244.64 78.73 235.36 C 68.55 226.08 60.53 212.4 56.27 199.84 C 52.01 187.28 52.11 172.87 53.19 160 C 54.27 147.13 57.84 134.62 62.73 122.64 C 67.62 110.67 73.6 98.26 82.52 88.15 C 91.43 78.05 103.31 67.61 116.22 62 C 129.14 56.39 145.78 53.65 160 54.49 Z" },
  { id: "tile", label: "Tile", description: "Rounded and steady", path: "M 160 59 C 183.59 59 215.96 59.89 230.76 61.92 C 245.57 63.95 244.28 66.61 248.83 71.17 C 253.39 75.72 256.05 74.43 258.08 89.24 C 260.11 104.04 261 136.41 261 160 C 261 183.59 260.11 215.96 258.08 230.76 C 256.05 245.57 253.39 244.28 248.83 248.83 C 244.28 253.39 245.57 256.05 230.76 258.08 C 215.96 260.11 183.59 261 160 261 C 136.41 261 104.04 260.11 89.24 258.08 C 74.43 256.05 75.72 253.39 71.17 248.83 C 66.61 244.28 63.95 245.57 61.92 230.76 C 59.89 215.96 59 183.59 59 160 C 59 136.41 59.89 104.04 61.92 89.24 C 63.95 74.43 66.61 75.72 71.17 71.17 C 75.72 66.61 74.43 63.95 89.24 61.92 C 104.04 59.89 136.41 59 160 59 Z" },
  { id: "capsule", label: "Capsule", description: "Quick and compact", path: "M 160 90 C 185.53 90 219.49 90.82 236.58 92.59 C 253.68 94.36 255.94 96.8 262.59 100.65 C 269.25 104.5 273.45 105.8 276.52 115.7 C 279.59 125.59 281 145.23 281 160 C 281 174.77 279.59 194.41 276.52 204.3 C 273.45 214.2 269.25 215.5 262.59 219.35 C 255.94 223.2 253.68 225.64 236.58 227.41 C 219.49 229.18 185.53 230 160 230 C 134.47 230 100.51 229.18 83.42 227.41 C 66.32 225.64 64.06 223.2 57.41 219.35 C 50.75 215.5 46.55 214.2 43.48 204.3 C 40.41 194.41 39 174.77 39 160 C 39 145.23 40.41 125.59 43.48 115.7 C 46.55 105.8 50.75 104.5 57.41 100.65 C 64.06 96.8 66.32 94.36 83.42 92.59 C 100.51 90.82 134.47 90 160 90 Z" },
  { id: "peak", label: "Peak", description: "Curious and alert", path: "M 160 49 C 164.17 52 171.33 62.5 178 72 C 184.67 81.5 192.67 94.17 200 106 C 207.33 117.83 215.67 130.5 222 143 C 228.33 155.5 236.33 170.33 238 181 C 239.67 191.67 237.33 201.17 232 207 C 226.67 212.83 215.33 214.17 206 216 C 196.67 217.83 186.33 217.67 176 218 C 165.67 218.33 154.5 218 144 218 C 133.5 218 122.33 219.5 113 218 C 103.67 216.5 93.17 214.67 88 209 C 82.83 203.33 80.5 194.5 82 184 C 83.5 173.5 91 158.67 97 146 C 103 133.33 110.67 120.17 118 108 C 125.33 95.83 135.17 82 141 73 C 146.83 64 149.83 58 153 54 C 156.17 50 155.83 46 160 49 Z" },
  { id: "gem", label: "Gem", description: "Structured and bold", path: "M 160 48 C 177.17 42.17 176.17 56.67 185 62 C 193.83 67.33 204.17 74.17 213 80 C 221.83 85.83 232.5 88.83 238 97 C 243.5 105.17 244.67 117.5 246 129 C 247.33 140.5 246.33 154 246 166 C 245.67 178 249 192 244 201 C 239 210 226 213.83 216 220 C 206 226.17 193.33 233.17 184 238 C 174.67 242.83 168 249 160 249 C 152 249 145.33 242.83 136 238 C 126.67 233.17 114 226.17 104 220 C 94 213.83 81 210.17 76 201 C 71 191.83 74.33 177 74 165 C 73.67 153 72.67 140.33 74 129 C 75.33 117.67 67.67 110.5 82 97 C 96.33 83.5 142.83 53.83 160 48 Z" },
  { id: "ripple", label: "Ripple", description: "Playful and elastic", path: "M 160 74.64 C 173.56 76.5 184.7 71.63 198.24 73.11 C 211.78 74.6 233.11 74.71 241.24 83.54 C 249.38 92.36 244.73 113.32 247.04 126.07 C 249.34 138.81 251.85 147.44 255.07 160 C 258.29 172.56 270.52 190.48 266.34 201.45 C 262.15 212.43 241.84 219.51 229.94 225.82 C 218.04 232.14 206.58 232.56 194.93 239.36 C 183.27 246.17 172.46 264.78 160 266.64 C 147.54 268.5 130.67 258.39 120.17 250.5 C 109.67 242.61 107.26 227.79 96.99 219.3 C 86.73 210.81 66.22 209.43 58.57 199.54 C 50.91 189.66 47.85 171.93 51.07 160 C 54.29 148.07 72.09 139.64 77.86 127.98 C 83.63 116.32 79.19 101.06 85.69 90.06 C 92.19 79.06 104.48 64.55 116.86 61.98 C 129.25 59.41 146.44 72.78 160 74.64 Z" },
  { id: "drop", label: "Drop", description: "Warm and expressive", path: "M 160 44 C 166 44 171.67 59.17 178 68 C 184.33 76.83 191.33 87 198 97 C 204.67 107 213 117.5 218 128 C 223 138.5 227 149.5 228 160 C 229 170.5 227.67 181.67 224 191 C 220.33 200.33 212.67 209.33 206 216 C 199.33 222.67 191.67 227.67 184 231 C 176.33 234.33 168 236 160 236 C 152 236 143.67 234.33 136 231 C 128.33 227.67 120.67 222.67 114 216 C 107.33 209.33 99.67 200.33 96 191 C 92.33 181.67 91 170.5 92 160 C 93 149.5 97 138.5 102 128 C 107 117.5 115.33 107 122 97 C 128.67 87 135.67 76.83 142 68 C 148.33 59.17 154 44 160 44 Z" },
];

const MOTE_COLORS = [
  { name: "Chalk", value: "#edece7" },
  { name: "Cocoa", value: "#8b633d" },
  { name: "Poppy", value: "#dc2944" },
  { name: "Tangerine", value: "#f56a16" },
  { name: "Marigold", value: "#ee9e18" },
  { name: "Meadow", value: "#19ae7a" },
  { name: "Lagoon", value: "#16a79d" },
  { name: "Sky", value: "#2f8de3" },
  { name: "Violet", value: "#7651d6" },
  { name: "Berry", value: "#d72879" },
  { name: "Silver", value: "#b9bab7" },
];

const MOTE_MOTION = [
  { id: "calm", label: "Calm", description: "Slow, gentle drift" },
  { id: "playful", label: "Playful", description: "Soft bounce and tilt" },
  { id: "kinetic", label: "Kinetic", description: "Fast and expressive" },
];

const DEFAULT_AVATAR = { kind: "mote", shapeId: "drop", color: "#f56a16", motion: "playful" };

function moteShape(id) {
  return MOTE_SHAPES.find((shape) => shape.id === id) ?? MOTE_SHAPES[0];
}

function getMoteEyeColor(hex) {
  const value = hex.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  return luminance > 0.48 ? "#151612" : "#f4f2eb";
}

const avatars = {
  inbox: { kind: "mote", shapeId: "drop", color: "#2f8de3", motion: "playful" },
  sales: { kind: "mote", shapeId: "peak", color: "#f56a16", motion: "playful" },
  chief: { kind: "mote", shapeId: "drop", color: "#16a79d", motion: "calm" },
  research: { kind: "mote", shapeId: "soft", color: "#d72879", motion: "calm" },
};

let moteSerial = 0;

function renderMote(avatar, size = 22, working = false) {
  const shape = moteShape(avatar.shapeId);
  const eye = getMoteEyeColor(avatar.color);
  const clipId = `mote-clip-${(moteSerial += 1)}`;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 320 320");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("class", `mote-avatar mote-${avatar.motion}${working ? " is-working" : ""}`);
  svg.setAttribute("aria-hidden", "true");
  svg.style.setProperty("--mote-color", avatar.color);
  svg.style.setProperty("--mote-eye", eye);

  const image = avatar.kind === "upload" && avatar.imageDataUrl
    ? `<image href="${avatar.imageDataUrl}" x="42" y="42" width="236" height="236" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})" />`
    : "";

  svg.innerHTML = `
    <defs><clipPath id="${clipId}"><path d="${shape.path}" /></clipPath></defs>
    <path class="mote-body" d="${shape.path}" fill="${avatar.color}"></path>
    ${image}
    <g class="mote-eyes">
      <rect x="122" y="125" width="24" height="56" rx="12" fill="${eye}" transform="rotate(8 134 153)"></rect>
      <rect x="177" y="125" width="24" height="56" rx="12" fill="${eye}" transform="rotate(8 189 153)"></rect>
    </g>
  `;
  return svg;
}

function fillMoteSlot(slot, avatar, size) {
  if (!slot) return;
  slot.replaceChildren(renderMote(avatar, size, slot.classList.contains("is-working")));
}

const ORDER = ["inbox", "sales", "chief", "research"];
const DURATION = 12800;
const DWELL = 3600;
const INPUT_LIMIT = 280;
const CONFIG_IDLE = 5200;
const LETTERS = ["A", "B", "C"];

const RUN_LABELS = {
  cloud: "Cloud box",
  local: "This Mac",
  off: "Off",
};

const APPROVAL_CARDS = {
  inbox: {
    id: "approval",
    title: "Dana’s renewal",
    subtitle: "Approve the draft that quotes the contract?",
    options: ["Approve the draft", "Keep it held", "I’ll take it"],
    custom: true,
  },
  sales: {
    id: "approval",
    title: "Send the first six?",
    subtitle: "They stay drafts until you approve. This page cannot send mail.",
    options: ["Send the first six", "Park all drafts", "Show me one first"],
    custom: true,
  },
  chief: {
    id: "approval",
    title: "Catering asked about headcount",
    subtitle: "Reply from your host? Nothing leaves this preview.",
    options: ["Reply with 24", "Hold catering", "I’ll handle it"],
    custom: true,
  },
};

const CONFIG_CARD = {
  id: "config",
  title: "Where should this agent run?",
  subtitle: "Pick a computer for this preview. Nothing is provisioned from this page.",
  options: ["Cloud box", "This Mac", "Off"],
  custom: true,
};

const SCENARIOS = {
  inbox: {
    name: "Inbox Manager",
    role: "Mail · local host",
    reply: "Noted. I’ll keep this in the preview thread — nothing was sent from this page.",
    complete: [
      { kind: "context", text: "Today 12:11 AM" },
      { kind: "user", text: "clear friday’s unread. hold anything from dana." },
      { kind: "activity", title: "gmail.read" },
      { kind: "bot", text: "41 unread since friday. I’m archiving the noise and holding anything from Dana." },
      { kind: "activity", title: "gmail.draft" },
      { kind: "options", card: APPROVAL_CARDS.inbox },
    ],
    stages: [
      { at: 0, type: "context", text: "Today 12:11 AM", preview: "1 item waiting for your read", state: "Needs you" },
      { at: 900, type: "user", text: "clear friday’s unread. hold anything from dana.", preview: "clear friday’s unread…", state: "Working" },
      { at: 1800, type: "working" },
      { at: 3000, type: "activity", title: "gmail.read" },
      { at: 4300, type: "stream", text: "41 unread since friday. I’m archiving the noise and holding anything from Dana." },
      { at: 7800, type: "activity", title: "gmail.draft" },
      { at: 9200, type: "options", card: APPROVAL_CARDS.inbox, preview: "waiting for your read", state: "Needs you" },
    ],
  },
  sales: {
    name: "Sales Outbound",
    role: "Outreach · local host",
    reply: "Got it. In Cumea that would stay a draft until you approve.",
    complete: [
      { kind: "context", text: "Today 3:10 AM" },
      { kind: "user", text: "work last week’s list. don’t send anything." },
      { kind: "activity", title: "sheets.read" },
      { kind: "bot", text: "40 accounts. I drafted 18 first-touch notes in your voice and held them." },
      { kind: "activity", title: "mail.draft" },
      { kind: "options", card: APPROVAL_CARDS.sales },
    ],
    stages: [
      { at: 0, type: "context", text: "Today 3:10 AM", preview: "drafting first-touch notes…", state: "Unread" },
      { at: 900, type: "user", text: "work last week’s list. don’t send anything.", state: "Working" },
      { at: 1800, type: "working" },
      { at: 3000, type: "activity", title: "sheets.read" },
      { at: 4300, type: "stream", text: "40 accounts. I drafted 18 first-touch notes in your voice and held them." },
      { at: 7800, type: "activity", title: "mail.draft" },
      { at: 9200, type: "options", card: APPROVAL_CARDS.sales, preview: "waiting for your send", state: "Needs you" },
    ],
  },
  chief: {
    name: "Chief of Staff",
    role: "Calendar · local host",
    reply: "Understood. I’ll wait for you — this page did not change your calendar.",
    complete: [
      { kind: "context", text: "Today" },
      { kind: "user", text: "book the venue and send me the contract." },
      { kind: "activity", title: "calendar.update" },
      { kind: "bot", text: "Venue is held. The contract is ready for your signature line." },
      { kind: "activity", title: "files.hold" },
      { kind: "options", card: APPROVAL_CARDS.chief },
    ],
    stages: [
      { at: 0, type: "context", text: "Today", preview: "venue booked, contract held…", state: "Working" },
      { at: 900, type: "user", text: "book the venue and send me the contract.", state: "Working" },
      { at: 1800, type: "working" },
      { at: 3000, type: "activity", title: "calendar.update" },
      { at: 4300, type: "stream", text: "Venue is held. The contract is ready for your signature line." },
      { at: 7800, type: "activity", title: "files.hold" },
      { at: 9200, type: "options", card: APPROVAL_CARDS.chief, preview: "waiting on you", state: "Needs you" },
    ],
  },
  research: {
    name: "Research Analyst",
    role: "Research · local host",
    reply: "I’ll add that to the brief in this preview. No source or file was changed.",
    complete: [
      { kind: "context", text: "Yesterday" },
      { kind: "user", text: "compare the launch notes and show me what changed." },
      { kind: "activity", title: "files.read" },
      { kind: "bot", text: "I found four material changes and linked each one back to its source." },
      { kind: "activity", title: "brief.ready" },
      { kind: "bot", text: "The brief is ready for your review. Nothing was published." },
    ],
    stages: [
      { at: 0, type: "context", text: "Yesterday", preview: "brief ready for review", state: "Done" },
      { at: 900, type: "user", text: "compare the launch notes and show me what changed.", state: "Working" },
      { at: 1800, type: "working" },
      { at: 3000, type: "activity", title: "files.read" },
      { at: 4300, type: "stream", text: "I found four material changes and linked each one back to its source." },
      { at: 7800, type: "activity", title: "brief.ready" },
      { at: 9200, type: "bot", text: "The brief is ready for your review. Nothing was published.", preview: "brief ready for review", state: "Done" },
    ],
  },
};

const APP_SHOTS = {
  hero: heroShot,
  computer: computerShot,
  approval: approvalShot,
  model: modelShot,
  marketplace: marketplaceShot,
};

document.querySelectorAll("[data-app-shot]").forEach((image) => {
  image.src = APP_SHOTS[image.dataset.appShot];
});

const demoRoot = document.querySelector("[data-demo]");
const messagesNode = document.querySelector("[data-messages]");
const headerMote = document.querySelector("[data-header-mote]");
const moteTrigger = document.querySelector("[data-mote-trigger]");
const moteEditor = document.querySelector("[data-mote-editor]");
const agentName = document.querySelector("[data-agent-name]");
const agentRole = document.querySelector("[data-agent-role]");
const headerState = document.querySelector("[data-header-state]");
const scenarioControls = document.querySelectorAll("[data-scenario]");
const composerRoot = document.querySelector("[data-composer]");
const composerInput = document.querySelector("[data-composer-input]");
const composerAction = document.querySelector("[data-composer-action]");
const composerAttach = document.querySelector("[data-composer-attach]");
const composerFile = document.querySelector("[data-composer-file]");
const composerFiles = document.querySelector("[data-composer-files]");
const composerFeedback = document.querySelector("[data-composer-feedback]");
const composerStatus = document.querySelector("[data-composer-status]");
const agentSearch = document.querySelector("[data-agent-search]");
const needsFilter = document.querySelector("[data-needs-filter]");
const hostTabs = document.querySelectorAll("[data-host-tab]");
const hostSheet = document.querySelector("[data-host-sheet]");
const conversationRoot = document.querySelector(".conversation");
const modelTrigger = document.querySelector("[data-model-trigger]");
const modelLabelNode = document.querySelector("[data-model-label]");
const modelProviderMark = document.querySelector("[data-provider-mark]");
const claudeProviderMark = modelProviderMark?.innerHTML;
const modelMenu = document.querySelector("[data-model-menu]");
const computerButton = document.querySelector("[data-computer-btn]");
const computerDrawer = document.querySelector("[data-computer-drawer]");
const computerClose = document.querySelector("[data-computer-close]");
const computerSettings = document.querySelector("[data-computer-settings]");
const screenName = document.querySelector("[data-screen-name]");
const screenMode = document.querySelector("[data-screen-mode]");
const screenPreview = document.querySelector("[data-screen-preview]");
const cloudActions = document.querySelector("[data-cloud-actions]");
const routinesNode = document.querySelector("[data-routines]");
const demoToast = document.querySelector("[data-demo-toast]");
const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

const localState = {
  inbox: { mode: "cloud", asleep: false, approval: null, config: null, configShown: false, routines: [] },
  sales: { mode: "local", asleep: false, approval: null, config: null, configShown: false, routines: [] },
  chief: { mode: "cloud", asleep: false, approval: null, config: null, configShown: false, routines: [] },
  research: { mode: "local", asleep: false, approval: null, config: null, configShown: false, routines: [] },
};

let currentId = "inbox";
let elapsed = 0;
let lastTick = 0;
let applied = -1;
let streamTimer = 0;
let replyTimer = 0;
let configTimer = 0;
let toastTimer = 0;
let raf = 0;
let completedAt = 0;
let inView = false;
let hovered = false;
let focused = false;
let visitorActive = false;
let hostOpen = false;
let pendingFile = null;
let moteTab = "bot";

function prefersReducedMotion() {
  return motionQuery.matches;
}

function markVisitor() {
  visitorActive = true;
  window.clearTimeout(configTimer);
  configTimer = 0;
}

function canRunTimeline() {
  return (
    !prefersReducedMotion() &&
    !visitorActive &&
    !hostOpen &&
    document.visibilityState === "visible" &&
    inView &&
    !hovered &&
    !focused
  );
}

function canRotate() {
  return canRunTimeline() && completedAt > 0;
}

function enterClass(node) {
  if (!prefersReducedMotion()) node.classList.add("msg-enter");
  return node;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function announce(text) {
  if (composerStatus) composerStatus.textContent = text;
  if (!demoToast) return;
  demoToast.textContent = text;
  demoToast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    demoToast.classList.remove("visible");
  }, 2200);
}

function showComposerFeedback(text) {
  if (!composerFeedback) return;
  composerFeedback.hidden = false;
  composerFeedback.textContent = text;
}

function currentLocal() {
  return localState[currentId];
}

function optionAnswer(cardId) {
  const local = currentLocal();
  return cardId === "config" ? local.config : local.approval;
}

function buildOptionCard(card) {
  const answered = optionAnswer(card.id);
  const wrap = enterClass(el("div", `option-card${answered ? " is-resolved" : ""}`));
  wrap.dataset.card = card.id;

  const head = el("div", "option-head");
  const copy = el("div", "");
  copy.append(el("strong", "", card.title), el("p", "", card.subtitle));
  const dismiss = el("button", "icon-btn");
  dismiss.type = "button";
  dismiss.setAttribute("aria-label", "Dismiss request");
  dismiss.append(icon("x", 14));
  dismiss.disabled = Boolean(answered);
  dismiss.addEventListener("click", () => {
    markVisitor();
    if (card.id === "config") currentLocal().config = "Dismissed";
    else currentLocal().approval = "Dismissed";
    refreshOptionCard(card);
    announce("Dismissed in this preview. Nothing was sent.");
  });
  head.append(copy, dismiss);
  wrap.append(head);

  const list = el("div", "option-list");
  card.options.forEach((option, index) => {
    const button = el("button", "option-choice");
    button.type = "button";
    button.disabled = Boolean(answered);
    if (answered === option) button.classList.add("is-selected");
    const mark = el("span", "option-letter", LETTERS[index]);
    button.append(mark, document.createTextNode(option));
    button.addEventListener("click", () => resolveCard(card, option));
    list.append(button);
  });
  wrap.append(list);

  if (!answered && card.custom) {
    const input = el("input", "option-custom");
    input.type = "text";
    input.placeholder = "Type your own answer";
    input.maxLength = 80;
    input.setAttribute("aria-label", "Type your own answer");
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        resolveCard(card, input.value);
      }
    });
    input.addEventListener("focus", markVisitor);
    wrap.append(input);
  } else if (answered && !card.options.includes(answered) && answered !== "Dismissed") {
    wrap.append(el("p", "option-custom-resolved", answered));
  }

  return wrap;
}

function refreshOptionCard(card) {
  const existing = messagesNode?.querySelector(`[data-card="${card.id}"]`);
  const next = buildOptionCard(card);
  if (existing) existing.replaceWith(next);
  else messagesNode?.append(next);
}

function resolveCard(card, raw) {
  const answer = raw.trim();
  if (!answer) return;
  markVisitor();

  if (card.id === "config") {
    currentLocal().config = answer;
    currentLocal().configShown = true;
    const mapped = answer === "Cloud box" ? "cloud" : answer === "This Mac" ? "local" : answer === "Off" ? "off" : null;
    if (mapped) setComputerMode(mapped, { silent: true });
    refreshOptionCard(card);
    updateHeader(currentId, { preview: `runs on ${answer}`, state: "Idle" });
    announce(`${SCENARIOS[currentId].name} set to ${answer} in this preview.`);
    return;
  }

  currentLocal().approval = answer;
  refreshOptionCard(card);
  updateHeader(currentId, { preview: answer, state: "Done" });
  messagesNode?.append(renderItem({ kind: "bot", text: `You chose “${answer}”. Marked in this preview — nothing left this page.` }));
  scrollMessages();
  announce("Selection saved in this preview.");
}

function renderItem(item) {
  if (item.kind === "context") return enterClass(el("p", "context-line", item.text));
  if (item.kind === "user") return enterClass(el("p", "message user", item.text));
  if (item.kind === "bot") return enterClass(el("p", "message bot", item.text));
  if (item.kind === "working") {
    const note = enterClass(el("div", "working-dots"));
    note.setAttribute("aria-label", "Working");
    note.append(el("i", ""), el("i", ""), el("i", ""));
    return note;
  }
  if (item.kind === "activity") {
    const chip = enterClass(el("div", "activity-chip"));
    chip.append(icon("check", 12), el("span", "", item.title));
    return chip;
  }
  if (item.kind === "options") return buildOptionCard(item.card);
  return enterClass(el("p", "message bot", item.text || ""));
}

function scrollMessages() {
  if (!messagesNode) return;
  messagesNode.scrollTop = messagesNode.scrollHeight;
}

function paintAvatars() {
  document.querySelectorAll("[data-mote]").forEach((slot) => {
    const id = slot.dataset.mote;
    fillMoteSlot(slot, avatars[id], slot.classList.contains("small") ? 20 : 22);
  });
  fillMoteSlot(headerMote, avatars[currentId], 22);
  headerMote?.classList.toggle("is-working", /working/i.test(headerState?.textContent || ""));
  if (moteTrigger) {
    moteTrigger.setAttribute("aria-label", `Customize ${SCENARIOS[currentId].name}’s appearance`);
  }
}

function updateHeader(id, stage = {}) {
  const scenario = SCENARIOS[id];
  const source = demoRoot?.querySelector(`button.agent[data-scenario="${id}"]`);

  if (agentName) agentName.textContent = scenario.name;
  if (agentRole) agentRole.textContent = scenario.role;
  if (headerState) {
    const label = stage.state || "Idle";
    headerState.replaceChildren(el("i", ""), document.createTextNode(` ${label}`));
    headerState.classList.toggle("is-needs", /need/i.test(label));
  }
  if (composerInput) composerInput.placeholder = `Message ${scenario.name}`;
  const labelEl = document.querySelector("label[for='composer-input']");
  if (labelEl) labelEl.textContent = `Message ${scenario.name}`;

  if (source) {
    const preview = source.querySelector("[data-preview]");
    const state = source.querySelector("[data-state]");
    if (preview && stage.preview) preview.textContent = stage.preview;
    if (state && stage.state) {
      state.textContent = stage.state;
      state.classList.toggle("working", stage.state === "Working");
      state.classList.toggle("needs", /need/i.test(stage.state));
    }
  }

  scenarioControls.forEach((control) => {
    const on = control.dataset.scenario === id;
    control.setAttribute("aria-pressed", on ? "true" : "false");
    control.classList.toggle("active", control.classList.contains("agent") && on);
  });

  paintAvatars();
  renderComputer();
}

function clearSoftTimers() {
  window.clearTimeout(streamTimer);
  window.clearTimeout(replyTimer);
  window.clearTimeout(configTimer);
  streamTimer = 0;
  replyTimer = 0;
  configTimer = 0;
}

function setHostOpen(open) {
  hostOpen = open;
  if (hostSheet) hostSheet.hidden = !open;
  conversationRoot?.classList.toggle("is-host", open);
  hostTabs.forEach((tab) => tab.setAttribute("aria-pressed", open ? "true" : "false"));
}

function renderComplete(id) {
  const scenario = SCENARIOS[id];
  if (!messagesNode) return;
  messagesNode.replaceChildren();
  scenario.complete.forEach((item) => messagesNode.append(renderItem(item)));
  if (localState[id].configShown && localState[id].config) {
    messagesNode.append(buildOptionCard(CONFIG_CARD));
  }
  const last = scenario.stages[scenario.stages.length - 1];
  updateHeader(id, last);
  scrollMessages();
}

function applyStage(id, stage) {
  if (!messagesNode) return;

  if (stage.type === "context") {
    messagesNode.replaceChildren();
    messagesNode.append(renderItem({ kind: "context", text: stage.text }));
    const openingMessage = SCENARIOS[id].complete.find((item) => item.kind === "user");
    if (openingMessage) messagesNode.append(renderItem(openingMessage));
  } else if (stage.type === "user" || stage.type === "bot") {
    const lastMessage = messagesNode.querySelector(".message:last-of-type");
    if (lastMessage?.textContent !== stage.text) {
      messagesNode.append(renderItem({ kind: stage.type, text: stage.text }));
    }
  } else if (stage.type === "working") {
    messagesNode.append(renderItem({ kind: "working" }));
  } else if (stage.type === "stream") {
    messagesNode.querySelector(".working-dots")?.remove();
    const node = enterClass(el("p", "message bot", ""));
    messagesNode.append(node);
    const words = stage.text.split(" ");
    let count = 0;
    const pump = () => {
      count = Math.min(words.length, count + 3);
      node.textContent = words.slice(0, count).join(" ");
      scrollMessages();
      if (count < words.length && canRunTimeline() && currentId === id) {
        streamTimer = window.setTimeout(pump, 200);
      }
    };
    if (prefersReducedMotion()) node.textContent = stage.text;
    else pump();
  } else if (stage.type === "activity") {
    messagesNode.append(renderItem({ kind: "activity", title: stage.title }));
  } else if (stage.type === "options") {
    messagesNode.append(renderItem({ kind: "options", card: stage.card }));
  }

  updateHeader(id, stage);
  scrollMessages();
}

function resetClock() {
  elapsed = 0;
  lastTick = 0;
  applied = -1;
  completedAt = 0;
  clearSoftTimers();
}

function scheduleConfigCard() {
  window.clearTimeout(configTimer);
  if (visitorActive || prefersReducedMotion() || localState[currentId].configShown) return;
  configTimer = window.setTimeout(() => {
    if (visitorActive || currentLocal().configShown || hostOpen) return;
    showConfigCard();
  }, CONFIG_IDLE);
}

function showConfigCard() {
  if (!messagesNode) return;
  currentLocal().configShown = true;
  if (!messagesNode.querySelector('[data-card="config"]')) {
    messagesNode.append(buildOptionCard(CONFIG_CARD));
    scrollMessages();
  }
}

function selectScenario(id, { manual = false } = {}) {
  if (!SCENARIOS[id]) return;
  clearSoftTimers();
  currentId = id;
  resetClock();
  setHostOpen(false);
  setMoteEditor(false);
  if (manual) markVisitor();
  updateHeader(id, SCENARIOS[id].stages[0]);
  if (prefersReducedMotion() || visitorActive) renderComplete(id);
  else {
    applyStage(id, SCENARIOS[id].stages[0]);
    applied = 0;
  }
  scheduleConfigCard();
  syncComposerAction();
}

function tick(now) {
  if (canRunTimeline()) {
    if (lastTick) elapsed += now - lastTick;
    lastTick = now;
    const stages = SCENARIOS[currentId].stages;
    stages.forEach((stage, index) => {
      if (index > applied && elapsed >= stage.at) {
        applied = index;
        applyStage(currentId, stage);
      }
    });
    if (elapsed >= DURATION && completedAt === 0) completedAt = now;
  } else {
    lastTick = 0;
  }

  if (canRotate() && now - completedAt >= DWELL) {
    const next = ORDER[(ORDER.indexOf(currentId) + 1) % ORDER.length];
    selectScenario(next);
  }

  raf = window.requestAnimationFrame(tick);
}

function stopLoop() {
  window.cancelAnimationFrame(raf);
  raf = 0;
  lastTick = 0;
  clearSoftTimers();
}

function startLoop() {
  if (prefersReducedMotion() || raf || visitorActive) return;
  raf = window.requestAnimationFrame(tick);
}

function setModelMenu(open) {
  if (!modelMenu || !modelTrigger) return;
  modelMenu.hidden = !open;
  modelTrigger.setAttribute("aria-expanded", String(open));
}

function setComputerDrawer(open) {
  if (!computerDrawer || !computerButton) return;
  computerDrawer.hidden = !open;
  computerButton.setAttribute("aria-expanded", String(open));
  demoRoot?.classList.toggle("has-computer", open);
  if (open) {
    setModelMenu(false);
    renderComputer();
  }
}

function setComputerMode(mode, { silent = false } = {}) {
  currentLocal().mode = mode;
  if (mode !== "cloud") currentLocal().asleep = false;
  renderComputer();
  if (!silent) announce(`${SCENARIOS[currentId].name} now runs on ${RUN_LABELS[mode]} in this preview.`);
}

function renderComputer() {
  const scenario = SCENARIOS[currentId];
  const local = currentLocal();
  if (screenName) screenName.textContent = `${scenario.name}’s screen`;
  if (screenMode) screenMode.textContent = local.mode === "local" ? "this Mac" : "";

  document.querySelectorAll("[data-run-mode]").forEach((button) => {
    const on = button.dataset.runMode === local.mode;
    button.setAttribute("aria-checked", on ? "true" : "false");
    button.classList.toggle("is-active", on);
  });

  if (cloudActions) cloudActions.hidden = local.mode !== "cloud" || local.asleep;
  if (!screenPreview) return;

  screenPreview.replaceChildren();
  if (local.mode === "off") {
    const empty = el("div", "screen-empty");
    empty.append(icon("power", 20), el("span", "", "This bot’s computer is off"));
    screenPreview.append(empty);
    return;
  }
  if (local.asleep) {
    const empty = el("div", "screen-empty");
    empty.append(icon("moon", 20), el("span", "", "Computer is asleep"));
    const wake = el("button", "panel-button", "Wake");
    wake.type = "button";
    wake.addEventListener("click", () => {
      markVisitor();
      currentLocal().asleep = false;
      renderComputer();
      announce("Woke the preview computer. Nothing remote changed.");
    });
    empty.append(wake);
    screenPreview.append(empty);
    return;
  }
  if (local.mode === "local") {
    const empty = el("div", "screen-empty");
    empty.append(icon("monitor", 20), el("span", "", "This Mac preview needs the desktop app."));
    screenPreview.append(empty);
    return;
  }

  const image = el("img", "screen-frame");
  image.src = computerShot;
  image.alt = `${scenario.name}’s screen preview`;
  screenPreview.append(image);
}

function renderRoutines() {
  if (!routinesNode) return;
  routinesNode.replaceChildren();
  currentLocal().routines.forEach((title) => {
    const row = el("div", "created-routine");
    row.append(el("b", "", title), el("small", "", "Preview only · not scheduled"));
    routinesNode.append(row);
  });
}

function setMoteEditor(open) {
  if (!moteEditor || !moteTrigger) return;
  moteEditor.hidden = !open;
  moteTrigger.setAttribute("aria-expanded", String(open));
  if (open) {
    setModelMenu(false);
    renderMoteEditor();
  }
}

function renderMoteEditor() {
  if (!moteEditor) return;
  const avatar = avatars[currentId];
  const name = SCENARIOS[currentId].name;
  moteEditor.replaceChildren();

  const bar = el("div", "mote-editor-bar");
  const tabs = el("div", "mote-tabs");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Avatar source");
  ["bot", "upload"].forEach((tab) => {
    const button = el("button", "");
    button.type = "button";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", moteTab === tab ? "true" : "false");
    button.textContent = tab === "bot" ? "Bot" : "Upload";
    button.addEventListener("click", () => {
      moteTab = tab;
      renderMoteEditor();
    });
    tabs.append(button);
  });
  const actions = el("div", "mote-bar-actions");
  const surprise = el("button", "textish");
  surprise.type = "button";
  surprise.append(icon("sparkles", 13), document.createTextNode(" Surprise"));
  surprise.addEventListener("click", () => {
    markVisitor();
    avatars[currentId] = {
      kind: "mote",
      shapeId: MOTE_SHAPES[Math.floor(Math.random() * MOTE_SHAPES.length)].id,
      color: MOTE_COLORS[Math.floor(Math.random() * MOTE_COLORS.length)].value,
      motion: MOTE_MOTION[Math.floor(Math.random() * MOTE_MOTION.length)].id,
    };
    moteTab = "bot";
    paintAvatars();
    renderMoteEditor();
    announce("New local combination. Nothing left this page.");
  });
  const reset = el("button", "textish", "Reset");
  reset.type = "button";
  reset.addEventListener("click", () => {
    markVisitor();
    avatars[currentId] = { ...DEFAULT_AVATAR, color: avatar.color };
    moteTab = "bot";
    paintAvatars();
    renderMoteEditor();
    announce(`${name} reset to a default Mote.`);
  });
  actions.append(surprise, reset);
  bar.append(tabs, actions);
  moteEditor.append(bar);

  const body = el("div", "mote-editor-body");
  if (moteTab === "upload") {
    const panel = el("div", "mote-upload");
    panel.append(icon("image", 20), el("strong", "", "Use your own image"), el("p", "", "PNG, JPEG, or WebP. Cropped locally in this page — nothing is uploaded."));
    const picker = document.createElement("input");
    picker.type = "file";
    picker.accept = "image/png,image/jpeg,image/webp";
    picker.className = "visually-hidden";
    const choose = el("button", "panel-button", "Choose image");
    choose.type = "button";
    choose.addEventListener("click", () => picker.click());
    picker.addEventListener("change", () => {
      const file = picker.files?.[0];
      picker.value = "";
      if (file) void applyUpload(file);
    });
    panel.append(picker, choose);
    if (avatar.kind === "upload") {
      const remove = el("button", "textish", "Remove image");
      remove.type = "button";
      remove.addEventListener("click", () => {
        markVisitor();
        avatars[currentId] = { ...avatar, kind: "mote", imageDataUrl: undefined };
        paintAvatars();
        renderMoteEditor();
      });
      panel.append(remove);
    }
    body.append(panel);
  } else {
    const shapes = el("fieldset", "mote-fieldset");
    shapes.append(el("legend", "", "Shape"));
    const shapeGrid = el("div", "mote-shapes");
    MOTE_SHAPES.forEach((shape) => {
      const button = el("button", "mote-shape");
      button.type = "button";
      button.setAttribute("aria-label", `${shape.label}: ${shape.description}`);
      button.setAttribute("aria-pressed", avatar.shapeId === shape.id && avatar.kind === "mote" ? "true" : "false");
      button.append(renderMote({ ...avatar, kind: "mote", shapeId: shape.id }, 40));
      button.addEventListener("click", () => patchAvatar({ kind: "mote", shapeId: shape.id, imageDataUrl: undefined }));
      shapeGrid.append(button);
    });
    shapes.append(shapeGrid);

    const colors = el("fieldset", "mote-fieldset");
    colors.append(el("legend", "", "Color"));
    const swatches = el("div", "mote-swatches");
    MOTE_COLORS.forEach((color) => {
      const button = el("button", "mote-swatch");
      button.type = "button";
      button.setAttribute("aria-label", color.name);
      button.setAttribute("aria-pressed", avatar.color.toLowerCase() === color.value ? "true" : "false");
      button.style.background = color.value;
      if (avatar.color.toLowerCase() === color.value) {
        const mark = icon("check", 12);
        mark.style.color = getMoteEyeColor(color.value);
        button.append(mark);
      }
      button.addEventListener("click", () => patchAvatar({ color: color.value }));
      swatches.append(button);
    });
    colors.append(swatches);

    const motion = el("fieldset", "mote-fieldset");
    motion.append(el("legend", "", "Motion"));
    const motionRow = el("div", "mote-motion");
    MOTE_MOTION.forEach((level) => {
      const button = el("button", "");
      button.type = "button";
      button.title = level.description;
      button.textContent = level.label;
      button.setAttribute("aria-pressed", avatar.motion === level.id ? "true" : "false");
      button.addEventListener("click", () => patchAvatar({ motion: level.id }));
      motionRow.append(button);
    });
    motion.append(motionRow);
    body.append(shapes, colors, motion);
  }

  moteEditor.append(body);
}

function patchAvatar(patch) {
  markVisitor();
  avatars[currentId] = { ...avatars[currentId], ...patch };
  paintAvatars();
  renderMoteEditor();
}

async function applyUpload(file) {
  markVisitor();
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    announce("Choose a PNG, JPEG, or WebP image.");
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    announce("Choose an image smaller than 10 MB.");
    return;
  }

  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const node = new Image();
      node.onload = () => resolve(node);
      node.onerror = () => reject(new Error("Could not read that image."));
      node.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = 384;
    canvas.height = 384;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image processing is unavailable.");
    const scale = Math.max(384 / image.naturalWidth, 384 / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    context.drawImage(image, (384 - width) / 2, (384 - height) / 2, width, height);
    avatars[currentId] = { ...avatars[currentId], kind: "upload", imageDataUrl: canvas.toDataURL("image/webp", 0.76) };
    paintAvatars();
    renderMoteEditor();
    announce("Image stays in this page. Nothing was uploaded.");
  } catch (error) {
    announce(error instanceof Error ? error.message : "Could not use that image.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

function syncComposerAction() {
  if (!composerAction || !composerInput) return;
  const hasText = composerInput.value.trim().length > 0 || Boolean(pendingFile);
  composerAction.replaceChildren(icon(hasText ? "arrow-up" : "mic", 16));
  composerAction.classList.toggle("is-send", hasText);
  composerAction.setAttribute("aria-label", hasText ? "Send preview message" : "Voice dictation needs the desktop app");
}

function renderPendingFile() {
  if (!composerFiles) return;
  composerFiles.replaceChildren();
  if (!pendingFile) {
    composerFiles.hidden = true;
    return;
  }
  composerFiles.hidden = false;
  const chip = el("div", "file-chip");
  chip.append(el("span", "", pendingFile));
  const remove = el("button", "icon-btn");
  remove.type = "button";
  remove.setAttribute("aria-label", `Remove ${pendingFile}`);
  remove.append(icon("x", 12));
  remove.addEventListener("click", () => {
    pendingFile = null;
    renderPendingFile();
    syncComposerAction();
  });
  chip.append(remove);
  composerFiles.append(chip);
}

function sendPreview() {
  if (!composerInput || !messagesNode) return;
  const text = composerInput.value.trim();
  if (!text && !pendingFile) return;

  const threadId = currentId;
  markVisitor();
  const attachment = pendingFile;
  composerInput.value = "";
  pendingFile = null;
  renderPendingFile();
  composerInput.style.height = "auto";
  syncComposerAction();

  const body = attachment ? `${text || "Please review the attached file."}${text ? ` · ${attachment}` : ""}` : text;
  messagesNode.append(renderItem({ kind: "user", text: body }));
  const working = renderItem({ kind: "working" });
  messagesNode.append(working);
  scrollMessages();
  if (composerStatus) composerStatus.textContent = "Preview reply ready.";
  showComposerFeedback("Preview only · nothing was sent.");

  window.clearTimeout(replyTimer);
  replyTimer = window.setTimeout(() => {
    if (currentId !== threadId) return;
    working.remove();
    messagesNode.append(renderItem({ kind: "bot", text: SCENARIOS[threadId].reply }));
    scrollMessages();
  }, prefersReducedMotion() ? 0 : 700);
}

modelTrigger?.addEventListener("click", () => {
  markVisitor();
  setModelMenu(modelTrigger.getAttribute("aria-expanded") !== "true");
});

modelMenu?.querySelectorAll("button").forEach((option) => {
  option.addEventListener("click", () => {
    markVisitor();
    modelMenu.querySelectorAll("button").forEach((item) => item.setAttribute("aria-pressed", "false"));
    option.setAttribute("aria-pressed", "true");
    const provider = option.querySelector("span")?.textContent;
    const model = option.querySelector("strong")?.textContent;
    if (modelLabelNode) modelLabelNode.textContent = model;
    modelTrigger.dataset.provider = provider || "";
    if (modelProviderMark) {
      modelProviderMark.className = `provider-mark provider-mark-${(provider || "provider").toLowerCase()}`;
      if (provider === "Claude" && claudeProviderMark) {
        modelProviderMark.innerHTML = claudeProviderMark;
      } else if (provider === "OpenAI") {
        modelProviderMark.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.2a4.4 4.4 0 0 1 7.6 3.1 4.4 4.4 0 0 1 1.7 7.9 4.4 4.4 0 0 1-5.9 6.1 4.4 4.4 0 0 1-7.7-3 4.4 4.4 0 0 1-1.6-8A4.4 4.4 0 0 1 12 3.2Z"/><path d="m8.1 9.2 7.8 4.5M8 14.6l7.9-4.5M12 7.1v9.8"/></svg>';
      } else {
        modelProviderMark.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 2.5c.7 5.1 4.4 8.8 9.5 9.5-5.1.7-8.8 4.4-9.5 9.5-.7-5.1-4.4-8.8-9.5-9.5 5.1-.7 8.8-4.4 9.5-9.5Z"/></svg>';
      }
    }
    setModelMenu(false);
    announce(`${model} selected in this preview.`);
  });
});

computerButton?.addEventListener("click", () => {
  markVisitor();
  const open = computerButton.getAttribute("aria-expanded") !== "true";
  setComputerDrawer(open);
});
computerClose?.addEventListener("click", () => setComputerDrawer(false));
computerSettings?.addEventListener("click", () => {
  markVisitor();
  setMoteEditor(true);
  moteTrigger?.focus();
});

document.querySelectorAll("[data-run-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    markVisitor();
    setComputerMode(button.dataset.runMode);
  });
});

document.querySelector("[data-open-desktop]")?.addEventListener("click", () => {
  markVisitor();
  announce("Preview only — this page does not open a remote desktop.");
});

document.querySelector("[data-sleep]")?.addEventListener("click", () => {
  markVisitor();
  currentLocal().asleep = true;
  renderComputer();
  announce("Computer slept in this preview.");
});

document.querySelector("[data-create-routine]")?.addEventListener("click", () => {
  markVisitor();
  const count = currentLocal().routines.length + 1;
  currentLocal().routines.push(`Preview routine ${count}`);
  renderRoutines();
  announce("Routine added in this preview. It is not scheduled.");
});

moteTrigger?.addEventListener("click", () => {
  markVisitor();
  setMoteEditor(moteTrigger.getAttribute("aria-expanded") !== "true");
});

document.querySelector("[data-host-settings]")?.addEventListener("click", () => {
  markVisitor();
  setMoteEditor(true);
});

document.querySelector("[data-new-bot]")?.addEventListener("click", () => {
  markVisitor();
  announce("Creating a bot is preview-only on this page.");
});

document.querySelector("[data-plugins]")?.addEventListener("click", () => {
  markVisitor();
  announce("Plugins stay on your host. This preview does not install any.");
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  setModelMenu(false);
  setComputerDrawer(false);
  setMoteEditor(false);
});

document.addEventListener("pointerdown", (event) => {
  const target = event.target;
  if (modelMenu && !modelMenu.hidden && !modelMenu.contains(target) && !modelTrigger?.contains(target)) {
    setModelMenu(false);
  }
  if (moteEditor && !moteEditor.hidden && !moteEditor.contains(target) && !moteTrigger?.contains(target) && !computerSettings?.contains(target) && !event.target.closest?.("[data-host-settings]")) {
    setMoteEditor(false);
  }
});

if (demoRoot) {
  scenarioControls.forEach((control) => {
    control.addEventListener("click", () => {
      selectScenario(control.dataset.scenario, { manual: true });
    });
  });

  needsFilter?.addEventListener("click", () => {
    markVisitor();
    selectScenario("inbox", { manual: true });
    showConfigCard();
    const approval = messagesNode?.querySelector('[data-card="approval"]');
    approval?.scrollIntoView({ block: "nearest" });
  });

  hostTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      markVisitor();
      setHostOpen(!hostOpen);
    });
  });

  demoRoot.addEventListener("pointerenter", () => {
    hovered = true;
  });
  demoRoot.addEventListener("pointerleave", () => {
    hovered = false;
  });
  demoRoot.addEventListener("focusin", () => {
    focused = true;
  });
  demoRoot.addEventListener("focusout", (event) => {
    if (!demoRoot.contains(event.relatedTarget)) focused = false;
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      stopLoop();
      return;
    }
    if (inView) {
      if (prefersReducedMotion() || visitorActive) renderComplete(currentId);
      else {
        resetClock();
        applyStage(currentId, SCENARIOS[currentId].stages[0]);
        applied = 0;
        startLoop();
      }
    }
  });

  motionQuery.addEventListener("change", () => {
    stopLoop();
    if (prefersReducedMotion() || visitorActive) renderComplete(currentId);
    else {
      resetClock();
      applyStage(currentId, SCENARIOS[currentId].stages[0]);
      applied = 0;
      if (inView) startLoop();
    }
  });

  const observer = new IntersectionObserver(
    ([entry]) => {
      inView = Boolean(entry?.isIntersecting);
      if (!inView) {
        stopLoop();
        return;
      }
      if (prefersReducedMotion() || visitorActive) renderComplete(currentId);
      else startLoop();
    },
    { threshold: 0.28 },
  );
  observer.observe(demoRoot);

  paintAvatars();
  renderComplete("inbox");
  renderRoutines();
  if (!prefersReducedMotion()) {
    applied = SCENARIOS.inbox.stages.length - 1;
    elapsed = DURATION;
    completedAt = performance.now();
    scheduleConfigCard();
  }
}

composerRoot?.addEventListener("focusin", markVisitor);
composerRoot?.addEventListener("pointerdown", markVisitor);
composerAction?.addEventListener("click", () => {
  markVisitor();
  if (composerInput?.value.trim() || pendingFile) {
    sendPreview();
    return;
  }
  showComposerFeedback("Voice dictation needs the desktop app. Type a preview message instead.");
});
composerAttach?.addEventListener("click", () => composerFile?.click());
composerFile?.addEventListener("change", () => {
  const file = composerFile.files?.[0];
  composerFile.value = "";
  if (!file) return;
  markVisitor();
  pendingFile = file.name;
  renderPendingFile();
  syncComposerAction();
  showComposerFeedback("File stays in this page. Nothing is uploaded.");
});
composerInput?.addEventListener("keydown", (event) => {
  markVisitor();
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendPreview();
  }
});
composerInput?.addEventListener("input", () => {
  markVisitor();
  if (!composerInput) return;
  if (composerInput.value.length > INPUT_LIMIT) {
    composerInput.value = composerInput.value.slice(0, INPUT_LIMIT);
  }
  composerInput.style.height = "auto";
  composerInput.style.height = `${Math.min(composerInput.scrollHeight, 72)}px`;
  syncComposerAction();
});
syncComposerAction();

agentSearch?.addEventListener("input", () => {
  const query = agentSearch.value.trim().toLowerCase();
  demoRoot?.querySelectorAll(".agent").forEach((row) => {
    const name = row.querySelector("strong")?.textContent.toLowerCase() || "";
    row.hidden = Boolean(query) && !name.includes(query);
  });
});

const MOBILE_ORDER = ["chief", "sales", "inbox", "research"];
const mobileDemo = document.querySelector("[data-mobile-demo]");
const mobileHome = document.querySelector("[data-mobile-home]");
const mobileChat = document.querySelector("[data-mobile-chat]");
const mobileList = document.querySelector("[data-mobile-agent-list]");
const mobileMessages = document.querySelector("[data-mobile-messages]");
const mobileChatMote = document.querySelector("[data-mobile-chat-mote]");
const mobileChatName = document.querySelector("[data-mobile-chat-name]");
const mobileChatRole = document.querySelector("[data-mobile-chat-role]");
const mobileInput = document.querySelector("[data-mobile-input]");
let mobileId = "inbox";

function mobilePreview(id) {
  return {
    chief: ["Waiting on your venue approval", "Now", "Working"],
    sales: ["18 first-touch drafts held", "3:10 AM", "Needs you"],
    inbox: ["41 unread archived · Dana held", "12:11 AM", "Needs you"],
    research: ["Launch brief ready for review", "Yesterday", "Done"],
  }[id];
}

function renderMobileList() {
  if (!mobileList) return;
  mobileList.replaceChildren();
  MOBILE_ORDER.forEach((id) => {
    const [preview, time, state] = mobilePreview(id);
    const button = el("button", "mobile-agent-row");
    button.type = "button";
    button.dataset.mobileAgent = id;
    const mote = el("span", "mobile-row-mote");
    mote.append(renderMote(avatars[id], 48, state === "Working"));
    const copy = el("span", "mobile-row-copy");
    const title = el("span", "mobile-row-title");
    title.append(el("strong", "", SCENARIOS[id].name));
    if (state !== "Done") title.append(el("small", state === "Working" ? "is-working" : "is-needs", state));
    copy.append(title, el("span", "mobile-row-preview", preview));
    button.append(mote, copy, el("time", "", time));
    button.addEventListener("click", () => openMobileChat(id));
    mobileList.append(button);
  });
}

function renderMobileMessages(id) {
  if (!mobileMessages) return;
  mobileMessages.replaceChildren();
  SCENARIOS[id].complete.forEach((item) => {
    if (item.kind === "context") mobileMessages.append(el("p", "mobile-context", item.text));
    if (item.kind === "user") mobileMessages.append(el("p", "mobile-bubble mobile-user", item.text));
    if (item.kind === "bot") mobileMessages.append(el("p", "mobile-bubble mobile-bot", item.text));
    if (item.kind === "activity") mobileMessages.append(el("p", "mobile-activity", `✓  ${item.title}`));
    if (item.kind === "options") {
      const card = el("div", "mobile-needs-card");
      card.append(el("strong", "", item.card.title), el("p", "", item.card.subtitle));
      item.card.options.slice(0, 2).forEach((option) => {
        const button = el("button", "", option);
        button.type = "button";
        button.addEventListener("click", () => {
          card.classList.add("is-resolved");
          card.querySelectorAll("button").forEach((itemButton) => { itemButton.disabled = true; });
        });
        card.append(button);
      });
      mobileMessages.append(card);
    }
  });
  mobileMessages.scrollTop = mobileMessages.scrollHeight;
}

function openMobileChat(id) {
  if (!SCENARIOS[id] || !mobileHome || !mobileChat) return;
  mobileId = id;
  mobileChatName.textContent = SCENARIOS[id].name;
  mobileChatRole.textContent = SCENARIOS[id].role.replace("local host", "host online");
  mobileInput.placeholder = `Message ${SCENARIOS[id].name}`;
  mobileChatMote.replaceChildren(renderMote(avatars[id], 34));
  renderMobileMessages(id);
  mobileHome.hidden = true;
  mobileChat.hidden = false;
  mobileDemo?.classList.add("is-chat-open");
  document.querySelector("[data-mobile-back]")?.focus({ preventScroll: true });
}

document.querySelectorAll("[data-mobile-agent]").forEach((button) => {
  button.addEventListener("click", () => openMobileChat(button.dataset.mobileAgent));
});

document.querySelector("[data-mobile-back]")?.addEventListener("click", () => {
  mobileChat.hidden = true;
  mobileHome.hidden = false;
  mobileDemo?.classList.remove("is-chat-open");
});

document.querySelector("[data-mobile-composer]")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const message = mobileInput?.value.trim();
  if (!message || !mobileMessages) return;
  mobileMessages.append(el("p", "mobile-bubble mobile-user", message));
  mobileInput.value = "";
  window.setTimeout(() => {
    if (!mobileMessages) return;
    mobileMessages.append(el("p", "mobile-bubble mobile-bot", SCENARIOS[mobileId].reply));
    mobileMessages.scrollTop = mobileMessages.scrollHeight;
  }, prefersReducedMotion() ? 0 : 450);
  mobileMessages.scrollTop = mobileMessages.scrollHeight;
});

renderMobileList();

const JOBS = {
  chief: { status: "Working on your host", title: "Keep the week moving.", copy: "Coordinate the calendar, hold decisions that need your judgment, and keep every handoff visible.", proof: "Venue held · contract waiting for approval", shot: approvalShot, alt: "Illustrative Cumea approval request for a Chief of Staff agent" },
  sales: { status: "Drafts held for approval", title: "Research before outreach.", copy: "Read the account list, draft in your voice, and leave every message unsent until you approve it.", proof: "40 accounts · 18 drafts · 0 sent", shot: heroShot, alt: "Illustrative Cumea thread for a Sales Outbound agent" },
  inbox: { status: "Needs you", title: "Clear the noise, keep the judgment.", copy: "Archive routine mail, draft replies, and surface the one thread where your decision matters.", proof: "41 read · Dana held for your review", shot: approvalShot, alt: "Illustrative Cumea approval request for an Inbox Manager agent" },
  research: { status: "Brief ready", title: "Trace claims back to sources.", copy: "Compare material, organize the changes, and return a reviewable brief without publishing it.", proof: "4 changes · sources attached · 0 published", shot: marketplaceShot, alt: "Illustrative Cumea tool view for a Research Analyst agent" },
};

const EVIDENCE = {
  thread: {
    title: "Thread",
    caption: "Conversation, actions, and audit trail stay readable in one place.",
    alt: "Cumea thread with tool activity and an approval request",
    shot: heroShot,
  },
  approval: {
    title: "Approval",
    caption: "A specific choice returns to the thread before the agent continues.",
    alt: "Cumea approval request with specific response choices",
    shot: approvalShot,
  },
  computer: {
    title: "Computer",
    caption: "The optional computer runtime stays visible beside the agent that uses it.",
    alt: "Cumea computer panel beside an agent conversation",
    shot: computerShot,
  },
};

Object.values(EVIDENCE).forEach((item) => {
  const preload = new Image();
  preload.src = item.shot;
});

function markTabs(buttons, active) {
  buttons.forEach((item) => {
    const selected = item === active;
    item.setAttribute("aria-selected", String(selected));
    item.tabIndex = selected ? 0 : -1;
  });
}

function bindArrowKeys(buttons) {
  buttons.forEach((button, index) => {
    button.addEventListener("keydown", (event) => {
      if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      let next = index;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % buttons.length;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = buttons.length - 1;
      buttons[next].focus();
      buttons[next].click();
    });
  });
}

const evidenceButtons = [...document.querySelectorAll("[data-evidence]")];
const evidenceFrame = document.querySelector(".evidence-frame");
const evidenceImage = document.querySelector("[data-evidence-image]");
const evidenceNext = document.querySelector("[data-evidence-next]");
const evidenceTitle = document.querySelector("[data-evidence-title]");
const evidenceCaption = document.querySelector("[data-evidence-caption]");
let evidenceSwapTimer;

evidenceButtons.forEach((button) => {
  button.addEventListener("click", (event) => {
    const item = EVIDENCE[button.dataset.evidence];
    if (!item || !evidenceImage) return;
    markTabs(evidenceButtons, button);
    evidenceFrame?.setAttribute("aria-labelledby", button.id);
    if (evidenceTitle) evidenceTitle.textContent = item.title;
    if (evidenceCaption) evidenceCaption.textContent = item.caption;
    window.clearTimeout(evidenceSwapTimer);
    if (event.detail === 0 || prefersReducedMotion() || !evidenceNext) {
      evidenceFrame?.classList.remove("is-switching");
      evidenceImage.src = item.shot;
      evidenceImage.alt = item.alt;
      return;
    }
    evidenceNext.src = item.shot;
    evidenceNext.alt = "";
    window.requestAnimationFrame(() => evidenceFrame?.classList.add("is-switching"));
    evidenceSwapTimer = window.setTimeout(() => {
      evidenceImage.src = item.shot;
      evidenceImage.alt = item.alt;
      evidenceFrame?.classList.remove("is-switching");
    }, 180);
  });
});
markTabs(evidenceButtons, evidenceButtons[0]);
bindArrowKeys(evidenceButtons);

document.querySelectorAll("[data-role-mote]").forEach((slot) => {
  slot.replaceChildren(renderMote(avatars[slot.dataset.roleMote] ?? DEFAULT_AVATAR, 32));
});

const jobButtons = [...document.querySelectorAll("[data-job]")];
jobButtons.forEach((button) => {
  button.addEventListener("click", (event) => {
    const job = JOBS[button.dataset.job];
    if (!job) return;
    markTabs(jobButtons, button);
    const stage = document.querySelector("[data-job-scene]");
    stage?.setAttribute("aria-labelledby", button.id);
    if (event.detail !== 0 && !prefersReducedMotion()) stage?.classList.add("is-switching");
    document.querySelector("[data-job-status]").textContent = job.status;
    document.querySelector("[data-job-title]").textContent = job.title;
    document.querySelector("[data-job-copy]").textContent = job.copy;
    document.querySelector("[data-job-proof]").textContent = job.proof;
    const image = document.querySelector("[data-job-scene] img");
    if (image) {
      image.src = job.shot;
      image.alt = job.alt;
    }
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => stage?.classList.remove("is-switching")));
  });
});
markTabs(jobButtons, jobButtons[0]);
bindArrowKeys(jobButtons);
