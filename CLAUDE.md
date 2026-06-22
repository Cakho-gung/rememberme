# PROJECT CONTEXT FOR AGENTS (RememberMe)

This document provides a high-level overview of the `RememberMe` application architecture, technology stack, and crucial system requirements. **Read this file before making code changes** to understand the established patterns and constraints.

## Technology Stack
- **Frontend**: SvelteKit (SSG/Static Adapter) + Svelte 5 (Runes `$state`, `$derived`, `$props`).
- **Backend/Desktop Integration**: Tauri v2.
- **Styling**: SCSS (Variables + Component-scoped styles). No Tailwind.
- **Rich Text Editor**: Tiptap v2 (with custom extensions for math, emojis, drag-and-drop, images).

## Core Application Architecture
- **Single Page Application**: The app primarily runs inside `src/routes/+page.svelte`. It acts as a floating desktop sticky-note/editor widget.
- **Local File System Storage**: No database or cloud server is used. Data is stored directly on the user's local disk (usually under `Documents/RememberMe/`).
  - Handled in `src/lib/db.ts` via `@tauri-apps/plugin-fs`.
  - Notes are saved as JSON. 
  - Images are saved as base64-decoded files to `Documents/RememberMe/images/`.
- **Global Shortcuts**: 
  - Users can toggle the app window from anywhere using a global shortcut (default: `Cmd/Ctrl + Shift + J`).
  - Managed in `src/lib/globalShortcut.ts` (using `@tauri-apps/plugin-global-shortcut`).
  - Settings are saved to `localStorage` and applied immediately via Svelte (not hardcoded in Rust).

## Key Files & Directories
- `src/routes/+page.svelte`: Main application layout, state manager (menus, dragging, theme, main window events).
- `src/lib/components/Editor.svelte`: The Tiptap rich text editor component.
- `src/lib/components/SettingsPanel.svelte`: UI for app settings (themes, shortcuts, UI scale, timer).
- `src/lib/db.ts`: All file I/O operations (CRUD for notes and images).
- `src/lib/audio.ts`: Handles UI sound effects (hover, click, collapse, theme toggle).
- `src-tauri/src/lib.rs`: Rust backend entry point. Used for custom commands like `save_image` that are too complex/slow for JS.
- `src-tauri/capabilities/default.json`: **CRITICAL FILE**. Tauri v2 enforces strict capability limits. Any new Tauri plugin or window feature must be whitelisted here.

## Important Gotchas & Rules
1. **Tauri Capabilities**: In Tauri v2, if you add a new plugin or use a window API (e.g., `.hide()`, `.show()`), you MUST explicitly add the corresponding permission to `src-tauri/capabilities/default.json`. (e.g., `"core:window:allow-show"`, `"global-shortcut:allow-unregister-all"`).
2. **Mac vs Windows Focus**: macOS WKWebView has unreliable DOM focus events. We rely on Tauri's native `onFocusChanged` for Mac, while using standard DOM `svelte:window` events for Windows. This logic is handled in `+page.svelte`.
3. **No `cat` or `grep` via Bash**: The environment relies on strict tooling rules. Use `grep_search`, `view_file`, or `replace_file_content` directly.
4. **Window Dragging**: Frameless window dragging is implemented using Tauri's `appWindow.startDragging()`. Watch out for pointer event conflicts (e.g., using `PointerEvent` with `setPointerCapture` instead of HTML5 Drag API because Tauri intercepts mouse events).

---
*Agent note: Update this document if you make major architectural changes or introduce new core dependencies.*
