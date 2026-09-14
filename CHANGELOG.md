# Changelog

All notable changes to the **RememberMe** app will be documented in this file.

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
