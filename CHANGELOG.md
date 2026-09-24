# Changelog

All notable changes to the **RememberMe** app will be documented in this file.

## [0.2.10] - 2026-09-24

### Fixed
- **Note Switching Rendering Bug**: Fixed an issue causing a blank editor screen when switching or creating notes due to duplicate Tiptap extensions.
- **Table of Contents Bug**: Fixed an issue where the TOC dropdown incorrectly displayed headings from previously opened (but hidden) notes when viewing a new or empty note.

---

## [0.2.9] - 2026-09-14


### Added
- **List & Heading Transformation Tools**:
  - Added dedicated **Bullet List** (`<ul>`) and **Numbered List** (`<ol>`) buttons directly on the floating Bubble Menu.
  - Added **Clear Formatting** action (Bubble Menu button + shortcut `Cmd+\` / `Ctrl+\`) to instantly reset selected text to default plain text (clearing headings, lists, codeblocks, bold, italic, underline, strike, colors, links).
  - Added customizable editor shortcuts in Settings for Bullet List (`Cmd/Ctrl+Shift+8`), Numbered List (`Cmd/Ctrl+Shift+7`), Heading 1/2/3 (`Cmd/Ctrl+Alt+1/2/3`), Plain Text (`Cmd/Ctrl+Alt+0`), and Clear Formatting (`Cmd/Ctrl+\`).
  - Added `/bullet`, `/numbered`, and `/h3` commands to the slash command menu (`/`).
- **Heading Hover Tooltip**:
  - Hovering over any heading in the editor displays a sleek capsule tooltip showing its level (`Heading 1`, `Heading 2`, etc.), automatically dismissing on typing, clicking, or scrolling.

---

## [0.2.8] - 2026-09-14

### Added
- **Window Drop Shadow Setting**: Added a toggle in Settings (`Window Shadow`) to dynamically turn on or off the native window drop shadow on macOS and Windows.
- **Tauri Permissions**: Whitelisted `core:window:allow-set-shadow` in capabilities.

### Fixed & Improved
- **IME Composition Compatibility (Vietnamese / CJK)**:
  - Fixed shortcut triggers and unexpected key interceptions during IME input (`isComposing` / `keyCode 229`) in note titles, tags, slash commands, emoji picker, mentions, smart select all, list tabs, lightbox, shortcut recorder, and window listeners.
  - Disabled browser spellcheck/autocorrect/autocapitalize/autocomplete across note titles and tag editors for smoother Vietnamese and multilingual typing.
- **UI Aesthetics**: Refined widget border opacity to blend seamlessly with native window drop shadows.

---

## [0.2.7] - 2026-08-20

### Added
- **File Tree Editor**: Insert and edit ASCII directory trees directly in the editor using `/filetree`, with inline editing, node addition/removal, indent/outdent, and clean ASCII markdown export.
- **Customizable shortcuts**: Every shortcut can now be customized in Settings (Toggle App Window, Toggle Theme, New Note, Notes List, Table of Contents, Settings, Collapse/Expand, Pin/Unpin, Align Left/Center/Right).

### Fixed & Improved
- **Ordered & Bullet List Numbering**: Improved list numbering continuity and reset behavior across editor blocks.
- **Shortcut Persistence**: Fixed shortcut settings reverting on reopen; changes apply immediately on closing Settings.
- **macOS caret & selection bug**: Fixed caret jumping to start of line and selection spilling across the whole line when typing near emojis.
