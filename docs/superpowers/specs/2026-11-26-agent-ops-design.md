# Agent Ops — bảng giám sát Claude Code trên máy

Ngày: 2026-11-26 · Trạng thái: chờ duyệt (bản 2 — sau review UI và quyết định phân phối)

## 1. Mục đích

Người dùng Claude Code chạy nhiều phiên song song, nhiều phiên giao việc cho agent con. Hiện không có cách nào thấy:

- các agent **phối hợp** thế nào: ai giao việc cho ai, ai đang chạy, ai chờ ai, ai nhắn ai;
- các agent **đang dùng gì**: skill, công cụ, MCP server, file, lệnh;
- **tốn bao nhiêu token** (và giá trị quy đổi ra tiền), tốn ở đâu.

Agent Ops là web app chạy trên máy của từng người (localhost), đọc lịch sử phiên có sẵn của các công cụ AI (Claude Code
trước, rồi Codex CLI, Gemini CLI, Cursor, Copilot… — mục 5b) và hiển thị các
thông tin trên, gần như trực tiếp (trễ 1–2 giây). **Người khác cài được trên máy họ** và thấy phiên của chính họ.

**Thành công là:** mở `/agent-ops` (hoặc `node`), thấy ngay phiên nào đang chạy / chờ mình / có lỗi; bấm vào một phiên
thấy cây agent, skill/công cụ, token từng agent; số liệu khớp log; giao diện tiếng Việt hoặc tiếng Anh.

## 2. Mục tiêu / không làm / không được xảy ra

**Mục tiêu**
- 6 màn hình theo mockup v2 (mục 6), trong đó **Sơ đồ đội** là màn trực quan chính, phong cách "sang trọng – khoa học viễn tưởng nhẹ", 3 tông, **song ngữ vi/en**.
- Đọc dữ liệu thật từ thư mục log Claude Code của máy, cả lịch sử lẫn phiên đang chạy, mọi dự án.
- Cập nhật trực tiếp khi log thay đổi.
- Đóng gói để người khác cài: **plugin Claude Code** (lệnh `/agent-ops`) và chạy tay bằng `node` (mục 9).
- Chạy trên Windows, macOS, Linux.

**Không làm (bản này)**
- Không điều khiển agent (dừng, gửi lệnh, duyệt quyền). Hành động duy nhất: sao chép lệnh `claude --resume <id>`,
  mở thư mục dự án.
- Không hooks, không OpenTelemetry, không sửa `settings.json`.
- Không màn hình chung cho nhóm / server trung tâm (là dự án khác nếu cần).
- Không phiên cloud (claude.ai/code) hay phiên trên máy khác — log không nằm trên máy.
- Không panel "Tiến trình & cổng".

**Không được xảy ra**
- Ghi, sửa, xoá bất cứ thứ gì trong thư mục cấu hình Claude Code (chỉ đọc).
- Làm chậm Claude Code (đọc lại toàn bộ log mỗi lần thay đổi, giữ khoá file…).
- Gửi nội dung log ra ngoài máy. Server chỉ nghe `127.0.0.1`. Không telemetry.
- Hiển thị email, token, khoá bí mật lấy từ log (phải che — mục 7).
- Hiển thị sai mà trông như đúng: số ước tính ghi rõ; model chưa có giá hiện "—", không đoán.
- Đóng gói dữ liệu thật của người làm vào plugin (fixture kiểm thử phải là dữ liệu giả).

## 3. Ràng buộc

- Node.js ≥ 20 (có sẵn khi dùng Claude Code). Không cần pnpm, Docker, bước build.
- Thư mục nguồn: `d:\TripOTA\workspace_portal\tools\agent-ops\` (workspace không phải git repo — khi đóng gói
  plugin cần một repo riêng; xem mục 9).
- Thư mục log: `$CLAUDE_CONFIG_DIR/projects` nếu biến có đặt, không thì `~/.claude/projects` (mọi hệ điều hành).
- Định dạng log **không công bố chính thức** → parser chịu lỗi: dòng hỏng / kiểu lạ thì bỏ qua và đếm, không sập.
- Log lớn (máy hiện tại: ~1GB, 129 phiên / 31 ngày, phiên lớn nhất 71 agent) → đọc tăng dần theo byte offset,
  lưu chỉ mục.
- Claude Code tự xoá log cũ (`cleanupPeriodDays`, mặc định ~30 ngày) → chỉ mục giữ **bản tóm tắt** phiên đã bị xoá
  để lịch sử token/chi phí không mất (đánh dấu "log đã xoá").
- Giờ hiển thị theo múi giờ máy; log lưu UTC.

## 4. Các cách đã cân nhắc

| Cách | Ưu | Nhược | Chọn |
|---|---|---|---|
| **A. Server Node đọc log JSONL có sẵn, đẩy cập nhật qua SSE** | Có ngay lịch sử; không sửa cấu hình; đủ token, skill, tool, agent con | Phụ thuộc định dạng log không công bố | **✔** |
| B. Hooks đẩy sự kiện | Trực tiếp thật | Sửa `settings.json`; không có token → vẫn cần A | ✘ (có thể thêm sau) |
| C. OpenTelemetry + Grafana | Số liệu chuẩn | Cần Docker; cây agent không rõ | ✘ |

Phân phối: **mỗi người cài trên máy mình** (đã chọn) thay vì server chung cho nhóm.

## 5. Nguồn dữ liệu (đã kiểm tra trên máy)

```
<config>/projects/<thư-mục-dự-án>/
  <sessionId>.jsonl                                  # agent chính
  <sessionId>/subagents/agent-<agentId>.jsonl        # từng agent con
  <sessionId>/subagents/agent-<agentId>.meta.json    # agentType, description, model, toolUseId, finished, spawnDepth
```

| Bản ghi | Dùng cho |
|---|---|
| `type:"assistant"`, `message.id`, `message.model`, `message.usage{input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens}`, `message.stop_reason` | token/tiền theo model; **cùng `message.id` lặp nhiều dòng → cộng usage một lần**; bỏ model `<synthetic>` |
| `message.content[]` `tool_use` (`id`, `name`, `input`) | công cụ; skill (`Skill` → `input.skill`); giao việc (`Agent` → `input.description/model`); nhắn (`SendMessage`); MCP (`mcp__<server>__<tool>`); file (`input.file_path`); lệnh (`input.command`) |
| `type:"user"` `content[]` `tool_result` (`tool_use_id`, `is_error`); `content` là chuỗi / `text` không bắt đầu bằng `<` | lỗi tool; thời gian chạy tool; tin nhắn thật của người dùng |
| `timestamp` (UTC ISO) | dòng thời gian |
| `aiTitle` | tên phiên; không có → "(chưa đặt tên)" |
| `cwd`, `entrypoint` | dự án (tên thư mục cuối của `cwd`), nơi chạy |
| `attachment.hookEvent` | hook đã chạy |

Liên kết cha–con: `meta.json.toolUseId` = `id` của `tool_use` `Agent` trong log agent cha (có `spawnDepth`).

### 5b. Nhiều công cụ AI — bộ chuyển đổi theo nguồn

Người dùng muốn theo dõi **tất cả** công cụ AI họ dùng, không chỉ Claude Code. Mỗi nguồn có một bộ chuyển đổi
(adapter) đọc dữ liệu riêng của nó và trả về cùng một mô hình chung: `Session → Agent → Event` + `usage` +
**cờ năng lực** (`hasTokens`, `hasSubagents`, `hasSkills`, `hasMcp`, `hasCost`). Giao diện đọc cờ: thiếu dữ liệu nào thì
hiện "—" và ghi nguồn, không đoán. Mọi nguồn đều **chỉ đọc**.

| Nguồn | Vị trí / định dạng (theo tài liệu cộng đồng, chưa kiểm trên máy có cài) | Lấy được | Ghi chú rủi ro |
|---|---|---|---|
| **Claude Code** | `$CLAUDE_CONFIG_DIR|~/.claude/projects/**.jsonl` + `subagents/` | Đầy đủ | Đã kiểm trên máy người dùng |
| **Codex CLI** | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` (bản mới có thể `.jsonl.zst`); dòng đầu `session_meta`; token ở `event_msg` `token_count` (`last_token_usage`, `total_token_usage`) | Phiên, tool, token (input/cached/output/reasoning) | Định dạng nội bộ, đổi theo phiên bản; cần giải nén zstd |
| **Gemini CLI** | `~/.gemini/tmp/<project_hash>/chats/session-*.json` (có bản JSONL); tin nhắn `user`/`gemini`, `tokens` tuỳ chọn | Phiên, tin nhắn, tool, token (có khi thiếu) | Giữ 30 ngày mặc định; trường tuỳ phiên bản |
| **Cursor** | SQLite `…/Cursor/User/globalStorage/state.vscdb`, bảng `cursorDiskKV`: `composerData:<id>`, `bubbleId:<composer>:<bubble>`; chỉ mục theo workspace trong `workspaceStorage/*/state.vscdb` | Phiên, tin nhắn, tool | File có thể hàng chục GB; mở **chỉ đọc**, không khoá; token thường không có; lược đồ có version `_v` |
| **VS Code Copilot Chat** | `…/Code/User/workspaceStorage/<hash>/chatSessions/*.json(l)`; `workspace.json` → thư mục dự án; chế độ agent có thể nằm trong `state.vscdb` | Phiên, tin nhắn, tool | JSON (cũ) và JSONL (mới) |
| **Antigravity** | `~/.gemini/antigravity/conversations/*.pb` + `brain/`, `annotations/*.pbtxt` | Có thể chỉ: số phiên, thời điểm, tiêu đề (nếu đọc được chỉ mục) | Báo cáo cộng đồng: file `.pb` có vẻ mã hoá → **không hứa** đọc nội dung |

Thứ tự làm: Claude Code (đầy đủ) → Codex CLI → Gemini CLI → Cursor → Copilot → Antigravity (khảo sát). Mỗi bộ
chuyển đổi cần **một phiên mẫu thật** từ máy có cài công cụ đó để viết fixture (đã ẩn danh) trước khi làm.
Giao diện: nhãn nguồn trên mọi phiên (chữ cái + màu), bộ lọc nguồn ở thanh trên, cột "Nguồn" trong bảng phiên;
Sơ đồ đội vẫn dùng chung — nguồn không có agent con thì nút phiên chỉ có Hoạt động + Skill/File.

## 6. Màn hình (mockup v2: `docs/mockups/`, đã review theo dashboard-design)

Thanh trên chung: menu **Tất cả phiên · Sơ đồ đội · Màn hình tổng · Phiên · Skill & công cụ · Chi phí**; khoảng thời gian
**Hôm nay / 7 ngày / 30 ngày dùng chung cho mọi màn** (nhớ lựa chọn); **VI / EN**; tông **Graphite / Ice / Pearl**.

1. **Tất cả phiên** (`sessions.html`) — *"đang có gì chạy, có gì chờ tôi?"* Lọc dự án; 6 chỉ số (Đang chạy, Chờ bạn,
   Phiên, Token, Quy đổi, Lỗi tool) mỗi số có mốc so sánh kỳ trước cùng độ dài; thẻ "Đang hoạt động" (chạy + chờ +
   hoạt động trong 2 giờ) có nút Mở và Sao chép lệnh resume; "Song song hôm nay" (làn 15 phút, số phiên cùng lúc, mốc
   giao việc); "Cần chú ý" (mỗi phiên một dòng: cờ + tên + hành động); token theo ngày; bảng phiên sắp xếp được.
2. **Màn hình tổng** (`wall.html`) — *"ngay lúc này có gì kẹt, lỗi, chờ tôi?"* Lưới khung mọi phiên đang mở (số cột
   tăng theo bề rộng: 4+ ở 2560px, 1 khi hẹp); khung có quỹ đạo thu nhỏ, token, quy đổi, ngữ cảnh, tỉ lệ lỗi,
   skill/MCP, làn agent, 4 hoạt động mới; viền cam nhấp nháy = chờ bạn, viền đỏ = lỗi; ô ghim; dải luồng chung;
   Lưới / Tiêu điểm / Toàn màn hình.
3. **Phiên** (`session.html?id=`) — *"agent của phiên này phối hợp ra sao, dùng gì, tốn gì?"* Hai chế độ:
   - **Gọn**: quỹ đạo agent (gom theo vai trò làm việc/review, cụm > 7 hiện "+N", kích thước theo token, tooltip),
     token từng agent (thanh xếp chồng loại token), ma trận agent × nhóm công cụ, dòng thời gian (làn skill + agent +
     mốc giao việc/nhắn), hoạt động có bộ lọc.
   - **Chi tiết**: thêm 2 chỉ số (file thay đổi, skill·MCP); bảng agent (trạng thái, model, đang làm, ngữ cảnh dạng
     thanh có mốc, token, quy đổi, công cụ, file, lỗi, thời gian); Skill & giai đoạn (mỗi skill: số lệnh, file ghi,
     agent con, MCP, lỗi — tính từ log, không văn mô tả); Công cụ (nhóm, lỗi, thời gian TB, MCP con); File (W/E/R).
4. **Skill & công cụ** (`skills.html`) — *"agent dựa vào skill/công cụ nào, cái nào hay lỗi?"* Skill (lần gọi, số
   phiên, gần nhất); chuỗi skill thật trong phiên; công cụ theo nhóm với cờ lỗi > 10% (≥ 20 lệnh); MCP server và lệnh
   con; bản đồ nhiệt tool theo ngày (bậc nhạt, chấm đỏ ngày nhiều lỗi); agent con theo model.
5. **Chi phí** (`cost.html`) — *"tiêu thụ bao nhiêu (quy đổi giá API), đi đâu?"* Quy đổi + mốc kỳ trước; hôm nay;
   TB/phiên; tỉ lệ agent con; model chính; "nhờ cache" (phụ, ước tính); chi phí theo ngày xếp chồng theo loại token
   (hôm nay nét đứt); tiền đi đâu (loại token, model — model chưa có giá hiện "—"); phiên tốn nhất (chính/con, $/giờ);
   bảng giá sửa được; ngân sách tháng dạng thanh có mốc 80% và dự kiến.

6. **Sơ đồ đội** (`graph.html`) — *"các agent phối hợp ra sao, mỗi agent đang làm gì?"* Đồ thị nút kiểu bảng điều
   phối (tham khảo: "runtime-orchestration Graph" + Flare), nền xanh đêm có sao, kéo/cuộn/Fit, mức phóng %:
   - **Tất cả**: nút giữa "Bạn"; mỗi phiên đang hoạt động là một nút (avatar pixel, tên, dự án · model · trạng thái,
     nhãn nguồn) + khung **Hoạt động** (3 lệnh mới nhất, "+N nữa") + cột thẻ agent con: Đang làm / Review / Xong
     (phiên đơn: Skill / File). Bấm phiên → cấp phiên.
   - **Phiên**: nút giữa = agent chính (Hoạt động · Skill theo giai đoạn · Giao việc); xung quanh = agent con (> 8 →
     "+N agent"), mỗi agent: Hoạt động · Nhiệm vụ + file · Công cụ (số lệnh, lỗi). Reviewer nối với worker (Rn ↔ Tn).
   - Đường cong từ giữa tới từng nút; đang chạy → nét chạy + chấm di chuyển. Avatar đang chạy có viền nhịp.
   - **Tô màu theo**: Trạng thái / Token (nhiệt) / Lỗi (tỉ lệ) / Model, có chú giải. **Bố cục**: Vòng / Cột (trái → phải).
   - Rê một nút: nút + đường nối sáng, phần còn lại mờ. Thẻ viền + vạch màu bên trái.
   - Màn **Vũ trụ** đã thử và **bỏ** theo quyết định người dùng (2026-11-26).

**Quy tắc hiển thị (từ review):**
- Màu theo đối tượng: vàng = agent chính, tím = agent làm việc, xanh băng = agent review, hồng = MCP.
  Trạng thái: chấm xanh tĩnh = đang chạy; **cam nhấp nháy = chờ bạn**; đỏ = lỗi/vượt ngưỡng; xám = bình thường.
  Màu cảnh báo phải khác hẳn màu vàng của agent chính.
- Không câu văn trên màn hình: chỉ tên, số, đơn vị, mốc 1–2 từ, chip trạng thái. Giải thích trong tooltip (ⓘ).
- Một số có một giá trị ở mọi nơi; mọi màn tính từ cùng lớp dữ liệu, cùng múi giờ, cùng khoảng thời gian.
- Mốc so sánh: kỳ trước cùng độ dài thời gian đã trôi (hôm nay 00:00→giờ này vs hôm qua cùng giờ); số/thay đổi
  về khối lượng và tiền để màu xám (trung tính); không đủ dữ liệu kỳ trước → "—".
- Lỗi luôn kèm mẫu số (`73 · 4,1%`); chỉ tô đỏ khi vượt ngưỡng.
- Chữ cơ bản 13,5px, chữ phụ đạt tương phản ≥ 4,5:1 trên nền; số dạng tabular, căn phải trong bảng.
- Trang giãn theo màn hình (không giới hạn bề rộng); hẹp (≈ 520px, đặt cạnh trình soạn thảo) không cuộn ngang.
- Trạng thái: đang tải (khung mờ), dữ liệu cũ đang cập nhật (băng nhỏ), lỗi đọc log (một băng cho cả trang),
  chưa có phiên (hướng dẫn chạy Claude Code), phiên log đã xoá (còn tóm tắt).
- Song ngữ: mọi chuỗi qua bảng dịch; số và ngày định dạng theo ngôn ngữ (`19,6M`/`1.401` vs `19.6M`/`1,401`).

## 7. Quy tắc tính toán

- **Token phiên** = tổng usage (khử trùng `message.id`) agent chính + mọi agent con. Gán vào **ngày địa phương** của
  từng lượt để cộng theo khoảng thời gian.
- **Ngữ cảnh** agent = `input + cache_read + cache_creation` của lượt cuối; hiển thị trên cửa sổ 1M, mốc 80%.
- **Tiền quy đổi** = token × bảng giá ($/1M) theo model. Mặc định (sửa được, lưu trong cấu hình):
  Opus 5.5: 4 · 20 · ghi cache 8 · đọc cache 0,20 · Sonnet 5.5: 2 · 10 · 4 · 0,10 · Fable 5.2: 8 · 40 · 16 · 0,20.
  Ghi cache theo cache 1 giờ (2× input). **Model không có trong bảng → đếm token, tiền "—"** (máy hiện tại có
  Haiku 5.5, Sonnet 5, Fable 5.1 chưa có giá).
- **Nhờ cache** = cache_read × (giá input − giá đọc cache), ghi "ước tính".
- **Trạng thái phiên**: *Đang chạy* = log đổi trong 2 phút, hoặc còn `tool_use` chưa có kết quả và đổi trong 15 phút.
  *Chờ bạn* = lượt assistant cuối không gọi tool (hoặc gọi `AskUserQuestion`), không có tin nhắn người dùng sau đó,
  và đổi trong 3 giờ. *Đã dừng* = còn lại.
- **Trạng thái agent con**: `meta.finished` → Hoàn tất; đổi trong 2 phút → Đang chạy; còn lại Đã dừng.
- **Vai trò agent con**: nhãn từ `description` (`Task N` → `TN`, có "review" → `RN`, khác → từ đầu); review nếu
  mô tả có "review".
- **Giai đoạn skill**: từ lần gọi `Skill` đến lần kế tiếp; đếm lệnh, lỗi, file ghi, agent con, MCP trong khoảng.
- **File W/E/R**: `Write`→W, `Edit`/`MultiEdit`/`NotebookEdit`→E, `Read`→R; +/− dòng ước tính.
- **Cần chú ý** (ngưỡng trong cấu hình): chờ bạn; phiên > 8 giờ; > 150M token; > 20 lỗi và tỉ lệ > 3%; tool > 10% lỗi
  (≥ 20 lệnh); ngữ cảnh > 80%; hai phiên đang chạy cùng ghi một file trong 30 phút.
- **Che dữ liệu nhạy cảm** trước khi gửi ra trình duyệt: email → `[email]`; chuỗi giống token (JWT `eyJ…`, `sk-…`,
  chuỗi ≥ 32 ký tự lẫn hoa/thường/số) → `[redacted]`. Lệnh chỉ hiện dòng đầu (bỏ `cd …`, gán biến), cắt ~64 ký tự.
- Không gửi nguyên văn prompt hay kết quả tool ra UI.

## 8. Kiến trúc (quyết định của người làm — Claude)

```
agent-ops/
  .claude-plugin/plugin.json   # khai báo plugin
  commands/agent-ops.md        # /agent-ops: chạy server nền (nếu chưa chạy) rồi mở trình duyệt
  server/
    sources/     # một bộ chuyển đổi cho mỗi công cụ: claude-code, codex, gemini-cli, cursor, copilot, antigravity
                 #   mỗi bộ: detect() → có cài không; scan() → danh sách phiên; read(delta) → Event chuẩn hoá + cờ năng lực
    paths        # tìm thư mục dữ liệu từng nguồn, đa hệ điều hành
    parser       # đọc JSONL tăng dần theo offset, chịu lỗi; SQLite (node:sqlite) mở chỉ đọc cho Cursor/Copilot
    model        # Session → Agent → Event; chỉ số mục 7; che dữ liệu
    index        # tóm tắt + offset trong thư mục dữ liệu riêng của plugin (không nằm trong ~/.claude/projects)
    watcher      # fs.watch + quét dự phòng 2–5 giây
    api          # REST JSON + SSE /events
  web/           # HTML/CSS/JS tĩnh từ mockup v2 (ao2.css, ao2.js + i18n), không bước build
  config.json    # cổng (mặc định 4317), bảng giá, ngân sách, ngưỡng, ngôn ngữ mặc định
  bin/agent-ops.js  # chạy tay: node bin/agent-ops.js [--port] [--open]
  test/          # node:test với fixture JSONL **giả** (sinh bằng script), có ca 70+ agent, dòng hỏng, model lạ
```

- Không phụ thuộc thư viện ngoài nếu có thể (Node chuẩn: http, fs, fs.watch, readline).
- Server chỉ nghe `127.0.0.1`; nếu cổng bận, thử cổng kế; lệnh `/agent-ops` dùng lại server đang chạy.
- Font: đóng gói cục bộ hoặc font hệ thống — không gọi mạng ngoài lúc chạy.

## 9. Phân phối

- **Plugin Claude Code** trong một repo riêng (GitHub/nội bộ), cài qua marketplace của nhóm; người dùng gõ
  `/agent-ops`. Đưa lên chợ plugin công khai hay chỉ nội bộ: quyết định sau, không ảnh hưởng mã.
- **Chạy tay**: `node bin/agent-ops.js` (hoặc `npx` từ repo) cho người không dùng plugin.
- README song ngữ: cài, chạy, cấu hình giá/ngưỡng, quyền riêng tư (chỉ đọc, chỉ localhost, che dữ liệu).

## 10. Để lại cho người lập kế hoạch/làm

- Chi tiết API, cấu trúc module cụ thể, định dạng chỉ mục.
- Cách viết lệnh `/agent-ops` (khởi động nền, kiểm tra đang chạy) theo hướng dẫn plugin hiện hành.
- Thứ tự làm (gợi ý: paths + parser + model + test → Tất cả phiên → Phiên → Màn hình tổng → Skill & công cụ →
  Chi phí → đóng gói plugin).
