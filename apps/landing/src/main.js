import "./styles.css";

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

document.querySelector(".skip-link")?.addEventListener("click", () => {
  window.setTimeout(() => document.querySelector("#main")?.focus({ preventScroll: true }), 0);
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
