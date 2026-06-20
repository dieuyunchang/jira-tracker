# Jira Ticket Tracker — Chrome Extension

Tự động theo dõi ticket Jira và bắn thông báo Chrome khi có thay đổi:
**đổi status**, **được assign cho bạn**, **comment mới**, **bị tag tên (mention)**.

Hoạt động **thuần local**: dùng chính session bạn đã đăng nhập Jira trên browser để gọi REST API ngầm — **không cần API token, không cần quyền admin**. Mọi dữ liệu lưu trên máy bạn, không gửi đi đâu.

> Extension không gắn cứng URL Jira nào — bạn tự nhập URL công ty mình trong **Settings**.

---

## Cài đặt (load unpacked)

1. Tải / clone repo này về máy.
2. Mở Chrome → vào `chrome://extensions`.
3. Bật **Developer mode** (góc trên bên phải).
4. Bấm **Load unpacked** → chọn folder `jira-tracker`.
5. Ghim icon extension cho tiện.

## Cấu hình (bắt buộc lần đầu)

1. Chuột phải icon extension → **Options** (hoặc mở popup → **⚙️ Settings**).
2. Nhập **Jira base URL** của công ty bạn, ví dụ `https://jira.company.xyz`.
3. Bấm **Lưu** → Chrome sẽ hỏi cấp quyền truy cập host đó → chọn **Allow**.
4. Đảm bảo bạn **đang đăng nhập Jira** trên browser (bật VPN nếu cần).

> Quyền truy cập chỉ cấp cho đúng host Jira bạn nhập, không phải toàn bộ web.
> Load unpacked nên Chrome có thể nhắc "tắt extension developer" mỗi lần mở — giữ lại là được.

---

## Cách dùng

**Thêm ticket để theo dõi**
- Mở 1 ticket bất kỳ (vd `https://<jira-cua-ban>/browse/EJAR-18937`) → banner góc phải hiện **➕ Theo dõi**.
- Hoặc bấm icon extension → **➕ Thêm page này**.
- Ngoài ra: ticket được **assign cho bạn** sẽ tự thêm (bật/tắt trong Settings).

**Watch list** (bấm icon extension)
- Hiện mã ticket, nhóm theo ngày xem (`Today`, `Yesterday`, …), mới nhất lên trên.
- Click mã ticket → mở tab mới.
- Nút `✕` → gỡ theo dõi.
- **Copy list** (mỗi nhóm ngày) → copy ra clipboard dạng:
  ```
  * EJAR-123 Tên ticket
  * L3S-215 Tên ticket
  ```

**Thông báo**
- Khi có thay đổi, Chrome bắn notification. Click vào → mở thẳng ticket.
- Badge đỏ trên icon = số cập nhật chưa xem (mở popup là reset).

**Tự gỡ**: ticket chuyển sang `Done`, `Released`, `Ready for Production`… sẽ tự gỡ khỏi watch list (danh sách status chỉnh được trong Settings).

---

## Settings

- **Jira base URL** + tần suất poll (mặc định 5 phút).
- **Loại thông báo**: status / assigned / comment / mention — bật tắt riêng.
- **Tự động thêm**: assigned (bật), watcher (tắt), reporter (tắt) — mỗi cái 1 checkbox.
- **Status kết thúc** để tự gỡ.
- **VPN**: khi không vào được Jira → tự **tạm dừng**, chạy lại khi có 1 trang Jira load thành công. Có option "tự dò lại khi tạm dừng" (mặc định tắt).
- **Quiet hours**, giới hạn số ticket, export/import backup.

---

## Hành vi mạng / VPN / sleep

- **VPN off / không vào được Jira** → dừng poll (không spam lỗi). Mở 1 trang Jira thành công → tự chạy lại.
- **Hết phiên đăng nhập** → 1 thông báo nhắc đăng nhập lại Jira.
- **Máy sleep** → không poll; mở máy lại chạy tiếp ở chu kỳ kế tiếp.

---

## Cập nhật phiên bản

Load unpacked không tự update. Khi có bản mới: `git pull` (hoặc thay folder) rồi vào `chrome://extensions` bấm **Reload** ở extension này.

---

## Ghi chú kỹ thuật

- Yêu cầu Jira **Server / Data Center** có REST API v2 truy cập được bằng cookie session
  (thử mở `https://<jira-cua-ban>/rest/api/2/myself` — nếu ra JSON là chạy được).
- Mention phát hiện theo `[~username]` trong comment, cộng fallback theo display name.
- Extension gọi REST API nội bộ bằng session của chính bạn (giống bạn tự refresh trang).
  Nếu công ty có chính sách IT riêng về tự động hoá, nên xác nhận trước.
- Mỗi người cài độc lập, dùng đúng quyền Jira của mình; không chia sẻ dữ liệu giữa các máy.

## License

MIT (xem `LICENSE` nếu có).
