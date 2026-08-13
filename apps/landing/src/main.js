import "./styles.css";
import heroShot from "../../../docs/screenshots/hero.png";
import computerShot from "../../../docs/screenshots/computer-panel.png";
import approvalShot from "../../../docs/screenshots/approval-card.png";
import modelShot from "../../../docs/screenshots/model-picker.png";
import marketplaceShot from "../../../docs/screenshots/marketplace.png";

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

const releaseLink = document.querySelector("[data-release-link]");
if (releaseLink) releaseLink.href = `${repositoryUrl}/releases/tag/v0.1.0`;

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

const ORDER = ["inbox", "sales", "chief"];
const DURATION = 17500;
const DWELL = 3200;
const MANUAL_PAUSE = 15000;
const INPUT_LIMIT = 280;

const SCENARIOS = {
  inbox: {
    name: "Atlas",
    role: "Mail · local host",
    computer: "Atlas’s computer",
    routines: [
      ["Morning sweep", "Weekdays 8am"],
      ["Reply Zero", "Hourly"],
    ],
    chips: ["Gmail", "Calendar", "Linear"],
    reply: "Noted. I’ll keep this in the preview thread — nothing was sent from this page.",
    complete: [
      { kind: "context", text: "Morning sweep finished · 12 newsletters archived" },
      { kind: "user", text: "clear friday’s unread. hold anything from dana." },
      { kind: "bot", text: "41 unread since friday. I’m archiving the noise and drafting the rest." },
      {
        kind: "tool",
        title: "Read mail",
        note: "Optional connected app · example only",
      },
      {
        kind: "results",
        rows: [
          ["Archived", "26 newsletters + receipts"],
          ["Replied", "9 routine threads · scheduling and intros"],
          ["Drafted", "6 that sound like you · held for your read"],
          ["Flagged", "1 from dana · contract question"],
        ],
      },
      { kind: "needs", text: "Dana’s renewal — approve the draft that quotes the contract?" },
      { kind: "user", text: "send dana’s. I’ll take the rest tomorrow" },
      { kind: "bot", text: "Marked as approved in this preview. Inbox at zero, 5 drafts parked. Nothing left this page." },
    ],
    stages: [
      { at: 0, type: "context", text: "Morning sweep finished · 12 newsletters archived", preview: "1 item waiting for your read", state: "Idle", status: "Idle", step: "Waiting", tone: "done", lines: ["$ cumea run --local"] },
      { at: 1400, type: "user", text: "clear friday’s unread. hold anything from dana.", preview: "clear friday’s unread…", state: "Working", status: "Running", step: "Reading thread", tone: "running", lines: ["$ cumea run --local", "› inbox opened"] },
      { at: 2600, type: "working" },
      { at: 4200, type: "stream", text: "41 unread since friday. I’m archiving the noise and drafting the rest." },
      { at: 7600, type: "tool", title: "Read mail", note: "Optional connected app · example only", lines: ["$ cumea run --local", "› gmail — 41 threads read"] },
      {
        at: 9200,
        type: "results",
        rows: [
          ["Archived", "26 newsletters + receipts"],
          ["Replied", "9 routine threads · scheduling and intros"],
          ["Drafted", "6 that sound like you · held for your read"],
          ["Flagged", "1 from dana · contract question"],
        ],
        lines: ["$ cumea run --local", "› gmail — 41 threads read", "› archived 26 · drafted 6"],
      },
      { at: 12200, type: "needs", text: "Dana’s renewal — approve the draft that quotes the contract?", preview: "waiting for your read", state: "Needs you", status: "Needs you", step: "Waiting for approval", tone: "needs", lines: ["$ cumea run --local", "› gmail — 41 threads read", "› archived 26 · drafted 6", "› held: 1 for your read"] },
      { at: 14800, type: "user", text: "send dana’s. I’ll take the rest tomorrow" },
      { at: 16200, type: "bot", text: "Marked as approved in this preview. Inbox at zero, 5 drafts parked. Nothing left this page.", preview: "sent. inbox at zero, 5 drafts parked", state: "Done", status: "Done", step: "Held 5 drafts", tone: "done" },
    ],
  },
  sales: {
    name: "Pixel",
    role: "Outreach · local host",
    computer: "Pixel’s computer",
    routines: [
      ["Daily list", "Weekdays 7am"],
      ["Follow-up pass", "Hourly"],
    ],
    chips: ["Mail", "Sheets", "Calendar"],
    reply: "Got it. In Cumea that would stay a draft until you approve.",
    complete: [
      { kind: "context", text: "Daily list ready · 40 accounts" },
      { kind: "user", text: "work last week’s list. don’t send anything." },
      { kind: "bot", text: "40 accounts. I drafted 18 first-touch notes in your voice and held them." },
      { kind: "tool", title: "Read list", note: "Optional connected app · example only" },
      {
        kind: "results",
        rows: [
          ["Researched", "40 accounts on the list"],
          ["Drafted", "18 first-touch notes · held"],
          ["Skipped", "20 already in a live thread"],
          ["Flagged", "2 that need a warmer intro"],
        ],
      },
      { kind: "needs", text: "Send the first six drafts from your host?" },
      { kind: "user", text: "send the first six. park the rest." },
      { kind: "bot", text: "Queued as drafts in this preview. Nothing left your machine." },
    ],
    stages: [
      { at: 0, type: "context", text: "Daily list ready · 40 accounts", preview: "drafting first-touch notes…", state: "Unread", status: "Idle", step: "List ready", tone: "done", lines: ["$ cumea run --local"] },
      { at: 1400, type: "user", text: "work last week’s list. don’t send anything.", state: "Working", status: "Running", step: "Reading list", tone: "running", lines: ["$ cumea run --local", "› list opened"] },
      { at: 2600, type: "working" },
      { at: 4200, type: "stream", text: "40 accounts. I drafted 18 first-touch notes in your voice and held them." },
      { at: 7600, type: "tool", title: "Read list", note: "Optional connected app · example only", lines: ["$ cumea run --local", "› list — 40 accounts read"] },
      {
        at: 9200,
        type: "results",
        rows: [
          ["Researched", "40 accounts on the list"],
          ["Drafted", "18 first-touch notes · held"],
          ["Skipped", "20 already in a live thread"],
          ["Flagged", "2 that need a warmer intro"],
        ],
        lines: ["$ cumea run --local", "› list — 40 accounts read", "› drafted 18 · held 18"],
      },
      { at: 12200, type: "needs", text: "Send the first six drafts from your host?", preview: "waiting for your send", state: "Needs you", status: "Needs you", step: "Waiting for approval", tone: "needs", lines: ["$ cumea run --local", "› list — 40 accounts read", "› drafted 18 · held 18", "› waiting for your send"] },
      { at: 14800, type: "user", text: "send the first six. park the rest." },
      { at: 16200, type: "bot", text: "Queued as drafts in this preview. Nothing left your machine.", preview: "done. 40 accounts researched, 18…", state: "Done", status: "Done", step: "Drafts held", tone: "done" },
    ],
  },
  chief: {
    name: "Scout",
    role: "Calendar · local host",
    computer: "Scout’s computer",
    routines: [
      ["Weekly brief", "Mondays 9am"],
      ["Calendar sweep", "Weekdays 8am"],
    ],
    chips: ["Calendar", "Mail", "Notes"],
    computerPreview: true,
    reply: "Understood. I’ll wait for you — this page did not change your calendar.",
    complete: [
      { kind: "context", text: "Thursday offsite · venue still open" },
      { kind: "user", text: "book the venue and send me the contract." },
      { kind: "bot", text: "Venue is held. The contract is ready for your signature line." },
      { kind: "tool", title: "Local computer", note: "Optional computer use · example only" },
      {
        kind: "results",
        rows: [
          ["Booked", "venue confirmed for thursday"],
          ["Sent", "contract held for your signature"],
          ["Drafted", "run-of-show · held"],
          ["Flagged", "1 catering question"],
        ],
      },
      { kind: "needs", text: "Catering asked about headcount. Reply from your host?" },
      { kind: "user", text: "I’ll sign tonight. hold catering." },
      { kind: "bot", text: "Parked. I’ll wait — this page did not sign or send." },
    ],
    stages: [
      { at: 0, type: "context", text: "Thursday offsite · venue still open", preview: "venue booked, contract sent for si…", state: "Working", status: "Idle", step: "Calendar open", tone: "done", lines: ["$ cumea run --local"], previewComputer: true },
      { at: 1400, type: "user", text: "book the venue and send me the contract.", status: "Running", step: "Checking calendar", tone: "running", lines: ["$ cumea run --local", "› calendar opened"], previewComputer: true },
      { at: 2600, type: "working" },
      { at: 4200, type: "stream", text: "Venue is held. The contract is ready for your signature line." },
      { at: 7600, type: "tool", title: "Local computer", note: "Optional computer use · example only", lines: ["$ cumea run --local", "› calendar — venue locked"], previewComputer: true },
      {
        at: 9200,
        type: "results",
        rows: [
          ["Booked", "venue confirmed for thursday"],
          ["Sent", "contract held for your signature"],
          ["Drafted", "run-of-show · held"],
          ["Flagged", "1 catering question"],
        ],
        lines: ["$ cumea run --local", "› calendar — venue locked", "› contract sent · 1 held"],
        previewComputer: true,
      },
      { at: 12200, type: "needs", text: "Catering asked about headcount. Reply from your host?", preview: "waiting on you", state: "Needs you", status: "Needs you", step: "Waiting for approval", tone: "needs", lines: ["$ cumea run --local", "› calendar — venue locked", "› contract sent · 1 held", "› waiting on you"], previewComputer: true },
      { at: 14800, type: "user", text: "I’ll sign tonight. hold catering." },
      { at: 16200, type: "bot", text: "Parked. I’ll wait — this page did not sign or send.", preview: "venue booked, contract sent for si…", state: "Done", status: "Done", step: "Held for signature", tone: "done", previewComputer: true },
    ],
  },
};

const JOBS = {
  inbox: {
    tab: "job-tab-inbox",
    title: "Inbox Manager",
    body: "Named thread on your host. Reads mail through an optional connected app, drafts in your voice, and stops at Needs You before anything leaves.",
    items: ["41 threads read · 26 archived", "6 drafts held · 1 flagged for you", "No send until you approve"],
  },
  research: {
    tab: "job-tab-research",
    title: "Research Agent",
    body: "A persistent thread that reads notes you attach on the host and returns a held brief. It does not invent a web connection this page does not have.",
    items: ["Source notes read on the host", "Brief drafted and held", "Handoff back to Chief of Staff, limit 2"],
  },
  chief: {
    tab: "job-tab-chief",
    title: "Chief of Staff",
    body: "Coordinates calendar and held documents. Optional local computer use appears only when that runtime supports it.",
    items: ["Venue held · contract parked", "One catering question in Needs You", "No signature from this page"],
  },
  triage: {
    tab: "job-tab-triage",
    title: "Bug Triage",
    body: "Reproduces reports in a named thread and files steps for you. Tool access still depends on the runtime you configured.",
    items: ["4 of 6 reports reproduced", "Steps parked in the issue thread", "Two items still need you"],
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
const agentName = document.querySelector("[data-agent-name]");
const agentRole = document.querySelector("[data-agent-role]");
const headerState = document.querySelector("[data-header-state]");
const terminalNode = document.querySelector("[data-terminal]");
const computerNode = document.querySelector("[data-computer]");
const computerPreview = document.querySelector("[data-computer-preview]");
const routinesNode = document.querySelector("[data-routines]");
const chipsNode = document.querySelector("[data-chips]");
const runLabel = document.querySelector("[data-run-label]");
const runStep = document.querySelector("[data-run-step]");
const scenarioControls = document.querySelectorAll("[data-scenario]");
const composerRoot = document.querySelector("[data-composer]");
const composerInput = document.querySelector("[data-composer-input]");
const composerSend = document.querySelector("[data-composer-send]");
const composerStatus = document.querySelector("[data-composer-status]");
const agentSearch = document.querySelector("[data-agent-search]");
const needsFilter = document.querySelector("[data-needs-filter]");
const hostTab = document.querySelector("[data-host-tab]");
const hostSheet = document.querySelector("[data-host-sheet]");
const conversationRoot = document.querySelector(".conversation");
const modelTrigger = document.querySelector("[data-model-trigger]");
const modelMenu = document.querySelector("[data-model-menu]");
const computerButton = document.querySelector("[data-computer-btn]");
const computerDrawer = document.querySelector("[data-computer-drawer]");
const computerClose = document.querySelector("[data-computer-close]");
const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

let currentId = "inbox";
let elapsed = 0;
let lastTick = 0;
let applied = -1;
let streamTimer = 0;
let replyTimer = 0;
let resultTimers = [];
let raf = 0;
let resumeAt = 0;
let completedAt = 0;
let inView = false;
let hovered = false;
let focused = false;
let userTookOver = false;
let hostOpen = false;

function prefersReducedMotion() {
  return motionQuery.matches;
}

function pauseFromComposer() {
  userTookOver = true;
  resumeAt = Date.now() + MANUAL_PAUSE;
}

function canRunTimeline() {
  return (
    !prefersReducedMotion() &&
    !userTookOver &&
    !hostOpen &&
    document.visibilityState === "visible" &&
    inView &&
    !hovered &&
    !focused
  );
}

function canRotate() {
  return (
    !prefersReducedMotion() &&
    !userTookOver &&
    !hostOpen &&
    document.visibilityState === "visible" &&
    inView &&
    !hovered &&
    !focused &&
    Date.now() >= resumeAt &&
    completedAt > 0
  );
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

function renderItem(item) {
  if (item.kind === "context") return enterClass(el("p", "context-line", item.text));
  if (item.kind === "user") return enterClass(el("p", "message user", item.text));
  if (item.kind === "bot") return enterClass(el("p", "message bot", item.text));
  if (item.kind === "working") return enterClass(el("p", "message working-note", "Working…"));
  if (item.kind === "tool") {
    const card = enterClass(el("div", "tool-card"));
    card.append(el("span", "", "Task"), el("strong", "", item.title), el("small", "", item.note));
    return card;
  }
  if (item.kind === "needs") {
    const card = enterClass(el("div", "needs-card"));
    card.append(el("strong", "", "Needs you"), el("p", "", item.text));
    return card;
  }
  if (item.kind === "results") {
    const box = enterClass(el("div", "result"));
    item.rows.forEach(([label, detail]) => {
      const row = el("p", "");
      row.append(el("b", "", `✓ ${label}`), el("span", "", detail));
      box.append(row);
    });
    return box;
  }
  return enterClass(el("p", "message bot", item.text || ""));
}

function scrollMessages() {
  if (!messagesNode) return;
  messagesNode.scrollTop = messagesNode.scrollHeight;
}

function setPanel({ status, step, tone, lines, previewComputer }) {
  if (runLabel && status) {
    runLabel.textContent = status;
    runLabel.dataset.tone = tone || "needs";
  }
  if (runStep && step) runStep.textContent = step;
  if (terminalNode && lines) {
    terminalNode.innerHTML = lines
      .map((line, index) => (index === 0 ? `<b>$</b> ${line.replace(/^\$\s*/, "")}` : `<span>${line}</span>`))
      .join("<br />");
  }
  computerPreview?.classList.toggle("is-hidden", !previewComputer);
}

function setHeader(id, stage) {
  const scenario = SCENARIOS[id];
  const source = demoRoot?.querySelector(`button.agent[data-scenario="${id}"]`);
  const mote = source?.querySelector(".mote-avatar");

  if (mote && headerMote) {
    headerMote.setAttribute(
      "class",
      `mote-avatar small ${[...mote.classList].filter((name) => name !== "mote-avatar").join(" ")}`,
    );
    const dest = headerMote.querySelector(".mote-body");
    const src = mote.querySelector(".mote-body");
    if (dest && src) dest.setAttribute("d", src.getAttribute("d"));
  }

  headerMote?.classList.toggle("is-working", stage?.type === "working" || stage?.state === "Working");
  if (agentName) agentName.textContent = scenario.name;
  if (agentRole) agentRole.textContent = scenario.role;
  if (headerState) {
    const label = stage?.state || stage?.status || "Idle";
    headerState.innerHTML = `<i></i> ${label}`;
    headerState.classList.toggle("is-needs", /need/i.test(label));
  }
  if (composerInput) composerInput.placeholder = `Message ${scenario.name}`;
  const labelEl = document.querySelector("label[for='composer-input']");
  if (labelEl) labelEl.textContent = `Message ${scenario.name}`;

  if (source) {
    const preview = source.querySelector("[data-preview]");
    const state = source.querySelector("[data-state]");
    if (preview && stage?.preview) preview.textContent = stage.preview;
    if (state && stage?.state) {
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

  if (computerNode) computerNode.textContent = scenario.computer;
  if (routinesNode) {
    routinesNode.innerHTML = scenario.routines
      .map(([title, when]) => `<div class="routine"><i></i><span><b>${title}</b><small>${when}</small></span></div>`)
      .join("");
  }
  if (chipsNode) chipsNode.innerHTML = scenario.chips.map((chip) => `<span>${chip}</span>`).join("");
}

function clearSoftTimers() {
  window.clearTimeout(streamTimer);
  window.clearTimeout(replyTimer);
  resultTimers.forEach((id) => window.clearTimeout(id));
  resultTimers = [];
  streamTimer = 0;
  replyTimer = 0;
}

function setHostOpen(open) {
  hostOpen = open;
  if (hostSheet) hostSheet.hidden = !open;
  conversationRoot?.classList.toggle("is-host", open);
  hostTab?.setAttribute("aria-pressed", open ? "true" : "false");
  if (open) {
    scenarioControls.forEach((control) => {
      if (control.closest(".scenario-tabs")) control.setAttribute("aria-pressed", "false");
    });
  } else {
    scenarioControls.forEach((control) => {
      const on = control.dataset.scenario === currentId;
      control.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }
}

function renderComplete(id) {
  const scenario = SCENARIOS[id];
  if (!messagesNode) return;
  messagesNode.replaceChildren();
  scenario.complete.forEach((item) => messagesNode.append(renderItem(item)));
  const last = scenario.stages[scenario.stages.length - 1];
  setHeader(id, last);
  setPanel(last);
  scrollMessages();
}

function applyStage(id, stage) {
  if (!messagesNode) return;

  if (stage.type === "context") {
    messagesNode.replaceChildren();
    messagesNode.append(renderItem({ kind: "context", text: stage.text }));
  } else if (stage.type === "user" || stage.type === "bot") {
    messagesNode.append(renderItem({ kind: stage.type, text: stage.text }));
  } else if (stage.type === "working") {
    messagesNode.append(renderItem({ kind: "working" }));
  } else if (stage.type === "stream") {
    const note = messagesNode.querySelector(".working-note");
    note?.remove();
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
  } else if (stage.type === "tool") {
    messagesNode.append(renderItem({ kind: "tool", title: stage.title, note: stage.note }));
  } else if (stage.type === "needs") {
    messagesNode.append(renderItem({ kind: "needs", text: stage.text }));
  } else if (stage.type === "results") {
    const box = enterClass(el("div", "result"));
    messagesNode.append(box);
    stage.rows.forEach((row, index) => {
      const write = () => {
        const line = el("p", "");
        line.append(el("b", "", `✓ ${row[0]}`), el("span", "", row[1]));
        box.append(line);
        scrollMessages();
      };
      if (prefersReducedMotion()) write();
      else {
        resultTimers.push(
          window.setTimeout(() => {
            if (currentId !== id) return;
            write();
          }, index * 220),
        );
      }
    });
  }

  setHeader(id, stage);
  setPanel(stage);
  scrollMessages();
}

function resetClock() {
  elapsed = 0;
  lastTick = 0;
  applied = -1;
  completedAt = 0;
  clearSoftTimers();
}

function selectScenario(id, { manual = false } = {}) {
  if (!SCENARIOS[id]) return;
  clearSoftTimers();
  currentId = id;
  resetClock();
  setHostOpen(false);
  if (manual) {
    userTookOver = true;
    resumeAt = Date.now() + MANUAL_PAUSE;
  }
  setHeader(id, SCENARIOS[id].stages[0]);
  setPanel(SCENARIOS[id].stages[0]);
  if (prefersReducedMotion()) renderComplete(id);
  else {
    applyStage(id, SCENARIOS[id].stages[0]);
    applied = 0;
  }
}

function tick(now) {
  if (userTookOver && Date.now() >= resumeAt && !focused) {
    userTookOver = false;
  }

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
  if (prefersReducedMotion() || raf) return;
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
  if (open) setModelMenu(false);
}

modelTrigger?.addEventListener("click", () => {
  setModelMenu(modelTrigger.getAttribute("aria-expanded") !== "true");
});

modelMenu?.querySelectorAll("button").forEach((option) => {
  option.addEventListener("click", () => {
    modelMenu.querySelectorAll("button").forEach((item) => item.setAttribute("aria-pressed", "false"));
    option.setAttribute("aria-pressed", "true");
    const provider = option.querySelector("span")?.textContent;
    const model = option.querySelector("strong")?.textContent;
    modelTrigger.childNodes[0].textContent = `${provider === "Claude" ? "Claude " : ""}${model} `;
    setModelMenu(false);
  });
});

computerButton?.addEventListener("click", () => {
  setComputerDrawer(computerButton.getAttribute("aria-expanded") !== "true");
});
computerClose?.addEventListener("click", () => setComputerDrawer(false));

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  setModelMenu(false);
  setComputerDrawer(false);
});

document.addEventListener("pointerdown", (event) => {
  if (!modelMenu || modelMenu.hidden) return;
  if (!modelMenu.contains(event.target) && !modelTrigger?.contains(event.target)) setModelMenu(false);
});

if (demoRoot) {
  scenarioControls.forEach((control) => {
    control.addEventListener("click", () => {
      selectScenario(control.dataset.scenario, { manual: true });
    });
  });

  needsFilter?.addEventListener("click", () => {
    selectScenario("inbox", { manual: true });
  });

  hostTab?.addEventListener("click", () => {
    pauseFromComposer();
    setHostOpen(true);
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
      if (prefersReducedMotion()) renderComplete(currentId);
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
    if (prefersReducedMotion()) renderComplete(currentId);
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
      if (prefersReducedMotion()) renderComplete(currentId);
      else startLoop();
    },
    { threshold: 0.28 },
  );
  observer.observe(demoRoot);

  if (prefersReducedMotion()) renderComplete("inbox");
}

function sendPreview() {
  if (!composerInput || !messagesNode) return;
  const text = composerInput.value.trim();
  if (!text) return;

  const threadId = currentId;
  pauseFromComposer();
  composerInput.value = "";
  if (composerSend) composerSend.disabled = true;

  if (currentId !== threadId) {
    if (composerSend) composerSend.disabled = false;
    return;
  }

  messagesNode.append(renderItem({ kind: "user", text }));
  const working = renderItem({ kind: "working" });
  messagesNode.append(working);
  scrollMessages();
  if (composerStatus) composerStatus.textContent = "Preview reply ready.";

  window.clearTimeout(replyTimer);
  replyTimer = window.setTimeout(() => {
    if (currentId !== threadId) return;
    working.remove();
    messagesNode.append(renderItem({ kind: "bot", text: SCENARIOS[threadId].reply }));
    scrollMessages();
    if (composerSend) composerSend.disabled = false;
  }, prefersReducedMotion() ? 0 : 700);
}

composerRoot?.addEventListener("focusin", pauseFromComposer);
composerRoot?.addEventListener("pointerdown", pauseFromComposer);
composerSend?.addEventListener("click", sendPreview);
composerInput?.addEventListener("keydown", (event) => {
  pauseFromComposer();
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendPreview();
  }
});
composerInput?.addEventListener("input", () => {
  pauseFromComposer();
  if (!composerInput) return;
  if (composerInput.value.length > INPUT_LIMIT) {
    composerInput.value = composerInput.value.slice(0, INPUT_LIMIT);
  }
  composerInput.style.height = "auto";
  composerInput.style.height = `${Math.min(composerInput.scrollHeight, 72)}px`;
  if (composerSend) composerSend.disabled = composerInput.value.trim().length === 0;
});
if (composerSend) composerSend.disabled = true;

agentSearch?.addEventListener("input", () => {
  const query = agentSearch.value.trim().toLowerCase();
  demoRoot?.querySelectorAll(".agent").forEach((row) => {
    const name = row.querySelector("strong")?.textContent.toLowerCase() || "";
    row.hidden = Boolean(query) && !name.includes(query);
  });
});

const jobPanel = document.querySelector("[data-job-panel]");
const jobTabs = document.querySelectorAll("[data-job]");

function showJob(id) {
  const job = JOBS[id];
  if (!job || !jobPanel) return;
  jobTabs.forEach((tab) => {
    const on = tab.dataset.job === id;
    tab.setAttribute("aria-selected", on ? "true" : "false");
  });
  jobPanel.setAttribute("aria-labelledby", job.tab);
  jobPanel.innerHTML = `
    <p class="job-kicker">Run summary · illustrative</p>
    <h3>${job.title}</h3>
    <p>${job.body}</p>
    <ul>${job.items.map((item) => `<li>${item}</li>`).join("")}</ul>
  `;
}

jobTabs.forEach((tab) => {
  tab.addEventListener("click", () => showJob(tab.dataset.job));
  tab.addEventListener("keydown", (event) => {
    const list = [...jobTabs];
    const index = list.indexOf(tab);
    if (event.key === "ArrowRight") {
      event.preventDefault();
      list[(index + 1) % list.length].focus();
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      list[(index - 1 + list.length) % list.length].focus();
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      showJob(tab.dataset.job);
    }
  });
});

const miniChat = document.querySelector("[data-mini-chat]");
if (miniChat) {
  const steps = [...miniChat.querySelectorAll("[data-mini-step]")];
  const showMini = (animate) => {
    steps.forEach((node, index) => {
      node.hidden = animate;
      if (animate) {
        window.setTimeout(() => {
          node.hidden = false;
          node.classList.add("msg-enter");
        }, 400 + index * 900);
      }
    });
  };

  if (prefersReducedMotion()) showMini(false);
  else {
    steps.forEach((node) => {
      node.hidden = true;
    });
    const miniObserver = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        showMini(true);
        miniObserver.disconnect();
      },
      { threshold: 0.4 },
    );
    miniObserver.observe(miniChat);
  }
}
