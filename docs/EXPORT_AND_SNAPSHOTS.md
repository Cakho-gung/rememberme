# Quyết định thiết kế: Export & Snapshot (RememberMe)

> Tài liệu này ghi lại các quyết định đã thống nhất trong buổi brainstorm, để tham khảo về sau.
> Ngày chốt: 2026-07-06.

## Bối cảnh & động lực

- Nội dung note đang lưu dưới dạng **ProseMirror/Tiptap JSON** (một số note cũ là **HTML string**). Dạng này khó đọc/khó thao tác bằng mắt thường và tốn token khi đưa cho AI.
- Nhu cầu chính: **trích nội dung ra chữ dễ đọc** để đưa cho agent (Claude…) phân tích, ví dụ đọc note mới rồi đẩy sang Notion; và để chính người dùng đọc lại.
- Kết luận quan trọng: **KHÔNG cần round-trip lossless.** Chấp nhận mất mát định dạng ở các thành phần lạ, miễn giữ được nội dung. Điều này giúp bài toán đơn giản đi rất nhiều.

## Nguyên tắc kiến trúc

1. **Bộ chuyển đổi (converter) là một module thuần**, không phụ thuộc Svelte/Tauri/DOM ở phần lõi (đầu vào JSON → đầu ra chuỗi Markdown). Nhờ vậy **dùng chung được cho cả UI trong app lẫn script cho agent**.
2. **Hai chiều dùng hai công cụ khác nhau** (vì không cần đối xứng):
   - **Export (JSON → Markdown):** serializer tự viết, có **quy tắc fallback: node lạ thì đệ quy lấy phần chữ bên trong**.
   - **Import (Markdown → JSON):** sau này dùng `markdown-it → HTML → Tiptap.setContent()` (Tiptap tự lọc thứ không hiểu).
3. **Markdown lo việc "đọc/chia sẻ/đưa AI" (chấp nhận lossy).** Nếu sau này cần **backup an toàn** thì dùng bản **ZIP native (JSON)** riêng — không ép Markdown gánh vai trò backup.

## Bản đồ chuyển đổi khi Export

| Nhóm | Thành phần | Xuất ra Markdown |
|---|---|---|
| Giữ nguyên | heading, đoạn văn, bold, italic, strike, `code`, code block (giữ `lang`), blockquote, bullet/ordered list, task list, hr, link, bảng đơn giản | Map thẳng (GFM) |
| Xuống cấp có kiểm soát | chữ tô màu / highlight | giữ chữ; màu nhấn → có thể cho về **bold** |
| | underline, sub/sup, text-align | giữ chữ trần |
| | details / callout (khối gập) | summary → dòng đậm/heading; nội dung xổ thành block thường |
| | ảnh | `![alt](path)` giữ đường dẫn/link |
| | math `$...$` | giữ nguyên |
| Bỏ / rút gọn | timer | bỏ (hoặc `[timer]`) |
| | mention @ | `@tên` chữ trần |
| Quy tắc chung | **mọi node không nhận diện được** | **đệ quy lấy phần chữ bên trong** |

## Phạm vi tính năng (đã thống nhất)

### Nhóm 1 — Export (làm trước)
1. **Converter** `noteContentToMarkdown()` — module thuần, tái dùng.
2. **Export một note** (nút ở danh sách note): mặc định **Copy Markdown vào clipboard**, kèm tuỳ chọn **lưu `.md`**.
3. **Export toàn bộ** (trong Settings): gộp thành **một file Markdown lớn** (mỗi note một tiêu đề, ngăn cách rõ), kèm front-matter title/tags.
4. *(Tuỳ chọn)* Script CLI mỏng cho agent gọi trực tiếp converter — **chưa làm đợt này**.

### Nhóm 2 — Snapshot theo ngày ✅ (đã làm — `src/lib/snapshot.ts`)
5. Mỗi khi một note được lưu (`flushPersist`), app **ghi đè một bản chụp** Markdown vào `RememberMe/history/{YYYY-MM-DD}/{id}.md`.
   - Chỉ chụp note có content đã load (đang mở/vừa sửa) → nhẹ; note chưa mở (content null) được **bỏ qua** để không ghi đè bằng nội dung rỗng.
   - Ghi đè file "hôm nay" mỗi lần lưu → cuối ngày là trạng thái cuối cùng. Sang ngày mới, bản ngày cũ **tự đóng băng**.
   - Mỗi file có **YAML front-matter**: `id`, `title`, `tags`, `updatedAt`, `snapshotDate` + body Markdown.
   - Giữ lâu dài; note đã xoá vẫn còn snapshot cũ.
   - **App không tự diff.** Agent đọc các snapshot rồi **tự đối chiếu** để nhận biết thêm/sửa/di chuyển và **dựng timeline**.
   - Truy vấn "ngày X" mà không có snapshot ngày đó → lấy **bản gần nhất ≤ X** (luật phía agent).

### Nhóm 3 — Import (để dành)
6. **Paste-as-Markdown** (`Ctrl+Shift+V`): dán chữ Markdown → tự thành định dạng. Đây mới là dạng import thực dụng nhất.
7. Mở file `.md` thành note mới. (Import từ file = "tính năng ẩn", ít cần.)

## Lưu ý kỹ thuật đã ghi nhận

- **Nội dung nhị nguyên**: content trên đĩa là JSON object *hoặc* HTML string (note cũ) → converter phải xử lý cả hai (normalize trước khi serialize).
- **Ảnh** lưu **đường dẫn tuyệt đối** trong `attrs.title`. Đợt này chỉ giữ path/link, chưa bundle ảnh.
- **Agent ghi ngược vào DB khi app đang mở** dễ đụng cơ chế save của app → chỉ nên cho agent **đọc**; ghi lại tính sau.
- Snapshot Markdown là **lossy → không dùng để restore chính xác**; muốn restore thì phải thêm bản JSON.

## Thứ tự triển khai

1. **Đợt này:** Nhóm 1 (mục 1, 2, 3) → commit → review.
2. **Đợt sau:** Nhóm 2 (mục 5) khi có tín hiệu.
3. **Để dành:** Nhóm 3 (mục 6, 7).
