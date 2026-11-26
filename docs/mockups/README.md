# Agent Ops — mockups v2 (sau review dashboard-design)

5 màn: `sessions.html` · `wall.html` · `session.html` (?id=…&v=compact|detail) · `skills.html` · `cost.html`.
Dùng chung `ao2.css` (token màu, 3 tông) và `ao2.js` (song ngữ vi/en, khoảng thời gian chung, định dạng số theo
ngôn ngữ, tooltip, sơ đồ quỹ đạo có gom cụm, trạng thái loading/empty/error qua `?state=`).

Dữ liệu **không** nằm trong thư mục này (log là dữ liệu riêng của từng máy). Tạo bằng:

```
node build-data.js <thư-mục-mockup>/ao-data.js
```

`build-data.js` chỉ đọc `~/.claude/projects` (hoặc `$CLAUDE_CONFIG_DIR/projects`), che email và chuỗi giống
token trước khi ghi. Các trang tham chiếu file qua `/files/…` (máy chủ mockup); khi mở trực tiếp cần sửa đường dẫn.
