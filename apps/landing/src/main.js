import "./styles.css";

const DEFAULT_REPOSITORY = "https://github.com/metaforismo/Cumea";
const CLONE_COMMAND = `git clone ${DEFAULT_REPOSITORY}.git`;

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
const macDownloadUrl = normalizeHttpsUrl(import.meta.env.VITE_CUMEA_MAC_DOWNLOAD_URL);

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // The older fallback below keeps the action useful in non-secure local previews.
    }
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

document.querySelectorAll(`a[href^="${DEFAULT_REPOSITORY}"]`).forEach((link) => {
  const suffix = link.href.slice(DEFAULT_REPOSITORY.length);
  link.href = `${repositoryUrl}${suffix}`;
});

document.querySelectorAll("[data-download-link]").forEach((link) => {
  if (macDownloadUrl) {
    link.href = macDownloadUrl;
    link.removeAttribute("aria-disabled");
    link.removeAttribute("aria-describedby");
    link.removeAttribute("data-disabled");
  } else {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      document.querySelector("#download")?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  }
});

if (macDownloadUrl) {
  const availability = document.querySelector("#download-status");
  if (availability) availability.textContent = "Signed release available from the configured download URL.";
}

const header = document.querySelector("[data-site-header]");
const syncHeader = () => header?.classList.toggle("is-scrolled", window.scrollY > 8);
syncHeader();
window.addEventListener("scroll", syncHeader, { passive: true });

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
document.documentElement.classList.add("reveal-ready");

if (reduceMotion || !("IntersectionObserver" in window)) {
  document.querySelectorAll("[data-reveal]").forEach((element) => element.classList.add("is-visible"));
} else {
  const revealObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    { rootMargin: "0px 0px -10%", threshold: 0.08 },
  );
  document.querySelectorAll("[data-reveal]").forEach((element) => revealObserver.observe(element));
}

const copyButton = document.querySelector("[data-copy-command]");
const copyToast = document.querySelector("[data-copy-toast]");
let copyResetTimer;

copyButton?.addEventListener("click", async () => {
  try {
    await copyText(CLONE_COMMAND.replace(DEFAULT_REPOSITORY, repositoryUrl));
    copyButton.textContent = "Copied";
    copyToast?.classList.add("is-visible");
    window.clearTimeout(copyResetTimer);
    copyResetTimer = window.setTimeout(() => {
      copyButton.textContent = "Copy";
      copyToast?.classList.remove("is-visible");
    }, 1800);
  } catch {
    copyButton.textContent = "Copy unavailable";
  }
});

const year = document.querySelector("[data-year]");
if (year) year.textContent = String(new Date().getFullYear());
