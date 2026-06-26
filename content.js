/* content.js — runs on the configured Jira host.
 * - Signals background that a Jira page loaded (resume from VPN pause).
 * - On a ticket page, shows a banner to add/remove from watch list. */
(function () {
  "use strict";
  const JT = self.JT;
  let lastUrl = "";
  let bannerEl = null;

  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (r) => {
          void chrome.runtime.lastError; // swallow
          resolve(r);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  async function getTrackedMap() {
    return new Promise((resolve) =>
      chrome.storage.local.get("tracked", (r) => resolve(r.tracked || {}))
    );
  }
  async function getDismissed() {
    return new Promise((resolve) =>
      chrome.storage.local.get("dismissed", (r) => resolve(r.dismissed || {}))
    );
  }
  async function setDismissed(map) {
    return new Promise((resolve) =>
      chrome.storage.local.set({ dismissed: map }, () => resolve())
    );
  }

  function removeBanner() {
    if (bannerEl && bannerEl.parentNode) bannerEl.parentNode.removeChild(bannerEl);
    bannerEl = null;
  }

  async function renderBanner(key) {
    removeBanner();
    const tracked = await getTrackedMap();
    const dismissed = await getDismissed();
    const isTracked = !!tracked[key];
    if (!isTracked && dismissed[key]) return; // user said don't ask again

    const settings = await JT.getSettings();
    const lang = settings.lang;
    const T = (k) => JT.t(k, lang);

    const el = document.createElement("div");
    el.className = "jt-banner";
    if (isTracked) {
      el.innerHTML = `
        <span class="jt-dot jt-on"></span>
        <span class="jt-key">${key}</span>
        <span class="jt-msg">${T("banner_watching")}</span>
        <button class="jt-btn jt-remove">${T("banner_unwatch")}</button>
        <button class="jt-x">✕</button>`;
    } else {
      el.innerHTML = `
        <span class="jt-dot"></span>
        <span class="jt-key">${key}</span>
        <span class="jt-msg">${T("banner_ask")}</span>
        <button class="jt-btn jt-add">${T("banner_watch")}</button>
        <button class="jt-link jt-never">${T("banner_never")}</button>
        <button class="jt-x">✕</button>`;
    }
    document.documentElement.appendChild(el);
    bannerEl = el;

    const q = (s) => el.querySelector(s);
    if (q(".jt-add"))
      q(".jt-add").addEventListener("click", async () => {
        await send({ cmd: "addTicket", key, url: location.href, viewedAt: Date.now() });
        renderBanner(key);
      });
    if (q(".jt-remove"))
      q(".jt-remove").addEventListener("click", async () => {
        await send({ cmd: "removeTicket", key });
        renderBanner(key);
      });
    if (q(".jt-never"))
      q(".jt-never").addEventListener("click", async () => {
        const d = await getDismissed();
        d[key] = true;
        await setDismissed(d);
        removeBanner();
      });
    if (q(".jt-x")) q(".jt-x").addEventListener("click", removeBanner);

    // auto-hide after a while if it's just the "tracked" confirmation
    if (isTracked) setTimeout(() => { if (bannerEl === el) removeBanner(); }, 6000);
  }

  async function onPage() {
    // 1) signal background that Jira loaded fine (resume from pause)
    send({ cmd: "jiraPageLoaded" });

    // 2) ticket detection
    const key = JT.parseKeyFromUrl(location.href);
    if (key) {
      // bump lastViewed (if tracked) + record a visit into History
      send({ cmd: "ticketViewed", key, url: location.href, title: ticketTitle(key) });
      // re-send shortly after to capture the title once the page finishes rendering
      setTimeout(
        () => send({ cmd: "ticketViewed", key, url: location.href, title: ticketTitle(key) }),
        1500
      );
      renderBanner(key);
    } else {
      removeBanner();
    }
  }

  // Best-effort ticket title from the page (e.g. "[L3S-21] Summary - Jira")
  function ticketTitle(key) {
    let t = document.title || "";
    t = t.replace(/^\s*\[[^\]]+\]\s*/, ""); // drop "[KEY]" prefix
    const i = t.lastIndexOf(" - ");
    if (i > 0) t = t.slice(0, i); // drop " - Jira" suffix
    t = t.trim();
    return t || key;
  }

  function checkNav() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      onPage();
    }
  }

  // initial + SPA navigation watch (Jira changes URL without full reload)
  lastUrl = location.href;
  onPage();
  window.addEventListener("popstate", checkNav);
  setInterval(checkNav, 1500);
})();
