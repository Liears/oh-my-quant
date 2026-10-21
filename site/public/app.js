import { messages } from "/messages.js";

const root = document.documentElement;
const text = messages[root.lang === "en" ? "en" : "zh"];
const storageKey = "whyj-quant-site-preferences-v1";
const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const defaults = () => ({
  market: "red-up",
  overview: true,
  motion: motionQuery.matches,
});
let preferences = defaults();
let storageAvailable = true;
try {
  const stored = JSON.parse(localStorage.getItem(storageKey) ?? "null");
  if (stored && typeof stored === "object") {
    preferences = {
      market: stored.market === "green-up" ? "green-up" : "red-up",
      overview: typeof stored.overview === "boolean" ? stored.overview : true,
      motion:
        typeof stored.motion === "boolean"
          ? stored.motion
          : motionQuery.matches,
    };
  }
} catch {
  storageAvailable = false;
}

const colorSelect = document.querySelector("#market-colors");
const overviewToggle = document.querySelector("#overview-toggle");
const motionToggle = document.querySelector("#motion-toggle");
const settingsStatus = document.querySelector("#settings-status");

function applyPreferences(save = false) {
  root.dataset.market = preferences.market;
  root.classList.toggle("no-overview", !preferences.overview);
  root.classList.toggle("no-motion", preferences.motion);
  if (!colorSelect) return;
  document.querySelector("#overview-panel").hidden = !preferences.overview;
  colorSelect.value = preferences.market;
  overviewToggle.setAttribute("aria-checked", String(preferences.overview));
  motionToggle.setAttribute("aria-checked", String(preferences.motion));
  document.querySelector("#market-legend").textContent =
    preferences.market === "red-up" ? text.redLegend : text.greenLegend;
  if (save) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(preferences));
      storageAvailable = true;
    } catch {
      storageAvailable = false;
    }
  }
  settingsStatus.textContent = storageAvailable
    ? save
      ? text.settingsSaved
      : text.settingsDefault
    : text.settingsUnavailable;
}
applyPreferences();
colorSelect?.addEventListener("change", () => {
  preferences.market = colorSelect.value;
  applyPreferences(true);
});
overviewToggle?.addEventListener("click", () => {
  preferences.overview = !preferences.overview;
  applyPreferences(true);
});
motionToggle?.addEventListener("click", () => {
  preferences.motion = !preferences.motion;
  applyPreferences(true);
});
document.querySelector("#reset-settings")?.addEventListener("click", () => {
  preferences = defaults();
  applyPreferences(true);
});

for (const list of document.querySelectorAll('[role="tablist"]')) {
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  function activate(tab) {
    for (const item of tabs) {
      const selected = item === tab;
      item.setAttribute("aria-selected", String(selected));
      item.tabIndex = selected ? 0 : -1;
      document.getElementById(item.getAttribute("aria-controls")).hidden =
        !selected;
    }
  }
  for (const tab of tabs) {
    tab.addEventListener("click", () => activate(tab));
    tab.addEventListener("keydown", (event) => {
      const index = tabs.indexOf(tab);
      let target;
      if (event.key === "ArrowRight") target = tabs[(index + 1) % tabs.length];
      if (event.key === "ArrowLeft")
        target = tabs[(index - 1 + tabs.length) % tabs.length];
      if (event.key === "Home") target = tabs[0];
      if (event.key === "End") target = tabs[tabs.length - 1];
      if (target) {
        event.preventDefault();
        activate(target);
        target.focus();
      }
    });
  }
}

const menuButton = document.querySelector("#menu-button");
const mobileNav = document.querySelector("#mobile-nav");
const featureMenus = [...document.querySelectorAll(".feature-menu")];
function closeMenu(returnFocus = false) {
  mobileNav.hidden = true;
  for (const menu of featureMenus) menu.open = false;
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.setAttribute("aria-label", text.menuOpen);
  if (returnFocus) menuButton.focus();
}
menuButton.addEventListener("click", () => {
  const open = menuButton.getAttribute("aria-expanded") !== "true";
  mobileNav.hidden = !open;
  menuButton.setAttribute("aria-expanded", String(open));
  menuButton.setAttribute("aria-label", open ? text.menuClose : text.menuOpen);
  if (!open) closeMenu();
});
for (const link of mobileNav.querySelectorAll("a"))
  link.addEventListener("click", () => closeMenu());
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  const feature = featureMenus.find((menu) => menu.open);
  if (feature) {
    feature.open = false;
    feature.querySelector("summary").focus();
  } else if (!mobileNav.hidden) closeMenu(true);
});
window.matchMedia("(min-width: 761px)").addEventListener("change", () => closeMenu());
for (const menu of featureMenus) {
  menu.addEventListener("focusout", (event) => {
    if (!menu.contains(event.relatedTarget)) menu.open = false;
  });
  for (const link of menu.querySelectorAll("a"))
    link.addEventListener("click", () => { menu.open = false; });
}
document.addEventListener("click", (event) => {
  for (const menu of featureMenus)
    if (!menu.contains(event.target)) menu.open = false;
  if (!event.target.closest(".site-header") && !mobileNav.hidden) closeMenu();
});

// Each language has a real URL; retain the current section when switching.
const languageLink = document.querySelector("[data-language-link]");
const alternatePath = languageLink.getAttribute("href");
function updateLanguageLink() {
  languageLink.href = `${alternatePath}${window.location.hash}`;
}
updateLanguageLink();
window.addEventListener("hashchange", updateLanguageLink);
