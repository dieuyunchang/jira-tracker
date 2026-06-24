/* popup.js — main menu + watch list + copy list */
(function () {
  "use strict";
  const JT = self.JT;

  function send(msg) {
    return new Promise((resolve) =>
      chrome.runtime.sendMessage(msg, (r) => {
        void chrome.runtime.lastError;
        resolve(r);
      })
    );
  }
  function $(id) {
    return document.getElementById(id);
  }
  let toastTimer = null;
  function toast(text) {
    const t = $("toast");
    t.textContent = text;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 1500);
  }

  function getActiveTab() {
    return new Promise((resolve) =>
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) =>
        resolve(tabs && tabs[0])
      )
    );
  }

  function renderStatus(state) {
    const el = $("status");
    el.className = "status";
    if (state.lastError === "setup") {
      el.textContent = "● Chưa cấu hình — mở Settings";
      el.classList.add("warn");
    } else if (state.lastError === "auth") {
      el.textContent = "● Cần đăng nhập Jira";
      el.classList.add("warn");
    } else if (state.paused) {
      el.textContent = "● Tạm dừng (VPN?)";
      el.classList.add("paused");
    } else {
      const when = state.lastPollAt
        ? new Date(state.lastPollAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "—";
      el.textContent = "● Đang theo dõi · " + when;
      el.classList.add("ok");
    }
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
    );
  }

  function groupByDay(tracked) {
    const arr = Object.values(tracked).map((t) => ({
      ...t,
      _v: t.lastViewedAt || t.addedAt || 0,
    }));
    arr.sort((a, b) => b._v - a._v);
    const groups = [];
    const idx = {};
    for (const t of arr) {
      const dk = JT.dayKey(t._v);
      if (!(dk in idx)) {
        idx[dk] = groups.length;
        groups.push({ dayKey: dk, label: JT.dayLabel(t._v), items: [] });
      }
      groups[idx[dk]].items.push(t);
    }
    return groups;
  }

  function renderList(tracked) {
    const list = $("list");
    list.innerHTML = "";
    const keys = Object.keys(tracked);
    if (!keys.length) {
      list.innerHTML =
        '<div class="empty">Chưa theo dõi ticket nào.<br>Mở 1 ticket Jira rồi bấm “Thêm page này”.</div>';
      return;
    }
    const groups = groupByDay(tracked);
    for (const g of groups) {
      const sec = document.createElement("div");
      sec.className = "group";

      const head = document.createElement("div");
      head.className = "group-head";
      head.innerHTML =
        `<span class="group-label">${escapeHtml(g.label)}</span>` +
        `<button class="copy" data-day="${g.dayKey}">Copy list</button>`;
      sec.appendChild(head);

      for (const t of g.items) {
        const row = document.createElement("div");
        row.className = "row" + (t.muted ? " muted" : "");
        row.innerHTML =
          `<a class="key" href="${escapeHtml(t.url)}" data-key="${escapeHtml(
            t.key
          )}">${escapeHtml(t.key)}</a>` +
          `<span class="rtitle" title="${escapeHtml(t.title)}">${escapeHtml(
            t.title
          )}</span>` +
          `<button class="rx" data-key="${escapeHtml(t.key)}" title="Gỡ theo dõi">✕</button>`;
        sec.appendChild(row);
      }
      list.appendChild(sec);
    }

    // open ticket in new tab
    list.querySelectorAll("a.key").forEach((a) =>
      a.addEventListener("click", (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: a.getAttribute("href") });
      })
    );
    // remove
    list.querySelectorAll("button.rx").forEach((b) =>
      b.addEventListener("click", async () => {
        await send({ cmd: "removeTicket", key: b.dataset.key });
        refresh();
      })
    );
    // copy list per day group
    list.querySelectorAll("button.copy").forEach((b) =>
      b.addEventListener("click", async () => {
        const dayKey = b.dataset.day;
        const items = groups.find((g) => g.dayKey === dayKey).items;
        const text = items.map((t) => `* ${t.key} ${t.title}`).join("\n");
        try {
          await navigator.clipboard.writeText(text);
          toast("Đã copy " + items.length + " ticket");
        } catch (e) {
          toast("Copy lỗi");
        }
      })
    );
  }

  const MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  function timeLabel(ts) {
    const d = new Date(ts);
    const hm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const today = JT.dayKey(Date.now());
    const yk = JT.dayKey(Date.now() - 86400000);
    const dk = JT.dayKey(ts);
    if (dk === today) return "Hôm nay " + hm;
    if (dk === yk) return "Hôm qua " + hm;
    return `${d.getDate()} ${MONTHS[d.getMonth()]} ${hm}`;
  }

  const FULL_LIMIT = 30;
  let updFilter = "unread"; // "unread" | "all"

  function renderUpdates(history, jiraBase) {
    const box = $("ulist");
    box.innerHTML = "";
    let items = history || [];
    if (updFilter === "unread") {
      items = items.filter((h) => !h.read);
    } else {
      items = items.slice(0, FULL_LIMIT);
    }
    if (!items.length) {
      box.innerHTML =
        '<div class="empty">' +
        (updFilter === "unread" ? "Không có mục chưa đọc." : "Chưa có cập nhật nào.") +
        "</div>";
      return;
    }
    for (const h of items) {
      const row = document.createElement("div");
      row.className = "urow" + (h.read ? "" : " unread");
      // fall back to building the URL from the key (older entries had no url)
      const url =
        h.url ||
        (JT.isConfigured(jiraBase) ? JT.browseUrl(jiraBase, h.key) : "");
      const changes = (h.changes || []).map(escapeHtml).join(" · ");
      row.innerHTML =
        `<div class="urow-top">` +
        `<a class="key" href="${escapeHtml(url)}" data-key="${escapeHtml(
          h.key
        )}">${escapeHtml(h.key)}</a>` +
        `<span class="utime">${escapeHtml(timeLabel(h.at))}</span>` +
        `</div>` +
        `<div class="utitle" title="${escapeHtml(h.title || "")}">${escapeHtml(
          h.title || ""
        )}</div>` +
        `<div class="uchg">${changes}</div>`;
      box.appendChild(row);
    }
    box.querySelectorAll("a.key").forEach((a) =>
      a.addEventListener("click", async (e) => {
        e.preventDefault();
        const href = a.getAttribute("href");
        if (href) chrome.tabs.create({ url: href });
        await send({ cmd: "markReadKey", key: a.dataset.key });
        refresh();
      })
    );
  }

  function setTabCount(n) {
    const el = $("tabCount");
    if (n > 0) {
      el.textContent = " " + (n > 99 ? "99+" : n);
      el.style.display = "inline";
    } else {
      el.textContent = "";
      el.style.display = "none";
    }
  }

  function showTab(which) {
    $("list").hidden = which !== "list";
    $("updates").hidden = which !== "updates";
    $("history").hidden = which !== "history";
    $("tabList").classList.toggle("active", which === "list");
    $("tabUpdates").classList.toggle("active", which === "updates");
    $("tabHistory").classList.toggle("active", which === "history");
  }

  function renderHistory(visits, includeTitle) {
    const box = $("hlist");
    box.innerHTML = "";
    if (!visits || !visits.length) {
      box.innerHTML = '<div class="empty">Chưa có lịch sử xem ticket nào.</div>';
      return;
    }
    const arr = visits.slice().sort((a, b) => b.at - a.at);
    const groups = [];
    const idx = {};
    for (const v of arr) {
      const dk = v.day || JT.dayKey(v.at);
      if (!(dk in idx)) {
        idx[dk] = groups.length;
        groups.push({ day: dk, label: JT.dayLabel(v.at), items: [] });
      }
      groups[idx[dk]].items.push(v);
    }
    for (const g of groups) {
      const sec = document.createElement("div");
      sec.className = "group";
      const head = document.createElement("div");
      head.className = "group-head";
      head.innerHTML =
        `<span class="group-label">${escapeHtml(g.label)}</span>` +
        `<button class="copy" data-day="${escapeHtml(g.day)}">Copy list</button>`;
      sec.appendChild(head);
      for (const v of g.items) {
        const row = document.createElement("div");
        row.className = "hrow";
        row.innerHTML =
          `<div class="hrow-top">` +
          `<a class="key" href="${escapeHtml(v.url)}">${escapeHtml(v.key)}</a>` +
          `<span class="rtitle" title="${escapeHtml(v.title)}">${escapeHtml(
            v.title
          )}</span>` +
          `<button class="hcopy" data-id="${escapeHtml(
            v.id
          )}" title="Copy ticket + note">⧉</button>` +
          `<button class="rx" data-id="${escapeHtml(v.id)}" title="Xoá">✕</button>` +
          `</div>` +
          `<input class="note" data-id="${escapeHtml(
            v.id
          )}" placeholder="Thêm note cho lần xem này…" value="${escapeHtml(
            v.note || ""
          )}" />`;
        sec.appendChild(row);
      }
      box.appendChild(sec);
    }
    box.querySelectorAll("a.key").forEach((a) =>
      a.addEventListener("click", (e) => {
        e.preventDefault();
        const h = a.getAttribute("href");
        if (h) chrome.tabs.create({ url: h });
      })
    );
    box.querySelectorAll("button.rx").forEach((b) =>
      b.addEventListener("click", async () => {
        await send({ cmd: "deleteVisit", id: b.dataset.id });
        refresh();
      })
    );
    box.querySelectorAll("input.note").forEach((inp) => {
      const save = () => {
        // keep the in-memory object in sync so Copy list uses the latest note
        for (const g of groups) {
          const hit = g.items.find((x) => x.id === inp.dataset.id);
          if (hit) hit.note = inp.value;
        }
        send({ cmd: "setVisitNote", id: inp.dataset.id, note: inp.value });
      };
      inp.addEventListener("change", save);
      inp.addEventListener("blur", save);
    });
    // build one copy line for a visit, reading the freshest note from the input
    const lineFor = (v) => {
      const inp = box.querySelector(`input.note[data-id="${v.id}"]`);
      const note = (inp ? inp.value : v.note || "").trim();
      let line = `${v.key}`;
      if (includeTitle) line += ` ${v.title}`;
      if (note) line += `: ${note}`;
      return line;
    };
    const findVisit = (id) => {
      for (const g of groups) {
        const hit = g.items.find((x) => x.id === id);
        if (hit) return hit;
      }
      return null;
    };
    async function copyText(text, n) {
      try {
        await navigator.clipboard.writeText(text);
        toast(n ? "Đã copy " + n + " ticket" : "Đã copy");
      } catch (e) {
        toast("Copy lỗi");
      }
    }

    box.querySelectorAll("button.copy").forEach((b) =>
      b.addEventListener("click", () => {
        const g = groups.find((x) => x.day === b.dataset.day);
        copyText(g.items.map(lineFor).join("\n"), g.items.length);
      })
    );
    box.querySelectorAll("button.hcopy").forEach((b) =>
      b.addEventListener("click", () => {
        const v = findVisit(b.dataset.id);
        if (v) copyText(lineFor(v), 0);
      })
    );
  }

  async function refresh() {
    const res = await send({ cmd: "getStatus" });
    if (!res) return;
    renderStatus(res.state || {});
    renderList(res.tracked || {});
    renderUpdates(res.history || [], (res.settings && res.settings.jiraBase) || "");
    renderHistory(
      res.visits || [],
      !!(res.settings && res.settings.historyCopyIncludeTitle)
    );
    setTabCount((res.state && res.state.unread) || 0);
  }

  function applyFilterUI() {
    $("fUnread").classList.toggle("active", updFilter === "unread");
    $("fAll").classList.toggle("active", updFilter === "all");
  }
  function setFilter(f) {
    updFilter = f;
    applyFilterUI();
    chrome.storage.local.set({ updFilter: f });
    refresh();
  }

  async function init() {
    // restore saved filter
    const saved = await new Promise((r) =>
      chrome.storage.local.get("updFilter", (x) => r(x.updFilter))
    );
    if (saved === "all" || saved === "unread") updFilter = saved;
    applyFilterUI();

    // tab switching
    $("tabList").addEventListener("click", () => showTab("list"));
    $("tabUpdates").addEventListener("click", () => showTab("updates"));
    $("tabHistory").addEventListener("click", () => showTab("history"));

    // updates filter + mark-all-read
    $("fUnread").addEventListener("click", () => setFilter("unread"));
    $("fAll").addEventListener("click", () => setFilter("all"));
    $("markAll").addEventListener("click", async () => {
      await send({ cmd: "markRead" });
      toast("Đã đánh dấu đã đọc hết");
      refresh();
    });

    // "Thêm page này" — active only on a ticket page of the CONFIGURED Jira host
    const st = await send({ cmd: "getStatus" });
    const jiraBase = (st && st.settings && st.settings.jiraBase) || "";
    const cfgOrigin = JT.isConfigured(jiraBase)
      ? (function () {
          try {
            return new URL(jiraBase).origin;
          } catch (e) {
            return null;
          }
        })()
      : null;

    const tab = await getActiveTab();
    let key = null;
    if (tab && cfgOrigin) {
      try {
        if (new URL(tab.url).origin === cfgOrigin) key = JT.parseKeyFromUrl(tab.url);
      } catch (e) {}
    }
    const tracked = (st && st.tracked) || {};
    const addBtn = $("addPage");
    if (key && tracked[key]) {
      // already watching this ticket -> hide the add button
      addBtn.hidden = true;
    } else if (key) {
      addBtn.hidden = false;
      addBtn.disabled = false;
      addBtn.textContent = `➕ Thêm ${key}`;
      addBtn.addEventListener("click", async () => {
        await send({
          cmd: "addTicket",
          key,
          url: tab.url,
          viewedAt: Date.now(),
        });
        toast("Đã thêm " + key);
        addBtn.hidden = true;
        refresh();
      });
    } else {
      addBtn.hidden = false;
      addBtn.disabled = true;
      addBtn.textContent = "➕ Thêm page này (mở 1 ticket trước)";
    }

    $("pollNow").addEventListener("click", async () => {
      toast("Đang poll…");
      await send({ cmd: "pollNow" });
      refresh();
    });
    $("openOptions").addEventListener("click", () =>
      chrome.runtime.openOptionsPage()
    );

    await refresh();

    // default to the Updates tab when there are unread updates
    const unread = (st && st.state && st.state.unread) || 0;
    showTab(unread > 0 ? "updates" : "list");
  }

  document.addEventListener("DOMContentLoaded", init);
})();
