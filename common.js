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
    lang: "vi", // "vi" | "en"
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
  function dayLabel(ts, lang) {
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
    if (dk === today) return `${t("day_today", lang)} ${pretty}`;
    if (dk === yest) return `${t("day_yesterday", lang)} ${pretty}`;
    return pretty;
  }

  // ---------------- i18n ----------------
  const I18N = {
    vi: {
      day_today: "Hôm nay",
      day_yesterday: "Hôm qua",
      tab_watch: "📋 Theo dõi",
      tab_updates: "🔔 Cập nhật",
      tab_history: "🕘 Lịch sử",
      filter_unread: "Chưa đọc",
      filter_all: "Tất cả",
      mark_all_read: "✓ Đã đọc hết",
      poll_now: "↻ Poll ngay",
      settings: "⚙️ Settings",
      copy_list: "Copy list",
      status_setup: "● Chưa cấu hình — mở Settings",
      status_auth: "● Cần đăng nhập Jira",
      status_paused: "● Tạm dừng (VPN?)",
      status_watching: "● Đang theo dõi · {time}",
      add_page_default: "➕ Thêm page này (mở 1 ticket trước)",
      add_ticket: "➕ Thêm {key}",
      added_ticket: "Đã thêm {key}",
      watch_empty:
        "Chưa theo dõi ticket nào.<br>Mở 1 ticket Jira rồi bấm “Thêm page này”.",
      updates_empty_unread: "Không có mục chưa đọc.",
      updates_empty_all: "Chưa có cập nhật nào.",
      history_empty: "Chưa có lịch sử xem ticket nào.",
      copied_n: "Đã copy {n} ticket",
      copied: "Đã copy",
      copy_error: "Copy lỗi",
      polling: "Đang poll…",
      marked_all_read: "Đã đánh dấu đã đọc hết",
      note_placeholder: "Thêm note cho lần xem này…",
      remove_title: "Gỡ theo dõi",
      delete_title: "Xoá",
      copy_item_title: "Copy ticket + note",
      time_today: "Hôm nay",
      time_yesterday: "Hôm qua",
      n_assigned: "Được assign cho bạn",
      n_comment_from: "Comment mới từ {who}",
      n_mention: "{who} nhắc tới bạn",
      n_updates_prefix: "{n} cập nhật: ",
      n_more_changes: "(+{n} thay đổi cũ hơn)",
      n_removed_status: "Đã gỡ — status: {status}",
      n_removed_full: "Status: {status} — đã gỡ khỏi watch list",
      auth_title: "Jira Tracker — cần đăng nhập lại",
      auth_msg:
        "Phiên Jira đã hết. Mở Jira và đăng nhập lại để tiếp tục theo dõi.",
      author_unknown: "Ai đó",
      banner_watching: "đang được theo dõi",
      banner_unwatch: "Gỡ theo dõi",
      banner_ask: "Theo dõi ticket này?",
      banner_watch: "➕ Theo dõi",
      banner_never: "Đừng hỏi lại",
      opt_lang: "Ngôn ngữ / Language",
      opt_conn: "Kết nối & tần suất",
      opt_base: "Jira base URL",
      opt_base_hint:
        "Nhập URL Jira công ty bạn (vd <code>https://jira.company.xyz</code>). Khi bấm <b>Lưu</b>, Chrome sẽ hỏi cấp quyền truy cập host này — chọn <b>Allow</b> để extension hoạt động.",
      opt_poll: "Tần suất poll (phút)",
      opt_poll_hint: "Tối thiểu 1 phút. Mặc định 5.",
      opt_notif: "Thông báo loại nào",
      opt_n_status: "Đổi status",
      opt_n_assigned: "Được assign cho tôi",
      opt_n_comment: "Comment mới",
      opt_n_mention: "Bị tag tên (mention)",
      opt_maxchanges: "Số thay đổi tối đa hiển thị trong 1 thông báo",
      opt_maxchanges_hint: "Chỉ hiện N thay đổi mới nhất. Mặc định 5.",
      opt_ignore_h: "Bỏ qua comment chứa text",
      opt_ignore_lbl: "Mỗi dòng 1 chuỗi — comment chứa chuỗi này sẽ KHÔNG báo",
      opt_ignore_hint:
        "Khớp không phân biệt hoa thường, so theo \"chứa\". Dùng để bỏ qua comment tự động từ bot/tích hợp (vd GitLab merge request).",
      opt_autoadd: "Tự động thêm vào watch list",
      opt_a_assigned: "Ticket được assign cho tôi",
      opt_a_watcher: "Ticket tôi là watcher",
      opt_a_reporter: "Ticket tôi là reporter",
      opt_lookback: "Chỉ tự thêm ticket cập nhật trong vòng (ngày)",
      opt_lookback_hint: "Tránh kéo về quá nhiều ticket cũ. Mặc định 14.",
      opt_history: "History",
      opt_copytitle: "Bao gồm tên ticket khi Copy list",
      opt_copytitle_hint:
        "Tắt (mặc định): <code>KEY: note</code>. Bật: <code>KEY tên-ticket: note</code>.",
      opt_retention: "Số ngày lưu lịch sử",
      opt_retention_hint: "7–60 ngày. Mặc định 30. Mục cũ hơn sẽ bị tự xoá.",
      opt_endstatus_h: "Tự gỡ khi ticket kết thúc",
      opt_endstatus_lbl:
        'Danh sách status coi là "kết thúc" (mỗi dòng 1 status)',
      opt_endstatus_hint:
        "Khớp không phân biệt hoa thường. Ví dụ: Done, Released…",
      opt_vpn: "VPN / mạng",
      opt_probe: "Tự dò lại khi đang tạm dừng (VPN off)",
      opt_probe_hint:
        "Mặc định TẮT — chỉ chạy lại khi có 1 trang Jira load thành công. Bật thì thêm 1 nhịp dò thưa:",
      opt_probemin: "Nhịp dò khi tạm dừng (phút)",
      opt_quiet: "Quiet hours (không báo ngoài giờ)",
      opt_quiet_enable: "Bật quiet hours",
      opt_from: "Từ",
      opt_to: "Đến",
      opt_other: "Khác",
      opt_maxtracked: "Giới hạn số ticket track",
      opt_histdays: "Giữ lịch sử cập nhật (ngày)",
      opt_export: "⬇ Export (backup)",
      opt_import: "⬆ Import",
      opt_save: "Lưu",
      opt_msg_needurl: "⚠ Hãy nhập đúng Jira base URL của bạn trước",
      opt_msg_saved_granted: "✓ Đã lưu & cấp quyền truy cập Jira",
      opt_msg_saved_nogrant:
        "✓ Đã lưu — nhưng CHƯA cấp quyền. Bấm Lưu lại và chọn Allow.",
      opt_msg_import_ok: "Đã import xong.",
      opt_msg_import_bad: "File không hợp lệ: ",
    },
    en: {
      day_today: "Today",
      day_yesterday: "Yesterday",
      tab_watch: "📋 Watch",
      tab_updates: "🔔 Updates",
      tab_history: "🕘 History",
      filter_unread: "Unread",
      filter_all: "All",
      mark_all_read: "✓ Mark all read",
      poll_now: "↻ Poll now",
      settings: "⚙️ Settings",
      copy_list: "Copy list",
      status_setup: "● Not configured — open Settings",
      status_auth: "● Need to log in to Jira",
      status_paused: "● Paused (VPN?)",
      status_watching: "● Watching · {time}",
      add_page_default: "➕ Add this page (open a ticket first)",
      add_ticket: "➕ Add {key}",
      added_ticket: "Added {key}",
      watch_empty:
        "Not watching any ticket yet.<br>Open a Jira ticket and click “Add this page”.",
      updates_empty_unread: "No unread updates.",
      updates_empty_all: "No updates yet.",
      history_empty: "No ticket view history yet.",
      copied_n: "Copied {n} ticket(s)",
      copied: "Copied",
      copy_error: "Copy failed",
      polling: "Polling…",
      marked_all_read: "Marked all read",
      note_placeholder: "Add a note for this view…",
      remove_title: "Unwatch",
      delete_title: "Delete",
      copy_item_title: "Copy ticket + note",
      time_today: "Today",
      time_yesterday: "Yesterday",
      n_assigned: "Assigned to you",
      n_comment_from: "New comment from {who}",
      n_mention: "{who} mentioned you",
      n_updates_prefix: "{n} updates: ",
      n_more_changes: "(+{n} older changes)",
      n_removed_status: "Removed — status: {status}",
      n_removed_full: "Status: {status} — removed from watch list",
      auth_title: "Jira Tracker — please log in again",
      auth_msg:
        "Your Jira session expired. Open Jira and log in again to keep tracking.",
      author_unknown: "Someone",
      banner_watching: "is being tracked",
      banner_unwatch: "Unwatch",
      banner_ask: "Track this ticket?",
      banner_watch: "➕ Track",
      banner_never: "Don't ask again",
      opt_lang: "Language / Ngôn ngữ",
      opt_conn: "Connection & frequency",
      opt_base: "Jira base URL",
      opt_base_hint:
        "Enter your company Jira URL (e.g. <code>https://jira.company.xyz</code>). When you click <b>Save</b>, Chrome will ask for permission to access this host — choose <b>Allow</b> so the extension works.",
      opt_poll: "Poll frequency (minutes)",
      opt_poll_hint: "Minimum 1 minute. Default 5.",
      opt_notif: "Notification types",
      opt_n_status: "Status change",
      opt_n_assigned: "Assigned to me",
      opt_n_comment: "New comment",
      opt_n_mention: "Mentioned (tag)",
      opt_maxchanges: "Max changes shown per notification",
      opt_maxchanges_hint: "Only show the latest N changes. Default 5.",
      opt_ignore_h: "Ignore comments containing text",
      opt_ignore_lbl: "One per line — comments containing it will NOT notify",
      opt_ignore_hint:
        "Case-insensitive, matched by \"contains\". Use it to skip automated comments from bots/integrations (e.g. GitLab merge request).",
      opt_autoadd: "Auto-add to watch list",
      opt_a_assigned: "Tickets assigned to me",
      opt_a_watcher: "Tickets I watch",
      opt_a_reporter: "Tickets I reported",
      opt_lookback: "Only auto-add tickets updated within (days)",
      opt_lookback_hint: "Avoid pulling in too many old tickets. Default 14.",
      opt_history: "History",
      opt_copytitle: "Include ticket title in Copy list",
      opt_copytitle_hint:
        "Off (default): <code>KEY: note</code>. On: <code>KEY title: note</code>.",
      opt_retention: "History retention (days)",
      opt_retention_hint: "7–60 days. Default 30. Older items are auto-removed.",
      opt_endstatus_h: "Auto-remove when ticket finished",
      opt_endstatus_lbl: 'Statuses considered "finished" (one per line)',
      opt_endstatus_hint: "Case-insensitive. E.g. Done, Released…",
      opt_vpn: "VPN / network",
      opt_probe: "Auto-retry while paused (VPN off)",
      opt_probe_hint:
        "Default OFF — only resumes when a Jira page loads successfully. When on, adds a sparse retry tick:",
      opt_probemin: "Retry interval while paused (minutes)",
      opt_quiet: "Quiet hours (no alerts off-hours)",
      opt_quiet_enable: "Enable quiet hours",
      opt_from: "From",
      opt_to: "To",
      opt_other: "Other",
      opt_maxtracked: "Max tracked tickets",
      opt_histdays: "Keep updates history (days)",
      opt_export: "⬇ Export (backup)",
      opt_import: "⬆ Import",
      opt_save: "Save",
      opt_msg_needurl: "⚠ Please enter your correct Jira base URL first",
      opt_msg_saved_granted: "✓ Saved & granted Jira access",
      opt_msg_saved_nogrant:
        "✓ Saved — but access NOT granted. Click Save again and choose Allow.",
      opt_msg_import_ok: "Import done.",
      opt_msg_import_bad: "Invalid file: ",
    },
  };

  function t(key, lang, vars) {
    const L = I18N[lang] ? lang : "vi";
    let s = I18N[L][key];
    if (s == null) s = I18N.vi[key];
    if (s == null) return key;
    if (vars) {
      s = s.replace(/\{(\w+)\}/g, (m, p) =>
        vars[p] != null ? vars[p] : m
      );
    }
    return s;
  }

  // Apply translations to a DOM tree via data-i18n / data-i18n-ph / data-i18n-title.
  function applyDom(rootEl, lang) {
    rootEl.querySelectorAll("[data-i18n]").forEach((el) => {
      el.innerHTML = t(el.getAttribute("data-i18n"), lang);
    });
    rootEl.querySelectorAll("[data-i18n-ph]").forEach((el) => {
      el.setAttribute("placeholder", t(el.getAttribute("data-i18n-ph"), lang));
    });
    rootEl.querySelectorAll("[data-i18n-title]").forEach((el) => {
      el.setAttribute("title", t(el.getAttribute("data-i18n-title"), lang));
    });
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
    t,
    applyDom,
    I18N,
    dayKey,
    dayLabel,
    KEY_RE,
  };
})(typeof self !== "undefined" ? self : globalThis);
