/* background.js — service worker: polling, change detection, notifications,
 * VPN pause/resume, auto-add, auto-remove. Uses globalThis.JT from common.js. */
importScripts("common.js");
const JT = self.JT;

const ALARM_POLL = "jt-poll";
const ALARM_PROBE = "jt-probe";
const FIELDS_BASE = ["summary", "status", "assignee", "updated", "priority", "project"];

// ---------------- Jira API (cookie session) ----------------

async function apiGet(base, path) {
  const url = base.replace(/\/+$/, "") + path;
  let res;
  try {
    res = await fetch(url, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  } catch (e) {
    throw { type: "network", message: String(e) };
  }
  return handleRes(res);
}

async function apiPost(base, path, body) {
  const url = base.replace(/\/+$/, "") + path;
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw { type: "network", message: String(e) };
  }
  return handleRes(res);
}

async function handleRes(res) {
  if (res.status === 401 || res.status === 403) {
    throw { type: "auth", status: res.status };
  }
  if (!res.ok) {
    throw { type: "http", status: res.status };
  }
  const text = await res.text();
  // A login redirect may return HTML 200 -> treat as auth problem
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("json")) {
    throw { type: "auth", status: res.status, html: true };
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw { type: "parse", message: String(e) };
  }
}

function getMyself(base) {
  return apiGet(base, "/rest/api/2/myself");
}

function searchJql(base, jql, fields, maxResults) {
  return apiPost(base, "/rest/api/2/search", {
    jql,
    fields: fields || FIELDS_BASE,
    maxResults: maxResults || 100,
    startAt: 0,
  });
}

// ---------------- snapshot helpers ----------------

function snapshotFromIssue(base, issue) {
  const f = issue.fields || {};
  const comments = (f.comment && f.comment.comments) || [];
  let lastCommentId = 0;
  for (const c of comments) {
    const n = parseInt(c.id, 10);
    if (!isNaN(n) && n > lastCommentId) lastCommentId = n;
  }
  return {
    key: issue.key,
    title: f.summary || issue.key,
    project: (f.project && f.project.key) || issue.key.split("-")[0],
    url: JT.browseUrl(base, issue.key),
    status: (f.status && f.status.name) || "",
    assignee: (f.assignee && f.assignee.name) || null,
    assigneeDisplay: (f.assignee && f.assignee.displayName) || null,
    updated: f.updated || "",
    commentCount: comments.length,
    lastCommentId,
  };
}

function isEndStatus(statusName, endStatuses) {
  if (!statusName) return false;
  const s = statusName.trim().toLowerCase();
  return (endStatuses || []).some((e) => e.trim().toLowerCase() === s);
}

// ---------------- notifications ----------------

function isQuiet(settings) {
  const q = settings.quietHours;
  if (!q || !q.enabled) return false;
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = q.start.split(":").map(Number);
  const [eh, em] = q.end.split(":").map(Number);
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  if (start === end) return false;
  if (start < end) return cur >= start && cur < end;
  return cur >= start || cur < end; // overnight window
}

async function notify(key, title, message) {
  await new Promise((resolve) =>
    chrome.notifications.create("open|" + key + "|" + Date.now(), {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title,
      message,
      priority: 1,
    }, () => resolve())
  );
  const st = await JT.getState();
  const unread = (st.unread || 0) + 1;
  await JT.saveState({ unread });
  updateBadge(unread);
}

function updateBadge(n) {
  chrome.action.setBadgeBackgroundColor({ color: "#d04437" });
  chrome.action.setBadgeText({ text: n > 0 ? String(n > 99 ? "99+" : n) : "" });
}

chrome.notifications.onClicked.addListener((notifId) => {
  if (notifId.startsWith("open|")) {
    const key = notifId.split("|")[1];
    JT.getSettings().then((s) => {
      chrome.tabs.create({ url: JT.browseUrl(s.jiraBase, key) });
    });
    chrome.notifications.clear(notifId);
  }
});

// ---------------- core poll ----------------

let polling = false;

async function pollNow(reason) {
  if (polling) return;
  polling = true;
  const settings = await JT.getSettings();
  const base = settings.jiraBase;
  let state = await JT.getState();

  // Not configured yet, or host permission not granted -> don't spam, ask for setup
  const origin = JT.originPattern(base);
  if (!JT.isConfigured(base) || !origin) {
    await JT.saveState({ lastError: "setup", paused: false });
    polling = false;
    return;
  }
  const granted = await chrome.permissions.contains({ origins: [origin] });
  if (!granted) {
    await JT.saveState({ lastError: "setup", paused: false });
    polling = false;
    return;
  }

  const wasPaused = !!state.paused;
  try {
    // 1. who am I
    let me = state.user;
    if (!me || !me.name) {
      const my = await getMyself(base);
      me = { name: my.name, key: my.key, displayName: my.displayName };
      state = await JT.saveState({ user: me });
    }

    const firstRun = !state.seeded;

    // 2. auto-add (assigned / watcher / reporter)
    await autoAddDiscover(base, me, settings, firstRun);

    // 3. refresh tracked
    let tracked = await JT.getTracked();
    const keys = Object.keys(tracked);
    if (keys.length) {
      const data = await searchJql(
        base,
        `key in (${keys.join(",")})`,
        FIELDS_BASE,
        keys.length
      );
      const issuesByKey = {};
      for (const iss of data.issues || []) issuesByKey[iss.key] = iss;

      // keys whose `updated` changed -> need comment fetch
      const changedKeys = [];
      for (const key of keys) {
        const iss = issuesByKey[key];
        if (!iss) continue; // deleted / no permission -> leave as is
        const prev = tracked[key];
        const snap = snapshotFromIssue(base, iss);
        if (!prev.updated) {
          // seed only (added while offline) - no notifications
          tracked[key] = Object.assign(prev, snap);
          continue;
        }
        if (snap.updated !== prev.updated) changedKeys.push(key);
      }

      // fetch comments for changed tickets
      let commentsByKey = {};
      if (changedKeys.length) {
        const cdata = await searchJql(
          base,
          `key in (${changedKeys.join(",")})`,
          ["comment", "summary", "status", "assignee", "updated"],
          changedKeys.length
        );
        for (const iss of cdata.issues || []) commentsByKey[iss.key] = iss;
      }

      for (const key of keys) {
        const iss = issuesByKey[key];
        if (!iss) continue;
        const prev = tracked[key];
        if (!prev.updated) continue; // just seeded above
        const snap = snapshotFromIssue(base, iss);
        if (snap.updated === prev.updated) continue;

        const changes = [];

        // status change
        if (snap.status && snap.status !== prev.status) {
          changes.push({
            type: "status",
            text: `${prev.status || "?"} → ${snap.status}`,
          });
        }
        // assigned to me
        if (
          snap.assignee === me.name &&
          prev.assignee !== me.name
        ) {
          changes.push({ type: "assigned", text: `Được assign cho bạn` });
        }

        // comments / mentions (from detailed fetch)
        const detail = commentsByKey[key];
        if (detail) {
          const comments =
            (detail.fields &&
              detail.fields.comment &&
              detail.fields.comment.comments) ||
            [];
          for (const c of comments) {
            const cid = parseInt(c.id, 10);
            if (isNaN(cid) || cid <= prev.lastCommentId) continue;
            const author =
              (c.author && (c.author.displayName || c.author.name)) || "Ai đó";
            const body = c.body || "";
            const mentionsMe =
              body.includes(`[~${me.name}]`) ||
              (me.displayName && body.includes(me.displayName));
            // skip my own comments
            const byMe = c.author && c.author.name === me.name;
            if (byMe) continue;
            if (mentionsMe) {
              changes.push({
                type: "mention",
                text: `${author} nhắc tới bạn`,
              });
            } else {
              changes.push({
                type: "comment",
                text: `Comment mới từ ${author}`,
              });
            }
          }
        }

        // update snapshot regardless
        tracked[key] = Object.assign(prev, snap);

        // fire notifications (respect settings + quiet hours)
        const quiet = isQuiet(settings);
        const allowed = changes.filter((c) => settings.notify[c.type]);
        if (allowed.length && !quiet) {
          const title = `${key} • ${snap.title}`.slice(0, 90);
          const msg =
            allowed.length === 1
              ? allowed[0].text
              : `${allowed.length} cập nhật: ` +
                allowed.map((c) => c.text).join("; ");
          await notify(key, title, msg);
        }
        if (allowed.length) {
          await JT.pushHistory(
            { key, title: snap.title, changes: allowed.map((c) => c.text) },
            settings.historyDays
          );
        }

        // auto-remove on end status
        if (isEndStatus(snap.status, settings.endStatuses)) {
          delete tracked[key];
          if (!quiet) {
            await notify(
              key,
              `${key} • ${snap.title}`.slice(0, 90),
              `Status: ${snap.status} — đã gỡ khỏi watch list`
            );
          }
          await JT.pushHistory(
            { key, title: snap.title, changes: [`Auto-removed (${snap.status})`] },
            settings.historyDays
          );
        }
      }

      await JT.saveTracked(tracked);
    }

    await JT.saveState({
      paused: false,
      lastPollAt: Date.now(),
      lastError: "",
      seeded: true,
    });
    chrome.alarms.clear(ALARM_PROBE);
    // came back from a paused state -> restart the normal poll cadence
    if (wasPaused) await setupAlarm();
  } catch (err) {
    await handlePollError(err, settings);
  } finally {
    polling = false;
  }
}

async function handlePollError(err, settings) {
  const type = (err && err.type) || "unknown";
  if (type === "network") {
    // VPN off / cannot reach Jira -> stop polling entirely, no spam.
    await JT.saveState({ paused: true, lastError: "network" });
    chrome.alarms.clear(ALARM_POLL);
    if (settings.pausedAutoProbe) {
      chrome.alarms.create(ALARM_PROBE, {
        periodInMinutes: Math.max(5, settings.pausedProbeMinutes),
      });
    }
  } else if (type === "auth") {
    const prev = await JT.getState();
    await JT.saveState({ paused: false, lastError: "auth" });
    if (prev.lastError === "auth") return; // already nudged, don't re-pop every poll
    // one gentle nudge to re-login (deduped by static id)
    chrome.notifications.create("jt-auth", {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "Jira Tracker — cần đăng nhập lại",
      message: "Phiên Jira đã hết. Mở Jira và đăng nhập lại để tiếp tục theo dõi.",
      priority: 1,
    });
  } else {
    await JT.saveState({ lastError: type });
  }
}

async function autoAddDiscover(base, me, settings, firstRun) {
  const sources = [];
  if (settings.autoAdd.assigned)
    sources.push({ src: "assigned", jql: "assignee = currentUser()" });
  if (settings.autoAdd.watcher)
    sources.push({ src: "watcher", jql: "watcher = currentUser()" });
  if (settings.autoAdd.reporter)
    sources.push({ src: "reporter", jql: "reporter = currentUser()" });
  if (!sources.length) return;

  const tracked = await JT.getTracked();
  const lookback = settings.autoAddLookbackDays || 14;
  let added = false;

  for (const s of sources) {
    const jql = `${s.jql} AND updated >= -${lookback}d ORDER BY updated DESC`;
    let data;
    try {
      data = await searchJql(base, jql, FIELDS_BASE, 50);
    } catch (e) {
      if (e && e.type === "network") throw e; // bubble up -> pause
      continue; // other errors: skip this source
    }
    for (const iss of data.issues || []) {
      if (tracked[iss.key]) continue;
      if (Object.keys(tracked).length >= settings.maxTracked) break;
      const snap = snapshotFromIssue(base, iss);
      if (isEndStatus(snap.status, settings.endStatuses)) continue;
      tracked[iss.key] = Object.assign(snap, {
        addedAt: Date.now(),
        lastViewedAt: Date.now(),
        source: s.src,
        muted: false,
      });
      added = true;
      // notify on genuine new assignment (not first run backfill, not quiet)
      if (
        !firstRun &&
        s.src === "assigned" &&
        settings.notify.assigned &&
        !isQuiet(settings)
      ) {
        await notify(
          iss.key,
          `${iss.key} • ${snap.title}`.slice(0, 90),
          "Được assign cho bạn"
        );
        await JT.pushHistory(
          { key: iss.key, title: snap.title, changes: ["Được assign cho bạn"] },
          settings.historyDays
        );
      }
    }
  }
  if (added) await JT.saveTracked(tracked);
}

// ---------------- add / remove ticket ----------------

async function addTicket(key, url, viewedAt) {
  const settings = await JT.getSettings();
  const base = settings.jiraBase;
  const tracked = await JT.getTracked();
  if (Object.keys(tracked).length >= settings.maxTracked && !tracked[key]) {
    return { ok: false, error: "max" };
  }
  // try to fetch current snapshot (seed so first poll won't notify)
  let snap = {
    key,
    title: key,
    project: key.split("-")[0],
    url: url || JT.browseUrl(base, key),
    status: "",
    assignee: null,
    updated: "",
    commentCount: 0,
    lastCommentId: 0,
  };
  try {
    const data = await searchJql(base, `key = ${key}`, FIELDS_BASE.concat(["comment"]), 1);
    if (data.issues && data.issues[0]) snap = snapshotFromIssue(base, data.issues[0]);
  } catch (e) {
    // offline: keep minimal snapshot; poll will seed later
  }
  const existing = tracked[key] || {};
  tracked[key] = Object.assign(snap, {
    addedAt: existing.addedAt || Date.now(),
    lastViewedAt: viewedAt || Date.now(),
    source: existing.source || "manual",
    muted: existing.muted || false,
  });
  await JT.saveTracked(tracked);
  return { ok: true };
}

async function removeTicket(key) {
  const tracked = await JT.getTracked();
  delete tracked[key];
  await JT.saveTracked(tracked);
  return { ok: true };
}

async function touchViewed(key) {
  const tracked = await JT.getTracked();
  if (tracked[key]) {
    tracked[key].lastViewedAt = Date.now();
    await JT.saveTracked(tracked);
  }
}

// ---------------- alarms & lifecycle ----------------

async function setupAlarm() {
  const settings = await JT.getSettings();
  // jitter: small random offset so the whole team doesn't poll at the same instant
  const jitter = Math.random() * 0.5; // up to 30s
  chrome.alarms.create(ALARM_POLL, {
    delayInMinutes: jitter + 0.05,
    periodInMinutes: Math.max(1, settings.pollMinutes),
  });
}

// Register the content script for the user-configured Jira origin (if permission granted).
async function ensureContentScript() {
  const settings = await JT.getSettings();
  const origin = JT.originPattern(settings.jiraBase);
  if (!JT.isConfigured(settings.jiraBase) || !origin) return false;
  let granted = false;
  try {
    granted = await chrome.permissions.contains({ origins: [origin] });
  } catch (e) {}
  // remove any previous registration first (origin may have changed)
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({
      ids: ["jt-content"],
    });
    if (existing && existing.length) {
      await chrome.scripting.unregisterContentScripts({ ids: ["jt-content"] });
    }
  } catch (e) {}
  if (!granted) return false;
  try {
    await chrome.scripting.registerContentScripts([
      {
        id: "jt-content",
        matches: [origin],
        js: ["common.js", "content.js"],
        css: ["content.css"],
        runAt: "document_idle",
        persistAcrossSessions: true,
      },
    ]);
    return true;
  } catch (e) {
    return false;
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_POLL) pollNow("alarm");
  else if (alarm.name === ALARM_PROBE) pollNow("probe");
});

chrome.runtime.onInstalled.addListener(() => {
  setupAlarm();
  ensureContentScript();
  pollNow("installed");
});
chrome.runtime.onStartup.addListener(() => {
  setupAlarm();
  ensureContentScript();
  pollNow("startup");
});

// ---------------- messaging ----------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg && msg.cmd) {
        case "addTicket":
          sendResponse(await addTicket(msg.key, msg.url, msg.viewedAt));
          break;
        case "removeTicket":
          sendResponse(await removeTicket(msg.key));
          break;
        case "pollNow":
          await pollNow("manual");
          sendResponse({ ok: true });
          break;
        case "ticketViewed":
          await touchViewed(msg.key);
          sendResponse({ ok: true });
          break;
        case "jiraPageLoaded": {
          // a Jira page rendered successfully -> network/VPN is up.
          // Let pollNow see wasPaused=true so it restarts the poll cadence on success.
          const st = await JT.getState();
          if (st.paused) pollNow("resume");
          sendResponse({ ok: true });
          break;
        }
        case "clearBadge":
          await JT.saveState({ unread: 0 });
          updateBadge(0);
          sendResponse({ ok: true });
          break;
        case "reconfigure":
          await setupAlarm();
          await ensureContentScript();
          // user just (re)configured; clear stale state and poll
          await JT.saveState({ paused: false, lastError: "" });
          pollNow("reconfigure");
          sendResponse({ ok: true });
          break;
        case "getStatus": {
          const [settings, tracked, state] = await Promise.all([
            JT.getSettings(),
            JT.getTracked(),
            JT.getState(),
          ]);
          sendResponse({ settings, tracked, state });
          break;
        }
        default:
          sendResponse({ ok: false, error: "unknown cmd" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String((e && e.message) || e) });
    }
  })();
  return true; // async
});

// On service-worker spin-up, make sure the poll alarm exists —
// but NOT while paused (VPN off), where we intentionally stopped it.
chrome.alarms.get(ALARM_POLL, async (a) => {
  if (a) return;
  const st = await JT.getState();
  if (!st.paused) setupAlarm();
});
