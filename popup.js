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
    if (state.lastError === "auth") {
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

  async function refresh() {
    const res = await send({ cmd: "getStatus" });
    if (!res) return;
    renderStatus(res.state || {});
    renderList(res.tracked || {});
  }

  async function init() {
    // clear unread badge on open
    send({ cmd: "clearBadge" });

    // "Thêm page này" — active only on a Jira ticket page
    const tab = await getActiveTab();
    const key = tab ? JT.parseKeyFromUrl(tab.url) : null;
    const addBtn = $("addPage");
    if (key) {
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
        refresh();
      });
    } else {
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

    refresh();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
