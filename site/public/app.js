const root = document.documentElement;
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
  document.querySelector("#overview-panel").hidden = !preferences.overview;
  colorSelect.value = preferences.market;
  overviewToggle.setAttribute("aria-checked", String(preferences.overview));
  motionToggle.setAttribute("aria-checked", String(preferences.motion));
  document.querySelector("#market-legend").textContent =
    `${preferences.market === "red-up" ? "红涨 / 绿跌" : "绿涨 / 红跌"} · 合成数据`;
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
      ? "已更新演示 · 仅保存在此浏览器"
      : "演示设置 · 仅保存在此浏览器"
    : "演示设置 · 本次页面有效，浏览器存储不可用";
}
applyPreferences();
colorSelect.addEventListener("change", () => {
  preferences.market = colorSelect.value;
  applyPreferences(true);
});
overviewToggle.addEventListener("click", () => {
  preferences.overview = !preferences.overview;
  applyPreferences(true);
});
motionToggle.addEventListener("click", () => {
  preferences.motion = !preferences.motion;
  applyPreferences(true);
});
document.querySelector("#reset-settings").addEventListener("click", () => {
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
function closeMenu(returnFocus = false) {
  mobileNav.hidden = true;
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.setAttribute("aria-label", "打开导航菜单");
  if (returnFocus) menuButton.focus();
}
menuButton.addEventListener("click", () => {
  const open = menuButton.getAttribute("aria-expanded") !== "true";
  mobileNav.hidden = !open;
  menuButton.setAttribute("aria-expanded", String(open));
  menuButton.setAttribute("aria-label", open ? "关闭导航菜单" : "打开导航菜单");
});
for (const link of mobileNav.querySelectorAll("a"))
  link.addEventListener("click", () => closeMenu());
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !mobileNav.hidden) closeMenu(true);
});
window.matchMedia("(min-width: 761px)").addEventListener("change", (event) => {
  if (event.matches) closeMenu();
});

for (const button of document.querySelectorAll("[data-copy]")) {
  button.addEventListener("click", async () => {
    const status = document.querySelector("#copy-status");
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      status.textContent = `已复制：${button.dataset.copy}`;
    } catch {
      status.textContent = `无法自动复制，请手动选择命令：${button.dataset.copy}`;
      const range = document.createRange();
      range.selectNodeContents(button.parentElement.querySelector("code"));
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
  });
}
