# Cross-Platform Technical Guidelines (macOS & Windows)

Tài liệu này ghi chú các vấn đề kỹ thuật và quy chuẩn phát triển dành cho ứng dụng RememberMe (Tauri + Svelte) để đảm bảo app luôn hoạt động mượt mà và đồng nhất trên cả 2 nền tảng macOS (WebKit) và Windows (Chromium/WebView2). Bất kỳ agent/lập trình viên nào khi phát triển tính năng mới đều **PHẢI** tuân thủ các quy tắc này.

---

## 1. Cấu hình Tauri & Window (Hệ điều hành)
- **Transparent Window trên macOS**: Để thuộc tính `transparent: true` hoạt động trên Mac, bắt buộc phải bật `"macOSPrivateApi": true` trong `tauri.conf.json`. Nếu không, các hiệu ứng đổ bóng, glow vượt ra khỏi ranh giới cửa sổ sẽ bị hệ điều hành cắt xén.
- **Window Focus/Blur Events**: Trình duyệt webview (đặc biệt là WKWebView trên Mac) xử lý các DOM event như `window.onblur` hay `window.onfocus` rất thiếu ổn định (thường bị kích hoạt sai khi mở menu hệ thống hoặc bộ gõ IME).
  👉 **Quy tắc**: Luôn ưu tiên sử dụng Native Events của Tauri (`appWindow.onFocusChanged` từ `@tauri-apps/api/window`) cho các logic liên quan đến trạng thái của cửa sổ app.

## 2. Giao diện & Hiệu ứng (CSS & UI)
- **CSS Masking & Composite**: Khác biệt giữa engine WebKit (Mac) và Chromium (Windows) khiến các thuộc tính phức tạp như `-webkit-mask-composite` dễ bị lỗi hiển thị.
  👉 **Quy tắc**:
  - Tránh dùng giá trị legacy `xor`. Giá trị chuẩn cho WebKit là `destination-out`.
  - Nên ưu tiên các cấu trúc mask đơn giản (như `padding-box` mask) thay vì chồng chéo nhiều layer hình học.
- **Render Pipeline (Filter + Mask/Overflow)**: Nếu áp dụng `filter: blur()` và `mask` (hoặc `overflow: hidden`, `clip`) trên *cùng một thẻ HTML*, blur sẽ bị áp dụng trước, sau đó bị cắt sắc lẹm bởi mask, làm mất độ mềm mại của hiệu ứng.
  👉 **Quy tắc**: Tách biệt hiệu ứng. Dùng HTML Wrapper (thẻ bọc bên ngoài) để chứa `filter: blur()`, và thẻ con bên trong để chứa `mask`.

## 3. Hiệu năng & Tối ưu hóa (Performance)
- **Âm thanh (Audio Engine)**: Gọi lệnh `audio.cloneNode(true)` liên tục (như khi thao tác kéo/drag hoặc hover liên tục) gây tràn bộ nhớ (Memory Leak) và thắt cổ chai Main Thread trên WebKit, dẫn đến giật lag khung hình và delay tiếng.
  👉 **Quy tắc**: Không nhân bản Audio cho các âm thanh phát liên tục/tốc độ cao (tick, hover). Khởi tạo sẵn (pre-load) 1 thẻ Audio duy nhất và tái sử dụng bằng cách gán `audio.currentTime = 0` rồi gọi `play()`.
- **Kéo thả 60fps (Drag/Animation) trong Svelte**: Mặc dù Svelte 5 rất nhanh, nhưng việc trigger thay đổi biến trạng thái (`$state`) cho các style CSS liên tục 60 lần/giây (60fps) thông qua sự kiện `pointermove` vẫn quá sức đối với WebKit.
  👉 **Quy tắc**: Với các hành động kéo thả/animation liên tục, **hãy bypass (bỏ qua) Svelte reactivity cho các thuộc tính nặng**. Sử dụng Javascript thuần (Direct DOM Manipulation) để can thiệp thẳng vào CSS: `element.style.transform = ...` và `element.style.width = ...`. Các thay đổi không đòi hỏi update frame liên tục (như thay đổi class ẩn/hiện) thì vẫn có thể dùng Svelte bình thường.

---

## 4. Rẽ nhánh Logic & Helpers (Cross-Platform Logic)
- **Sử dụng Helper Functions**: Việc gộp mã (Combine codebase) cho cả 2 nền tảng thường xuyên tạo ra các đoạn kiểm tra OS lặp đi lặp lại (Ví dụ: kiểm tra phím tắt Mac vs Win). Nếu lạm dụng rải rác khắp codebase, code sẽ cực kỳ khó đọc và khó bảo trì (Spaghetti code).
  👉 **Quy tắc**: Khuyến khích **khai thác tối đa** các Helper dùng chung. Hãy đóng gói mọi logic rẽ nhánh OS vào một hàm helper duy nhất (Ví dụ: `isModifierPressed(e)`). Bất cứ khi nào phát hiện hành vi khác biệt giữa Mac và Win (phím tắt, xử lý file path, click behavior), việc đầu tiên là trích xuất nó thành một helper.
- **Rẽ nhánh ở mức CSS**: Tránh việc dùng Javascript (Svelte) để `if (isMac)` rồi trả về class hoặc inline-style khác nhau. Điều này làm DOM phải re-render tốn kém.
  👉 **Quy tắc**: Bơm cờ hệ điều hành thẳng lên cấp cao nhất của DOM (ví dụ: `<html data-os="macos">`). Mọi thay đổi giao diện/hiệu ứng riêng biệt giữa Mac và Win phải được giải quyết thuần túy bằng CSS `:global([data-os="macos"])`.

---

> **Note cho các Agent tương lai**: Khi thêm tính năng liên quan đến UI động, âm thanh hoặc tương tác hệ thống, hãy đối chiếu với file này để tránh lặp lại các bug rẽ nhánh (branching bugs) giữa WebKit và Chromium. Mọi tính năng đều phải test bằng tư duy "tiêu chuẩn Web", không dùng các hack riêng cho một trình duyệt cụ thể.
