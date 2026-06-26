# Jira Ticket Tracker — Chrome Extension

🌐 [Tiếng Việt](README.vn.md) | **English**

Automatically tracks your Jira tickets and fires Chrome notifications on changes:
**status change**, **assigned to you**, **new comment**, **mentioned (tag)**.

Runs **fully local**: it uses your existing logged-in Jira session in the browser to call the REST API in the background — **no API token, no admin rights required**. All data stays on your machine and is never sent anywhere.

> The extension is not hard-wired to any Jira URL — you enter your company URL in **Settings**.

**Key features:** track tickets (auto-add when assigned to you), Chrome notifications on changes, an **Updates** tab showing which ticket changed and what, a **History** tab logging your views with per-item notes + Copy list, auto-pause when VPN drops, and skipping your own actions and noisy comments.

---

## Install (load unpacked)

1. Download / clone this repo.
2. Open Chrome → go to `chrome://extensions`.
3. Enable **Developer mode** (top-right).
4. Click **Load unpacked** → select the `jira-tracker` folder.
5. Pin the extension icon for convenience.

## Configure (required on first run)

1. Right-click the extension icon → **Options** (or open the popup → **⚙️ Settings**).
2. Enter your company **Jira base URL**, e.g. `https://jira.company.xyz`.
3. Click **Save** → Chrome asks for permission to access that host → choose **Allow**.
4. Make sure you are **logged into Jira** in the browser (turn on VPN if needed).

> The permission is granted only for the exact Jira host you enter, not the whole web.
> Because it's loaded unpacked, Chrome may prompt to "disable developer extensions" on each launch — just keep it.

---

## Usage

**Add a ticket to track**
- Open any ticket (e.g. `https://<your-jira>/browse/EJAR-18937`) → a banner appears top-right with **➕ Track**.
- Or click the extension icon → **➕ Add this page**.
- Also: tickets **assigned to you** are added automatically (toggle in Settings).

**Watch list** (click the extension icon)
- Shows ticket keys, grouped by view date (`Today`, `Yesterday`, …), newest on top.
- Click a key → open in a new tab.
- `✕` → unwatch.
- **Copy list** (per day group) → copies to clipboard as:
  ```
  * EJAR-123 Ticket title
  * L3S-215 Ticket title
  ```

**Notifications & the Updates tab**
- On any change, Chrome fires a notification. Click it → opens the ticket directly.
- The red badge on the icon = number of unread updates.
- Click the icon → **🔔 Updates** tab: lists exactly which ticket changed, **what changed** (status / assign / comment / mention) and when. Unread items are highlighted. Click a key → open the ticket.
- A **Unread / All** toggle (All shows up to the 30 most recent) and a **✓ Mark all read** button to clear the badge.
- Clicking a notification also marks that ticket read and decrements the badge.

**🕘 History tab**
- Every ticket you **open/view** is logged here, **grouped by day** (one item per ticket per day — the same ticket viewed on multiple days appears in multiple groups).
- Each item has its own **note** field (what you worked on that day); notes for the same ticket on different days are independent.
- **Copy list** (per day group) or the **⧉** button (copy a single ticket) → copies with the note:
  - Default: `KEY: note`
  - With "include ticket title" on: `KEY ticket-title: note`
  - Items without a note are just `KEY` (or `KEY ticket-title`).
- `✕` removes a single item. History is auto-deleted after the number of days set in Settings (7–60, default 30).

**Skip your own actions**: if the most recent activity on a ticket was done by you (your own comment / status change / self-assign…) it's treated as not-new → no notification.

**Auto-remove**: tickets moved to `Done`, `Released`, `Ready for Production`… are auto-removed from the watch list (the finished-status list is configurable in Settings).

---

## Settings

- **Language / Ngôn ngữ**: English or Vietnamese (switches the whole UI + notification text).
- **Jira base URL** + poll frequency (default 5 minutes).
- **Notification types**: status / assigned / comment / mention — toggle each.
- **Max changes per notification** (default 5) — show only the latest N changes.
- **Ignore comments containing text**: one substring per line; comments containing it won't notify (filters bots/integrations like GitLab merge requests).
- **Auto-add**: assigned (on), watcher (off), reporter (off) — one checkbox each.
- **History**: toggle "include ticket title" in Copy list; retention days (7–60, default 30).
- **Finished statuses** for auto-remove.
- **VPN**: when Jira is unreachable → auto **pause**, resume when a Jira page loads successfully. Optional "auto-retry while paused" (off by default).
- **Quiet hours**, max tracked tickets, export/import backup.

---

## Network / VPN / sleep behavior

- **VPN off / Jira unreachable** → stop polling (no error spam). Open a Jira page successfully → auto-resume.
- **Session expired** → a single notification asking you to log into Jira again.
- **Machine asleep** → no polling; resumes on the next cycle after waking.

---

## Updating

Load unpacked does not auto-update. For a new version: `git pull` (or replace the folder), then go to `chrome://extensions` and click **Reload** on this extension.

---

## Technical notes

- Requires Jira **Server / Data Center** with REST API v2 reachable via cookie session
  (try opening `https://<your-jira>/rest/api/2/myself` — if it returns JSON, it works).
- Mentions are detected by `[~username]` in comments, plus a display-name fallback.
- The extension calls the internal REST API using your own session (the same as you refreshing the page yourself).
  If your company has a specific IT policy on automation, confirm first.
- Everyone installs independently and uses their own Jira permissions; no data is shared between machines.

## License

MIT (see `LICENSE` if present).

---

_made by Yunchang Dieu_
