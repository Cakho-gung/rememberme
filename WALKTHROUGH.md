# RememberMe — Changelog

## [0.2.10] - 2026-09-24

### Fixed
- **Note Switching Rendering Bug**: Fixed an issue causing a blank editor screen when switching or creating notes due to duplicate Tiptap extensions.
- **Table of Contents Bug**: Fixed an issue where the TOC dropdown incorrectly displayed headings from previously opened (but hidden) notes when viewing a new or empty note.

---

## [0.2.9] - 2026-09-14

### Added
- **List & Heading Transformation Tools**: Added dedicated Bullet List and Numbered List buttons on the floating Bubble Menu, and Clear Formatting action (`Cmd+\` / `Ctrl+\`).
- **Heading Hover Tooltip**: Hovering over any heading displays a sleek capsule tooltip showing its level (`Heading 1`, `Heading 2`, etc.).

---

## [0.2.8] - 2026-09-14
### Added
- **Window Drop Shadow Setting**: Added a toggle switch in Settings (`Window Shadow`) allowing users to enable or disable the native operating system window drop shadow dynamically.
- **Window Permissions**: Configured `core:window:allow-set-shadow` Tauri capability to support runtime shadow switching.

### Fixed & Improved
- **IME Composition Compatibility (Vietnamese / CJK)**:
  - Resolved keyboard shortcut and navigation event hijacking during IME text composition (`isComposing` / `keyCode 229`):
    - Note title inline editing & saving
    - Tag input editor (`#tag`)
    - Slash command menu navigation (`/`)
    - Emoji picker popup navigation (`:`)
    - Mention suggestion popup (`@`)
    - Smart select all (`Cmd+A` / `Ctrl+A`)
    - List item indent/outdent (`Tab` / `Shift+Tab`) and `Backspace` handling
    - Lightbox image modal dismiss (`Esc`)
    - Shortcut recorder in Settings Panel
    - Main window global hotkey listener
  - Disabled browser auto-correct, auto-capitalize, and autocomplete on note titles, tags, and editor inputs to prevent intrusive composition interference.
- **Visual Polish**: Adjusted widget border styling to blend harmoniously with native window drop shadows.

---

## [0.2.7] - 2026-08-20

### Added
- **File Tree Editor** — Insert and edit ASCII directory trees directly in the editor using `/filetree`, with inline editing, node addition/removal, indent/outdent, and clean ASCII markdown export.
- **Customizable shortcuts** — Every shortcut can now be changed and is applied in the app: Toggle App Window, Toggle Theme, New Note, Notes List, Table of Contents, Settings, Collapse/Expand, Pin/Unpin, and Align Left/Center/Right.

### Fixed / Minor Updates
- **Ordered & Bullet List Numbering** — Improved list numbering continuity and reset behavior across editor blocks.
- **Shortcut Persistence** — Shortcut changes now persist properly when reopening Settings and apply immediately upon closing.
- **macOS caret & selection bug** — Fixed the caret jumping to the start of the line and the selection spilling across the whole line when typing near emojis.
