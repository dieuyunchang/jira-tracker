/* options.js — settings page */
(function () {
  "use strict";
  const JT = self.JT;
  const $ = (id) => document.getElementById(id);

  function send(msg) {
    return new Promise((resolve) =>
      chrome.runtime.sendMessage(msg, (r) => {
        void chrome.runtime.lastError;
        resolve(r);
      })
    );
  }

  async function load() {
    const s = await JT.getSettings();
    $("jiraBase").value = s.jiraBase;
    $("pollMinutes").value = s.pollMinutes;

    $("n_status").checked = s.notify.status;
    $("n_assigned").checked = s.notify.assigned;
    $("n_comment").checked = s.notify.comment;
    $("n_mention").checked = s.notify.mention;

    $("a_assigned").checked = s.autoAdd.assigned;
    $("a_watcher").checked = s.autoAdd.watcher;
    $("a_reporter").checked = s.autoAdd.reporter;
    $("lookback").value = s.autoAddLookbackDays;

    $("endStatuses").value = (s.endStatuses || []).join("\n");

    $("pausedAutoProbe").checked = s.pausedAutoProbe;
    $("probeMinutes").value = s.pausedProbeMinutes;

    $("q_enabled").checked = s.quietHours.enabled;
    $("q_start").value = s.quietHours.start;
    $("q_end").value = s.quietHours.end;

    $("maxTracked").value = s.maxTracked;
    $("historyDays").value = s.historyDays;
  }

  function collect() {
    return {
      jiraBase: $("jiraBase").value.trim() || "https://jira.nhc.sa",
      pollMinutes: Math.max(1, parseInt($("pollMinutes").value, 10) || 5),
      notify: {
        status: $("n_status").checked,
        assigned: $("n_assigned").checked,
        comment: $("n_comment").checked,
        mention: $("n_mention").checked,
      },
      autoAdd: {
        assigned: $("a_assigned").checked,
        watcher: $("a_watcher").checked,
        reporter: $("a_reporter").checked,
      },
      autoAddLookbackDays: Math.max(1, parseInt($("lookback").value, 10) || 14),
      endStatuses: $("endStatuses")
        .value.split("\n")
        .map((x) => x.trim())
        .filter(Boolean),
      pausedAutoProbe: $("pausedAutoProbe").checked,
      pausedProbeMinutes: Math.max(5, parseInt($("probeMinutes").value, 10) || 30),
      quietHours: {
        enabled: $("q_enabled").checked,
        start: $("q_start").value || "20:00",
        end: $("q_end").value || "08:00",
      },
      maxTracked: Math.max(10, parseInt($("maxTracked").value, 10) || 100),
      historyDays: Math.max(1, parseInt($("historyDays").value, 10) || 14),
    };
  }

  async function save() {
    await JT.saveSettings(collect());
    await send({ cmd: "reconfigure" });
    const el = $("saved");
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 1500);
  }

  async function exportData() {
    const [{ tracked }, { settings }] = await Promise.all([
      JT.getLocal("tracked"),
      JT.getLocal("settings"),
    ]);
    const blob = new Blob(
      [JSON.stringify({ settings: settings || {}, tracked: tracked || {} }, null, 2)],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "jira-tracker-backup.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function importData() {
    $("importFile").click();
  }

  async function onImportFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const txt = await file.text();
      const data = JSON.parse(txt);
      if (data.settings) await JT.saveSettings(data.settings);
      if (data.tracked) await JT.saveTracked(data.tracked);
      await send({ cmd: "reconfigure" });
      await load();
      alert("Đã import xong.");
    } catch (err) {
      alert("File không hợp lệ: " + err);
    }
    e.target.value = "";
  }

  document.addEventListener("DOMContentLoaded", () => {
    load();
    $("save").addEventListener("click", save);
    $("exportBtn").addEventListener("click", exportData);
    $("importBtn").addEventListener("click", importData);
    $("importFile").addEventListener("change", onImportFile);
  });
})();
