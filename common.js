/*
 * common.js — shared helpers for Jira Ticket Tracker.
 * Works in service worker (via importScripts), popup/options (via <script>),
 * and content script (listed before content.js in manifest).
 * Everything is attached to globalThis.JT.
 */
(function (root) {
  "use strict";

  // Placeholder — each user sets their real Jira URL in Settings.
  const JIRA_BASE = "https://jira.company.xyz";

  // Default user settings. Stored under chrome.storage.local key "settings".
  const DEFAULT_SETTINGS = {
    jiraBase: JIRA_BASE,
    pollMinutes: 5,
    // Which change types fire a notification
    notify: {
      status: true,
      assigned: true,
      comment: true,
      mention: true,
    },
    // Auto-add sources
    autoAdd: {
      assigned: true, // ticket assigned to me
      watcher: false,
      reporter: false,
    },
    // Only auto-add tickets updated within this many days (avoid backfill flood)
    autoAddLookbackDays: 14,
    // Max number of (latest) changes shown in a single notification / update entry
    maxNotifChanges: 5,
    // Skip a comment notification if its body contains ANY of these substrings
    // (case-insensitive). One per line in Settings. Good for bot/integration noise
    // like GitLab "mentioned this issue in a merge request of ...".
    commentIgnore: [],
    // Statuses considered "finished" -> auto-remove from watch list
    endStatuses: [
      "Done",
      "Ready for Production",
      "Released",
      "Closed",
      "Resolved",
    ],
    // VPN/network paused state: probe again on a sparse timer even if no Jira page loads
    pausedAutoProbe: false,
    pausedProbeMinutes: 30,
    // Quiet hours (no notifications). Disabled by default.
    quietHours: { enabled: false, start: "20:00", end: "08:00" },
    // Cap on tracked tickets
    maxTracked: 100,
    // history (updates feed) retention
    historyDays: 14,
    // visit-history retention in days (the "History" tab with notes). 7..60
    visitsRetentionDays: 30,
    // History "Copy list": include the ticket title? (default off -> "<key> <note>")
    historyCopyIncludeTitle: false,
  };

  // ---- storage helpers ----
  function getLocal(keys) {
    return new Promise((resolve) =>
      chrome.storage.local.get(keys, (r) => resolve(r))
    );
  }
  function setLocal(obj) {
    return new Promise((resolve) =>
      chrome.storage.local.set(obj, () => resolve())
    );
  }

  async function getSettings() {
    const { settings } = await getLocal("settings");
    return deepMerge(structuredCloneSafe(DEFAULT_SETTINGS), settings || {});
  }
  async function saveSettings(partial) {
    const cur = await getSettings();
    const merged = deepMerge(cur, partial || {});
    await setLocal({ settings: merged });
    return merged;
  }

  // tracked = { KEY: {key,title,project,url, status, assignee, commentCount,
  //                   lastCommentId, updated, addedAt, lastViewedAt, source, muted} }
  async function getTracked() {
    const { tracked } = await getLocal("tracked");
    return tracked || {};
  }
  async function saveTracked(tracked) {
    await setLocal({ tracked });
  }

  async function getState() {
    const { state } = await getLocal("state");
    return Object.assign(
      { paused: false, lastPollAt: 0, lastError: "", user: null },
      state || {}
    );
  }
  async function saveState(partial) {
    const cur = await getState();
    const merged = Object.assign(cur, partial || {});
    await setLocal({ state: merged });
    return merged;
  }

  async function getHistory() {
    const { history } = await getLocal("history");
    return history || [];
  }
  async function pushHistory(entry, retentionDays) {
    const hist = await getHistory();
    hist.unshift(Object.assign({ at: Date.now() }, entry));
    const cutoff = Date.now() - (retentionDays || 14) * 86400000;
    const trimmed = hist.filter((h) => h.at >= cutoff).slice(0, 500);
    await setLocal({ history: trimmed });
  }

  // ---- misc helpers ----
  function structuredCloneSafe(o) {
    return JSON.parse(JSON.stringify(o));
  }
  function deepMerge(target, src) {
    for (const k of Object.keys(src || {})) {
      if (
        src[k] &&
        typeof src[k] === "object" &&
        !Array.isArray(src[k]) &&
        target[k] &&
        typeof target[k] === "object"
      ) {
        deepMerge(target[k], src[k]);
      } else {
        target[k] = src[k];
      }
    }
    return target;
  }

  const KEY_RE = /([A-Z][A-Z0-9_]+-\d+)/;
  // Parse issue key from a Jira browse URL like https://jira.company.xyz/browse/EJAR-18937
  function parseKeyFromUrl(url) {
    if (!url) return null;
    try {
      const u = new URL(url);
      const m = u.pathname.match(/\/browse\/([A-Z][A-Z0-9_]+-\d+)/);
      if (m) return m[1];
      // also support ?selectedIssue=KEY (board/backlog views)
      const sel = u.searchParams.get("selectedIssue");
      if (sel && KEY_RE.test(sel)) return sel.match(KEY_RE)[1];
    } catch (e) {}
    const m2 = String(url).match(KEY_RE);
    return m2 ? m2[1] : null;
  }

  function browseUrl(base, key) {
    return base.replace(/\/+$/, "") + "/browse/" + key;
  }

  // Match pattern for host permission / content-script registration, e.g.
  // "https://jira.company.xyz" -> "https://jira.company.xyz/*"
  function originPattern(base) {
    try {
      return new URL(base).origin + "/*";
    } catch (e) {
      return null;
    }
  }
  // Is the base a real, configured URL (not the placeholder / empty)?
  function isConfigured(base) {
    return !!base && !/jira\.company\.xyz/i.test(base);
  }

  // YYYY-MM-DD in local time for grouping
  function dayKey(ts) {
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${da}`;
  }
  // Human label: Today / Yesterday / "20 Jun"
  function dayLabel(ts) {
    const MS = 86400000;
    const today = dayKey(Date.now());
    const yest = dayKey(Date.now() - MS);
    const dk = dayKey(ts);
    const d = new Date(ts);
    const months = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    const pretty = `${d.getDate()} ${months[d.getMonth()]}`;
    if (dk === today) return `Today ${pretty}`;
    if (dk === yest) return `Yesterday ${pretty}`;
    return pretty;
  }

  root.JT = {
    JIRA_BASE,
    DEFAULT_SETTINGS,
    getLocal,
    setLocal,
    getSettings,
    saveSettings,
    getTracked,
    saveTracked,
    getState,
    saveState,
    getHistory,
    pushHistory,
    deepMerge,
    parseKeyFromUrl,
    browseUrl,
    originPattern,
    isConfigured,
    dayKey,
    dayLabel,
    KEY_RE,
  };
})(typeof self !== "undefined" ? self : globalThis);
