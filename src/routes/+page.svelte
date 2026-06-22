<script lang="ts">
  import {
    getCurrentWindow,
    LogicalSize,
    LogicalPosition,
  } from "@tauri-apps/api/window";
  import { getVersion } from "@tauri-apps/api/app";
  import { fade, slide } from "svelte/transition";
  import { flip } from "svelte/animate";
  import { onMount, onDestroy, tick } from "svelte";
  import Editor from "$lib/components/Editor.svelte";
  import Lightbox from "$lib/components/Lightbox.svelte";
  import TimerWidget from "$lib/components/TimerWidget.svelte";
  import AnimatedGradientBorder from "$lib/components/AnimatedGradientBorder.svelte";
  import Toast from "$lib/components/Toast.svelte";
  import UpdaterPopup from "$lib/components/UpdaterPopup.svelte";
  import SettingsPanel from "$lib/components/SettingsPanel.svelte";
  import {
    loadNotes,
    saveIndex,
    saveNoteContent,
    deleteNoteData,
    loadNoteContent,
    cleanupOrphanedImages,
    type Note,
  } from "$lib/db";
  import {
    playCollapse,
    playThemeLight,
    playThemeDark,
    playHover,
    requestNotificationPermission,
    loadSoundPreference,
  } from "$lib/audio";
  import { showToast } from "$lib/toastStore";
  import { tooltip } from "$lib/tooltip";
  import { ToastMessages } from "$lib/messages";
  import { checkForAppUpdates } from "$lib/updater";
  import { initOSClass, isMac } from "$lib/osUtils";
  import { getSavedToggleShortcut, applyToggleShortcut } from "$lib/globalShortcut";

  import "highlight.js/styles/tokyo-night-dark.css";
  import "katex/dist/katex.min.css";

  // -- Menu & Editing State --
  let isMenuOpen = $state(false);
  let appVersion = $state("");
  let updateStatusMessage = $state("");
  let isEditingTitle = $state(false);
  let titleEditValue = $state("");
  let isSettingsOpen = $state(false);
  let isTimerActive = $state(false);
  let focusAnimationEnabled = $state(true);
  // Safe to access localStorage here since this is a Tauri app (client-only, no SSR)
  let currentTimerPreset = $state<string>(
    localStorage.getItem("timerPreset") ?? "60m",
  );

  function focus(node: HTMLElement) {
    node.focus();
  }

  let isPinned = $state(true);

  async function closeApp() {
    const appWindow = getCurrentWindow();
    await appWindow.hide();
    isMenuOpen = false;
  }

  async function handleCheckUpdate() {
    updateStatusMessage = "Checking...";
    const result = await checkForAppUpdates();
    if (result.hasUpdate) {
      updateStatusMessage = "";
    } else if (result.error) {
      updateStatusMessage = "Check failed: " + result.error;
      setTimeout(() => {
        updateStatusMessage = "";
      }, 5000);
    } else {
      updateStatusMessage = "Your app is the newest one 🎉";
      setTimeout(() => {
        updateStatusMessage = "";
      }, 3000);
    }
  }

  async function togglePin() {
    isPinned = !isPinned;
    const appWindow = getCurrentWindow();
    await appWindow.setAlwaysOnTop(isPinned);
    isMenuOpen = false;
    showToast(isPinned ? ToastMessages.PINNED : ToastMessages.UNPINNED);
  }

  function handleSettings() {
    isSettingsOpen = true;
    isMenuOpen = false;
  }

  function closeSettings() {
    isSettingsOpen = false;
    focusAnimationEnabled =
      localStorage.getItem("focusAnimationEnabled") !== "false";
    // Refresh timer preset so TimerWidget picks up the new config
    currentTimerPreset = localStorage.getItem("timerPreset") ?? "60m";
  }

  async function startDragging(e: PointerEvent) {
    // Only initiate drag on left mouse button
    if (e.button !== 0) return;

    // Do not drag if clicking on interactive elements
    const target = e.target as HTMLElement;
    if (
      target.closest(
        "button, input, textarea, .text-editor, .dropdown-item, .drag-handle, .title-text-btn, .close-dot, .ProseMirror, .toolbar",
      )
    ) {
      return;
    }

    const appWindow = getCurrentWindow();
    await appWindow.startDragging();
  }

  function toggleMenu() {
    isMenuOpen = !isMenuOpen;
  }

  function createNewNote() {
    const newId = Math.max(0, ...mockNotes.map((n) => n.id)) + 1;
    mockNotes = [
      ...mockNotes,
      {
        id: newId,
        title: "New Note",
        archived: false,
        content: "<p></p>",
      },
    ];
    activeNoteId = newId;
    isMenuOpen = false;
    scheduleSaveIndex();
    scheduleSaveContent(newId, "<p></p>");
    editTitle();
  }

  function editTitle() {
    if (!activeNote) return;
    isEditingTitle = true;
    titleEditValue = activeNote.title;
    isMenuOpen = false;
  }

  function saveTitle() {
    const note = mockNotes.find((n) => n.id === activeNoteId);
    if (note && titleEditValue.trim() !== "") {
      note.title = titleEditValue;
      scheduleSaveIndex();
    }
    isEditingTitle = false;
  }

  function handleTitleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      isEditingTitle = false;
    } else if (e.key === "Enter") {
      saveTitle();
    }
  }

  function archiveNote() {
    const note = mockNotes.find((n) => n.id === activeNoteId);
    if (note) {
      note.archived = true;
      note.archivedAt = Date.now();
      scheduleSaveIndex();
      // Select next unarchived
      const nextUnarchived = mockNotes.find((n) => !n.archived);
      if (nextUnarchived) {
        selectNote(nextUnarchived.id);
      }
    }
    isMenuOpen = false;
  }

  function archiveNoteById(e: Event, id: number) {
    e.stopPropagation();
    const note = mockNotes.find((n) => n.id === id);
    if (note) {
      note.archived = true;
      note.archivedAt = Date.now();
      scheduleSaveIndex();
    }
  }

  // -- Interaction State --
  let isCollapsed = $state(false);
  let isDropdownOpen = $state(false);
  let isTrashOpen = $state(false);
  let menuFocusedIndex = $state(-1);
  let tocFocusedIndex = $state(-1);
  let trashFocusedIndex = $state(-1);

  function openTrash() {
    isTrashOpen = true;
    isMenuOpen = false;
  }

  function closeTrash() {
    isTrashOpen = false;
  }

  function restoreNote(id: number) {
    const note = mockNotes.find((n) => n.id === id);
    if (note) {
      note.archived = false;
      note.archivedAt = undefined;
      scheduleSaveIndex();
      if (!activeNote) {
        selectNote(note.id);
      }
    }
  }

  function permanentlyDeleteNote(id: number) {
    mockNotes = mockNotes.filter((n) => n.id !== id);
    scheduleSaveIndex();
    deleteNoteData(id).then(() => {
      // Run GC after the note JSON is deleted
      cleanupOrphanedImages();
    });
    if (activeNoteId === id) {
      const next = mockNotes.find((n) => !n.archived);
      if (next) selectNote(next.id);
    }
  }

  // -- Drag to Select Tool State --
  let isDotDragging = $state(false);
  let wasDragging = false;
  let dotStartX = $state(0);
  let dotStartY = $state(0);
  let currentPointerX = $state(0);
  let currentPointerY = $state(0);
  let hoveredToolAction = $state<string | null>(null);
  let headings = $state<
    { text: string; level: number; element: HTMLElement; id: string }[]
  >([]);
  let hoveredHeadingId = $state<string | null>(null);
  let hoveredDotNoteId = $state<number | null>(null);
  let editorInstance = $state<any>(null);

  function cleanupDotDragging(target: HTMLElement, pointerId: number) {
    target.removeEventListener("pointermove", onDotPointerMove);
    target.removeEventListener("pointerup", onDotPointerUp);
    target.removeEventListener("pointercancel", onDotPointerCancel);
    target.removeEventListener("lostpointercapture", onDotPointerCancel);
    try {
      target.releasePointerCapture(pointerId);
    } catch (e) {
      // ignore
    }
  }

  function onDotPointerCancel(e: PointerEvent) {
    const target = e.currentTarget as HTMLElement;
    cleanupDotDragging(target, e.pointerId);

    isDotDragging = false;
    hoveredToolAction = null;
    hoveredHeadingId = null;
    hoveredDotNoteId = null;
    isMenuOpen = false;
    isAccentMenuOpen = false;
  }

  let isWindowFocused = $state(true);
  let isTimerAlerting = $state(false);
  let blurTimeout: ReturnType<typeof setTimeout>;

  // Tauri native focus event unlisteners (stored for cleanup on destroy)
  let unlistenFocus: (() => void) | null = null;

  function handleWindowBlur() {
    clearTimeout(blurTimeout);
    // Đợi 300ms, nếu không có focus lại thì mới coi là mất focus thật.
    // Tránh bị nháy (glitch) khi resize cửa sổ hoặc mở overlay menu của OS.
    blurTimeout = setTimeout(() => {
      isWindowFocused = false;
      isDotDragging = false;
      hoveredToolAction = null;
      hoveredHeadingId = null;
      hoveredDotNoteId = null;
      isMenuOpen = false;
      isAccentMenuOpen = false;
    }, 300);
  }

  function dismissTimerAlert() {
    if (isTimerAlerting) {
      isTimerAlerting = false;
    }
  }

  function handleWindowFocus() {
    clearTimeout(blurTimeout); // Hủy lệnh mất focus nếu focus lại quá nhanh
    isWindowFocused = true;

    // Tắt báo thức nếu user focus lại vào app
    dismissTimerAlert();
  }

  async function handleTimerComplete() {
    isTimerAlerting = true;

    // Cập nhật luôn trạng thái UI thành Pinned (để đồng bộ và chắc chắn thực thi trước khi gọi API)
    isPinned = true;

    // Gọi Tauri API để mang cửa sổ lên trên cùng
    try {
      const appWindow = getCurrentWindow();

      // Đảm bảo cửa sổ không bị ẩn hoặc minimize trên Mac trước khi focus
      await appWindow.unminimize();

      // Hack trên macOS: Ẩn và hiện lại cửa sổ để lách luật chống cướp focus (Focus Stealing Prevention)
      await appWindow.hide();
      await appWindow.show();

      // Kích hoạt toàn bộ ứng dụng lên phía trước (rất quan trọng trên macOS)
      const { show: showApp } = await import("@tauri-apps/api/app");
      await showApp();

      // Yêu cầu từ user: nhảy ra giữa màn hình
      await appWindow.center();

      // Hack 2: Bật tắt alwaysOnTop để ép OS tính toán lại Z-index lên cao nhất
      await appWindow.setAlwaysOnTop(false);
      await appWindow.setAlwaysOnTop(true);

      await appWindow.setFocus();
    } catch (e) {
      console.error("Failed to bring window to front:", e);
    }
  }

  function reopenLastArchivedNote() {
    const archivedNotes = mockNotes.filter((n) => n.archived && n.archivedAt);
    if (archivedNotes.length === 0) {
      showToast(ToastMessages.NO_CLOSED_NOTES);
      return;
    }
    const lastArchived = archivedNotes.reduce((prev, current) => {
      return (prev.archivedAt || 0) > (current.archivedAt || 0) ? prev : current;
    });
    restoreNote(lastArchived.id);
    showToast(ToastMessages.REOPENED(lastArchived.title));
  }

  async function handleWindowKeyDown(e: KeyboardEvent) {
    dismissTimerAlert();

    if (e.key === "Escape") {
      if (isSettingsOpen) {
        closeSettings();
        return;
      }
      if (isDropdownOpen) {
        isDropdownOpen = false;
        return;
      }
      isMenuOpen = false;
      isAccentMenuOpen = false;
    }

    // Arrow key + Enter navigation inside TOC
    if (isDropdownOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (headings.length > 0)
          tocFocusedIndex = tocFocusedIndex >= headings.length - 1 ? 0 : tocFocusedIndex + 1;
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (headings.length > 0)
          tocFocusedIndex = tocFocusedIndex <= 0 ? headings.length - 1 : tocFocusedIndex - 1;
        return;
      }
      if (e.key === "Enter" && tocFocusedIndex >= 0) {
        e.preventDefault();
        const focused = headings[tocFocusedIndex];
        if (focused) {
          scrollToHeading(focused);
          isDropdownOpen = false;
        }
        return;
      }
    }

    // Arrow key + Enter navigation inside overlay menu
    if (isMenuOpen && !isAccentMenuOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        menuFocusedIndex = menuFocusedIndex >= dropdownNotes.length - 1 ? 0 : menuFocusedIndex + 1;
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        menuFocusedIndex = menuFocusedIndex <= 0 ? dropdownNotes.length - 1 : menuFocusedIndex - 1;
        return;
      }
      if (e.key === "Enter" && menuFocusedIndex >= 0) {
        e.preventDefault();
        const focused = dropdownNotes[menuFocusedIndex];
        if (focused) {
          selectNote(focused.id);
          isMenuOpen = false;
        }
        return;
      }
    }

    // Arrow key + Enter navigation inside trash overlay
    if (isTrashOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (trashNoteList.length > 0)
          trashFocusedIndex = trashFocusedIndex >= trashNoteList.length - 1 ? 0 : trashFocusedIndex + 1;
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (trashNoteList.length > 0)
          trashFocusedIndex = trashFocusedIndex <= 0 ? trashNoteList.length - 1 : trashFocusedIndex - 1;
        return;
      }
      if (e.key === "Enter" && trashFocusedIndex >= 0) {
        e.preventDefault();
        const note = trashNoteList[trashFocusedIndex];
        if (note) restoreNote(note.id);
        return;
      }
    }

    const isMac = navigator.userAgent.includes("Mac");

    // 1. Primary modifier (Ctrl on Win/Linux, Cmd on Mac)
    const isPrimaryModifier = (isMac && e.metaKey) || (!isMac && e.ctrlKey);

    if (isPrimaryModifier) {
      if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        createNewNote();
        return;
      }

      if (e.key === ",") {
        e.preventDefault();
        handleSettings();
        return;
      }

      if (e.key.toLowerCase() === "o") {
        e.preventDefault();
        isMenuOpen = !isMenuOpen;
        if (isMenuOpen) {
          const activeIdx = dropdownNotes.findIndex(n => n.id === activeNoteId);
          menuFocusedIndex = activeIdx >= 0 ? activeIdx : 0;
        }
        return;
      }

      if (e.key.toLowerCase() === "l") {
        e.preventDefault();
        if (!isCollapsed) {
          isDropdownOpen = !isDropdownOpen;
          if (isDropdownOpen) {
            await tick();
            tocFocusedIndex = headings.length > 0 ? 0 : -1;
          }
        }
        return;
      }

      if (e.key.toLowerCase() === "r" && !e.shiftKey) {
        e.preventDefault();
        editTitle();
        return;
      }

      if (e.key.toLowerCase() === "r" && e.shiftKey) {
        // Ctrl/Cmd+Shift+R → reload (replaces old Ctrl+R browser reload)
        e.preventDefault();
        window.location.reload();
        return;
      }

      if (e.key.toLowerCase() === "i") {
        e.preventDefault();
        toggleTheme();
        return;
      }

      if (e.key.toLowerCase() === "q") {
        e.preventDefault();
        closeApp();
        return;
      }

      if (e.shiftKey && (e.key === "Delete" || e.key === "Backspace")) {
        e.preventDefault();
        const note = mockNotes.find((n) => n.id === activeNoteId);
        if (note) {
          archiveNote();
          showToast(`Archived: "${note.title || 'Untitled Note'}"`);
        }
        return;
      }

    }

    // 2. Alt/Option modifier (Alt on Win, Option on Mac — never metaKey to avoid Cmd+F/T/E conflicts)
    if (e.altKey) {
      // Always use e.code — Option key on Mac produces special chars (e.g. Option+F → ƒ, Option+A → å)
      const code = e.code;

      if (code === "KeyF") {
        e.preventDefault();
        await toggleCollapse();
        return;
      }

      if (code === "KeyE" || code === "KeyT") {
        e.preventDefault();
        await togglePin();
        return;
      }

      // Editor align shortcuts — handled here (not in Tiptap extension) so e.code works on Mac
      if (code === "KeyA") {
        e.preventDefault();
        if (editorInstance?.isActive('image')) {
          editorInstance?.chain().focus().updateAttributes('image', { float: 'left' }).run();
        } else {
          editorInstance?.chain().focus().setTextAlign('left').run();
        }
        return;
      }

      if (code === "KeyH") {
        e.preventDefault();
        if (editorInstance?.isActive('image')) {
          editorInstance?.chain().focus().updateAttributes('image', { float: 'none' }).run();
        } else {
          editorInstance?.chain().focus().setTextAlign('center').run();
        }
        return;
      }

      if (code === "KeyD") {
        e.preventDefault();
        if (editorInstance?.isActive('image')) {
          editorInstance?.chain().focus().updateAttributes('image', { float: 'right' }).run();
        } else {
          editorInstance?.chain().focus().setTextAlign('right').run();
        }
        return;
      }
    }

    // Close trash overlay on Escape or Backspace
    if (isTrashOpen && (e.key === "Escape" || e.key === "Backspace")) {
      e.preventDefault();
      closeTrash();
      return;
    }
  }

  function handleWindowPointerDown(e: PointerEvent) {
    dismissTimerAlert();

    const target = e.target as HTMLElement;

    if (isMenuOpen) {
      if (
        !target.closest(".close-dot") &&
        !target.closest(".toolbar") &&
        !target.closest(".theme-toggle") &&
        !target.closest(".accent-toggle") &&
        !target.closest(".settings-toggle") &&
        !target.closest("#exit-btn") &&
        !target.closest(".accent-menu") &&
        !target.closest(".notes-overlay-container")
      ) {
        isMenuOpen = false;
        isAccentMenuOpen = false;
      }
    }

    if (isDropdownOpen && !isCollapsed) {
      // Keep dropdown open if pointer is inside title-section or dropdown-list
      // (the latter covers drag-handle grabs which bubble out of .title-section)
      if (
        !target.closest(".title-section") &&
        !target.closest(".dropdown-list")
      ) {
        isDropdownOpen = false;
      }
    }
  }

  function onDotPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);

    const rect = target.getBoundingClientRect();
    dotStartX = rect.left + rect.width / 2;
    dotStartY = rect.top + rect.height / 2;
    currentPointerX = e.clientX;
    currentPointerY = e.clientY;
    wasDragging = false;
    hoveredToolAction = null;

    target.addEventListener("pointermove", onDotPointerMove);
    target.addEventListener("pointerup", onDotPointerUp);
    target.addEventListener("pointercancel", onDotPointerCancel);
    target.addEventListener("lostpointercapture", onDotPointerCancel);
  }

  function onDotPointerMove(e: PointerEvent) {
    const dx = Math.abs(e.clientX - dotStartX);
    const dy = Math.abs(e.clientY - dotStartY);

    if (!isDotDragging && (dx > 5 || dy > 5)) {
      isDotDragging = true;
      wasDragging = true;
      if (!isMenuOpen) isMenuOpen = true;
    }

    if (isDotDragging) {
      currentPointerX = e.clientX;
      currentPointerY = e.clientY;

      const el = document.elementFromPoint(e.clientX, e.clientY);
      const toolBtn = el?.closest(".tool-btn") as HTMLElement;
      const newAction =
        toolBtn && toolBtn.dataset.action ? toolBtn.dataset.action : null;

      const tocItem = el?.closest(".toc-item") as HTMLElement;
      const newHeadingId =
        tocItem && tocItem.dataset.id ? tocItem.dataset.id : null;

      const dropdownItem = el?.closest(".dropdown-item") as HTMLElement;
      const newDotNoteId =
        dropdownItem && dropdownItem.dataset.noteId
          ? parseInt(dropdownItem.dataset.noteId)
          : null;

      if (
        (newAction && newAction !== hoveredToolAction) ||
        (newHeadingId && newHeadingId !== hoveredHeadingId) ||
        (newDotNoteId && newDotNoteId !== hoveredDotNoteId)
      ) {
        playHover();
      }

      hoveredToolAction = newAction;
      hoveredHeadingId = newHeadingId;
      hoveredDotNoteId = newDotNoteId;
    }
  }

  function onDotPointerUp(e: PointerEvent) {
    const target = e.currentTarget as HTMLElement;
    cleanupDotDragging(target, e.pointerId);

    if (isDotDragging) {
      isDotDragging = false;
      const action = hoveredToolAction;
      const headingId = hoveredHeadingId;
      const dotNoteId = hoveredDotNoteId;
      hoveredToolAction = null;
      hoveredHeadingId = null;
      hoveredDotNoteId = null;

      if (action) {
        if (action === "create") createNewNote();
        else if (action === "edit") editTitle();
        else if (action === "archive") archiveNote();
        else if (action === "pin") togglePin();
        else if (action === "settings") handleSettings();
        else if (action === "trash") openTrash();
        else if (action === "exit") closeApp();
        else if (action === "theme") toggleTheme();
        else if (action === "accent") toggleAccentMenu();

        if (action !== "accent") {
          isMenuOpen = false;
        }
      } else if (headingId) {
        const found = headings.find((h) => h.id === headingId);
        if (found) {
          scrollToHeading(found);
        }
      } else if (dotNoteId !== null) {
        selectNote(dotNoteId);
        isMenuOpen = false;
      } else {
        isMenuOpen = false;
      }
    }
  }

  function handleDotClick() {
    if (wasDragging) {
      wasDragging = false;
      return;
    }
    toggleMenu();
  }

  let previousSize = { width: 800, height: 600 };

  // -- Theme State --
  let isDarkMode = $state(false);

  /** Returns "Label  Win shortcut" or "Label  Mac shortcut" depending on platform. */
  function tip(label: string, win: string, mac: string): string {
    return `${label}  ${isMac() ? mac : win}`;
  }

  function applyAccentColor(color: (typeof accentColors)[0], dark = isDarkMode) {
    const hex   = (dark && (color as any).darkHex)   ? (color as any).darkHex   : color.hex;
    const hover = (dark && (color as any).darkHover) ? (color as any).darkHover : color.hover;
    const text  = (dark && (color as any).darkText)  ? (color as any).darkText  : color.text;
    document.documentElement.style.setProperty("--color-accent", hex);
    document.documentElement.style.setProperty("--color-accent-hover", hover);
    document.documentElement.style.setProperty("--color-accent-text", text);
    document.documentElement.style.setProperty("--table-cell-mix", color.cellMix ?? "7%");
  }

  function toggleTheme() {
    isDarkMode = !isDarkMode;
    if (isDarkMode) {
      playThemeDark();
      document.documentElement.setAttribute("data-theme", "dark");
      localStorage.setItem("theme", "dark");
    } else {
      playThemeLight();
      document.documentElement.removeAttribute("data-theme");
      localStorage.setItem("theme", "light");
    }
    applyAccentColor(currentAccent, isDarkMode);
  }

  // -- Accent Color State --
  const accentColors = [
    {
      name: "Black",
      hex: "#000000",
      hover: "#333333",
      text: "#ffffff",
      cellMix: "8%",
      darkHex: "#ffffff",
      darkHover: "#cccccc",
      darkText: "#000000",
    },
    {
      name: "Green",
      hex: "#38AA57",
      hover: "#38AA57",
      text: "#ffffff",
      cellMix: "6%",
    },
    {
      name: "Blue",
      hex: "#1484FF",
      hover: "#1484FF",
      text: "#ffffff",
      cellMix: "7%",
    },
    {
      name: "Pink",
      hex: "#E609B2",
      hover: "#E609B2",
      text: "#ffffff",
      cellMix: "5%",
    },
    {
      name: "Orange",
      hex: "#ff6c0aff",
      hover: "#ff6c0aff",
      text: "#ffffff",
      cellMix: "6%",
    },
    {
      name: "Yellow",
      hex: "#F7CF27",
      hover: "#F7CF27",
      text: "#27251eff",
      cellMix: "12%",
    },
    {
      name: "Red",
      hex: "#F3343A",
      hover: "#F3343A",
      text: "#ffffff",
      cellMix: "6%",
    },
    {
      name: "Purple",
      hex: "#8B2DF6",
      hover: "#8B2DF6",
      text: "#ffffff",
      cellMix: "7%",
    },
    {
      name: "Teal",
      hex: "#00c0caff",
      hover: "#00c0caff",
      text: "#ffffff",
      cellMix: "7%",
    },
  ];
  let currentAccent = $state(accentColors[0]);
  let isAccentMenuOpen = $state(false);

  function toggleAccentMenu() {
    isAccentMenuOpen = !isAccentMenuOpen;
  }

  function selectAccentColor(e: Event, color: (typeof accentColors)[0]) {
    e.stopPropagation();
    currentAccent = color;
    applyAccentColor(color);
    localStorage.setItem("accentColor", JSON.stringify(color));
    isAccentMenuOpen = false;
    isMenuOpen = false;
  }

  // -- Notes State --
  let isLoading = $state(true);
  let mockNotes = $state<Note[]>([]);
  let activeNoteId = $state(0);
  let saveIndexTimeout: ReturnType<typeof setTimeout>;
  let saveContentTimeout: ReturnType<typeof setTimeout>;

  // ── Pointer-based Drag-and-Drop for Dropdown Note Sorting ──
  // Using Pointer Events instead of HTML5 DragEvent API because Tauri/WebView2
  // on Windows intercepts mousedown at OS level for frameless window dragging,
  // which kills dragstart before it can fire reliably.
  let draggingNoteId = $state<number | null>(null);
  let hoveredNoteId = $state<number | null>(null);
  let dropPosition = $state<"top" | "bottom">("top");

  // Derived notes for the dropdown (reversed so newest appears at top)
  let dropdownNotes = $derived(
    [...mockNotes].reverse().filter((n) => !n.archived),
  );

  // Internal drag state (not reactive, no need for $state)
  let _dragPointerId: number | null = null;
  let _dragStartX = 0;
  let _dragStartY = 0;
  let _dragActive = false; // true once we've crossed the move threshold

  function reorderNotes(
    draggedId: number,
    targetId: number,
    position: "top" | "bottom",
  ) {
    if (draggedId === targetId) return;
    const draggedVisualIndex = dropdownNotes.findIndex(
      (n) => n.id === draggedId,
    );
    const targetVisualIndex = dropdownNotes.findIndex((n) => n.id === targetId);
    if (draggedVisualIndex === -1 || targetVisualIndex === -1) return;

    let newDropdown = [...dropdownNotes];
    const dIndex = newDropdown.findIndex((n) => n.id === draggedId);
    const [draggedNote] = newDropdown.splice(dIndex, 1);
    const tIndex = newDropdown.findIndex((n) => n.id === targetId);
    const insertIndex = position === "bottom" ? tIndex + 1 : tIndex;
    newDropdown.splice(insertIndex, 0, draggedNote);

    // Map the new visual order back to mockNotes (non-archived slots)
    const newOrderAscending = [...newDropdown].reverse();
    let idx = 0;
    for (let i = 0; i < mockNotes.length; i++) {
      if (!mockNotes[i].archived) {
        mockNotes[i] = newOrderAscending[idx++];
      }
    }
    scheduleSaveIndex();
  }

  function onDragHandlePointerDown(e: PointerEvent, id: number) {
    if (e.button !== 0) return;
    e.stopPropagation(); // Prevent title-row / window drag from capturing
    e.preventDefault(); // Prevent text selection during drag
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);

    _dragPointerId = e.pointerId;
    _dragStartX = e.clientX;
    _dragStartY = e.clientY;
    _dragActive = false;
    // Do NOT set draggingNoteId here — wait for threshold so clicks don't flicker
  }

  function onDragHandlePointerMove(e: PointerEvent, id: number) {
    if (_dragPointerId !== e.pointerId) return;

    const dx = Math.abs(e.clientX - _dragStartX);
    const dy = Math.abs(e.clientY - _dragStartY);
    if (!_dragActive && (dx > 4 || dy > 4)) {
      _dragActive = true;
      draggingNoteId = id; // only dim the item once drag threshold is crossed
    }
    if (!_dragActive) return;

    // Find which dropdown-item the pointer is currently over
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const targetItem = el?.closest(".dropdown-item") as HTMLElement | null;
    if (!targetItem) {
      hoveredNoteId = null;
      return;
    }

    const targetIdAttr = targetItem.dataset.noteId;
    if (!targetIdAttr) return;
    const targetId = parseInt(targetIdAttr);
    if (targetId === id) {
      hoveredNoteId = null;
      return;
    }

    hoveredNoteId = targetId;
    const rect = targetItem.getBoundingClientRect();
    dropPosition = e.clientY < rect.top + rect.height / 2 ? "top" : "bottom";
  }

  function onDragHandlePointerUp(e: PointerEvent, id: number) {
    if (_dragPointerId !== e.pointerId) return;
    const handle = e.currentTarget as HTMLElement;
    try {
      handle.releasePointerCapture(e.pointerId);
    } catch {}

    if (_dragActive && hoveredNoteId !== null) {
      reorderNotes(id, hoveredNoteId, dropPosition);
    }

    // Reset
    draggingNoteId = null;
    hoveredNoteId = null;
    _dragPointerId = null;
    _dragActive = false;
  }

  function onDragHandlePointerCancel(e: PointerEvent) {
    draggingNoteId = null;
    hoveredNoteId = null;
    _dragPointerId = null;
    _dragActive = false;
  }

  function scheduleSaveIndex() {
    clearTimeout(saveIndexTimeout);
    saveIndexTimeout = setTimeout(() => {
      saveIndex(mockNotes);
    }, 500);
  }

  function scheduleSaveContent(id: number, content: any) {
    clearTimeout(saveContentTimeout);
    saveContentTimeout = setTimeout(() => {
      saveNoteContent(id, content);
    }, 500);
  }

  // ── Trash Time Grouping ──
  type TrashTimeGroup =
    | "Today"
    | "Yesterday"
    | "Last 2 days"
    | "Last 3 days"
    | "Last week"
    | "Long time ago";

  function getTrashTimeGroup(archivedAt: number | undefined): TrashTimeGroup {
    if (!archivedAt) return "Long time ago";
    const now = new Date();
    const archived = new Date(archivedAt);

    // Reset to start of day for accurate day-based comparison
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    ).getTime();
    const archivedDayStart = new Date(
      archived.getFullYear(),
      archived.getMonth(),
      archived.getDate(),
    ).getTime();
    const daysDiff = Math.floor(
      (todayStart - archivedDayStart) / (1000 * 60 * 60 * 24),
    );

    if (daysDiff === 0) return "Today";
    if (daysDiff === 1) return "Yesterday";
    if (daysDiff === 2) return "Last 2 days";
    if (daysDiff === 3) return "Last 3 days";
    if (daysDiff <= 7) return "Last week";
    return "Long time ago";
  }

  const trashGroupOrder: TrashTimeGroup[] = [
    "Today",
    "Yesterday",
    "Last 2 days",
    "Last 3 days",
    "Last week",
    "Long time ago",
  ];

  let groupedTrashNotes = $derived.by(() => {
    const archivedNotes = mockNotes.filter((n) => n.archived);
    const groups = new Map<TrashTimeGroup, typeof archivedNotes>();
    for (const note of archivedNotes) {
      const group = getTrashTimeGroup(note.archivedAt);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push(note);
    }
    // Return in order
    return trashGroupOrder
      .filter((g) => groups.has(g))
      .map((g) => ({ label: g, notes: groups.get(g)! }));
  });

  let trashNoteList = $derived(groupedTrashNotes.flatMap((g) => g.notes));

  onMount(async () => {
    // Detect OS and add data-os attribute to <html> for platform-specific CSS
    initOSClass();

    // Initialize global shortcut
    applyToggleShortcut(getSavedToggleShortcut());

    /*
     * On macOS, standard DOM window.blur/focus events are unreliable inside WKWebView.
     * The web events can fire at wrong times (e.g., when opening system menus, typing
     * in IME, or during window resize). We use Tauri’s native window focus events
     * which are dispatched directly from the AppKit layer and are always accurate.
     *
     * On Windows, DOM events are reliable so we keep using svelte:window bindings there.
     */
    if (isMac()) {
      const appWindow = getCurrentWindow();
      unlistenFocus = await appWindow.onFocusChanged(({ payload: focused }) => {
        if (focused) {
          clearTimeout(blurTimeout);
          isWindowFocused = true;
          dismissTimerAlert();
        } else {
          clearTimeout(blurTimeout);
          blurTimeout = setTimeout(() => {
            isWindowFocused = false;
            isDotDragging = false;
            hoveredToolAction = null;
            hoveredHeadingId = null;
            hoveredDotNoteId = null;
            isMenuOpen = false;
            isAccentMenuOpen = false;
          }, 300);
        }
      });
    }
    const savedTheme = localStorage.getItem("theme");
    if (savedTheme === "dark") {
      isDarkMode = true;
      document.documentElement.setAttribute("data-theme", "dark");
    }

    const savedAccent = localStorage.getItem("accentColor");
    if (savedAccent) {
      try {
        const savedColor = JSON.parse(savedAccent);
        // Look up by name OR hex to handle saved colors across version changes
        const matchedColor = accentColors.find(
          (c) => c.name === savedColor.name || c.hex === savedColor.hex,
        ) ?? { ...savedColor, cellMix: savedColor.cellMix ?? "7%" };
        currentAccent = matchedColor;
        applyAccentColor(matchedColor);
      } catch (e) {}
    } else {
      applyAccentColor(currentAccent);
    }

    // Load sound preference from localStorage
    loadSoundPreference();

    // Load Focus Animation setting from localStorage
    focusAnimationEnabled =
      localStorage.getItem("focusAnimationEnabled") !== "false";

    // Load UI scale preference from localStorage
    const savedScale = localStorage.getItem("uiScale");
    if (savedScale) {
      const scaleMap: Record<string, string> = {
        small: "1",
        medium: "1.15",
        large: "1.30",
      };
      const scaleValue = scaleMap[savedScale];
      if (scaleValue) {
        document.documentElement.style.setProperty("--ui-scale", scaleValue);
      }
    }

    // Xin quyền gửi thông báo khi khởi động app
    await requestNotificationPermission();

    const notes = await loadNotes();
    if (notes.length > 0) {
      mockNotes = notes;
      // Select the first non-archived note
      const first = mockNotes.find((n) => !n.archived);
      if (first) {
        activeNoteId = first.id;
        if (first.content === null) {
          first.content = await loadNoteContent(first.id);
        }
      }
    } else {
      mockNotes = [
        {
          id: 1,
          title: "Welcome to RememberMe",
          archived: false,
          content: `<h1>Welcome to RememberMe! 🚀</h1>
<p>Here is a guide to all the syntaxes and features supported in this editor:</p>
<hr>

<h3>1. Slash Commands (/)</h3>
<p>Type <code>/</code> on a new line to open the powerful slash menu. It lets you quickly insert Headings, Lists, Tables, Call outs, Timers, and more.</p>

<h3>2. Text Formatting</h3>
<ul>
  <li><strong>Bold</strong>: <code>**text**</code> or <kbd>Ctrl</kbd> + <kbd>B</kbd></li>
  <li><em>Italic</em>: <code>*text*</code> or <kbd>Ctrl</kbd> + <kbd>I</kbd></li>
  <li><s>Strikethrough</s>: <code>~~text~~</code></li>
  <li><code>Inline Code</code>: <code>\`text\`</code></li>
  <li>Color Highlight: Select text and pick a color from the popup menu! <span style="background-color: #ffd8d9; color: #cc0000; padding: 2px 4px; border-radius: 4px;">Like this</span></li>
</ul>

<h3>3. Emoji Support 🥳</h3>
<p>Type <code>:</code> to open the full Emoji Picker, or use common shortcuts like <code>&lt;3</code> (❤️) and <code>:D</code> (😃). The emoji menu supports full fallback images for older OS versions!</p>

<h3>4. Call Out (Collapsible Details)</h3>
<p>Use <code>/call</code> to insert a sleek, Notion-style collapsible block. It defaults to expanded so you can easily type the title and content.</p>
<details data-type="details" open><summary>Try clicking me to collapse!</summary><div data-type="detailsContent"><p>This content is hidden when collapsed.</p></div></details>

<h3>5. Smart Lists & Checklists</h3>
<p>Bullet lists (<code>* </code>), Numbered lists (<code>1. </code>), and Task lists (<code>[ ] </code>) are all supported. Numbered lists automatically feature multi-level numbering (e.g. 1.1, 1.2.1) when nested!</p>
<ul data-type="taskList">
  <li data-type="taskItem" data-checked="false"><label><input type="checkbox"></label><div><p>Plan the next feature</p></div></li>
  <li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked></label><div><p>Build the rich text editor</p></div></li>
</ul>

<h3>6. Focus Timer</h3>
<p>Type <code>/timer</code> to insert a Focus Timer directly into your notes! You can choose duration (10m, 15m, 25m, 30m, 60m) and start working immediately.</p>
<div data-type="timer"></div>

<h3>7. Code & Blockquotes</h3>
<blockquote><p><strong>Blockquote</strong>: Type <code>&gt; </code> followed by a space.</p></blockquote>
<pre><code class="language-javascript">// Code Block: Type \`\`\` and press Space
const greet = () => console.log("Hello RememberMe!");</code></pre>

<h3>8. Images & Tables</h3>
<p><strong>Images</strong>: Copy &amp; Paste any image into the editor. Click the image to reveal a popup menu to resize or align (Left, Center, Right, Full Width).</p>
<p><strong>Tables</strong>: Type <code>/table</code>. Click inside to easily add or delete rows and columns.</p>

<h3>9. Links & Mentions</h3>
<p>Auto-links URLs on paste, or select text and click 🔗. Type <code>@</code> to open the mentions menu and tag users dynamically.</p>

<h3>10. Smart Typography & Math</h3>
<p>Type <code>(c)</code> for ©, <code>-&gt;</code> for →. Type <code>$E=mc^2$</code> for inline math or <code>$$</code> for block equations.</p>
`,
        },
      ];
      activeNoteId = 1;
      await saveIndex(mockNotes);
      await saveNoteContent(1, mockNotes[0].content);
    }
    isLoading = false;

    // Run Garbage Collection for orphaned images on app startup
    cleanupOrphanedImages();

    // Check for app updates
    appVersion = await getVersion();
    checkForAppUpdates();
  });

  // Cleanup Tauri native listeners on component destroy
  onDestroy(() => {
    unlistenFocus?.();
    clearTimeout(blurTimeout);
  });

  let activeNote = $derived(
    mockNotes.find((n) => n.id === activeNoteId && !n.archived) ||
      mockNotes.find((n) => !n.archived),
  );

  async function selectNote(id: number) {
    activeNoteId = id;
    isDropdownOpen = false;
    const note = mockNotes.find((n) => n.id === id);
    if (note && note.content === null) {
      note.content = await loadNoteContent(id);
    }
  }

  // Selector dùng chung để query headings
  const HEADING_SELECTOR =
    "#note-scroll-area .ProseMirror h1, " +
    "#note-scroll-area .ProseMirror h2, " +
    "#note-scroll-area .ProseMirror h3, " +
    "#note-scroll-area .ProseMirror h4, " +
    "#note-scroll-area .ProseMirror h5, " +
    "#note-scroll-area .ProseMirror h6";

  function updateHeadings() {
    if (isCollapsed) {
      headings = [];
      return;
    }
    const elements = document.querySelectorAll(HEADING_SELECTOR);
    headings = Array.from(elements).map((el, index) => {
      const htmlEl = el as HTMLElement;
      return {
        text: htmlEl.innerText || htmlEl.textContent || "",
        level: parseInt(htmlEl.tagName.substring(1)),
        element: htmlEl,
        id: String(index), // lưu index thay vì inject id vào DOM
      };
    });
  }

  $effect(() => {
    if (isDropdownOpen || isMenuOpen) {
      tick().then(() => {
        updateHeadings();
      });
    }
  });

  $effect(() => {
    if (!isMenuOpen) {
      menuFocusedIndex = -1;
    } else if (menuFocusedIndex >= 0) {
      tick().then(() => {
        document.querySelector('.dropdown-item.keyboard-focused')?.scrollIntoView({ block: 'nearest' });
      });
    }
  });

  $effect(() => {
    if (!isDropdownOpen) {
      tocFocusedIndex = -1;
    } else if (tocFocusedIndex >= 0) {
      tick().then(() => {
        const items = document.querySelectorAll('.toc-dropdown .toc-item');
        (items[tocFocusedIndex] as HTMLElement)?.scrollIntoView({ block: 'nearest' });
      });
    }
  });

  $effect(() => {
    if (!isTrashOpen) {
      trashFocusedIndex = -1;
    } else if (trashFocusedIndex >= 0) {
      tick().then(() => {
        document.querySelector('.trash-item.keyboard-focused')?.scrollIntoView({ block: 'nearest' });
      });
    }
  });

  function scrollToHeading(heading: { id: string; element: HTMLElement }) {
    // lưu index (heading.id là string của số index)
    const headingIndex = parseInt(heading.id);

    // Đóng menu trước
    isMenuOpen = false;

    // Đợi menu fade-out (150ms) + DOM ổn định
    setTimeout(async () => {
      await tick();

      // Re-query tất cả headings sau khi DOM ổn định (ProseMirror đã re-render xong)
      const allHeadings = Array.from(
        document.querySelectorAll(HEADING_SELECTOR),
      );
      const targetEl = allHeadings[headingIndex] as HTMLElement | undefined;

      console.log("[TOC] scrollToHeading", {
        headingIndex,
        totalHeadings: allHeadings.length,
        targetEl,
        found: !!targetEl,
      });

      if (!targetEl) {
        console.warn("[TOC] Heading not found at index:", headingIndex);
        return;
      }

      // Tìm scrollable container bằng id duy nhất
      const scrollContainer = document.getElementById(
        "note-scroll-area",
      ) as HTMLElement | null;

      console.log(
        "[TOC] scrollContainer",
        !!scrollContainer,
        "scrollTop",
        scrollContainer?.scrollTop,
        "clientHeight",
        scrollContainer?.clientHeight,
      );

      if (scrollContainer) {
        const containerRect = scrollContainer.getBoundingClientRect();
        const elRect = targetEl.getBoundingClientRect();
        // Vị trí tuyệt đối của element trong scrollContainer
        const relativeTop =
          elRect.top - containerRect.top + scrollContainer.scrollTop;
        // Đặt heading vào vị trí ~20% từ trên xuống
        const targetScrollTop = Math.max(
          0,
          relativeTop - scrollContainer.clientHeight * 0.2,
        );

        console.log(
          "[TOC] Scrolling to",
          targetScrollTop,
          "(relativeTop:",
          relativeTop,
          ")",
        );
        scrollContainer.scrollTo({ top: targetScrollTop, behavior: "smooth" });
      } else {
        console.warn(
          "[TOC] No #note-scroll-area found, using scrollIntoView fallback",
        );
        targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
      }

      // Highlight pulse
      targetEl.classList.add("highlight-pulse");
      setTimeout(() => targetEl.classList.remove("highlight-pulse"), 1500);
    }, 160);
  }

  // Smart Drag vs Click handling
  let dragStartX = 0;
  let dragStartY = 0;
  let isPointerDown = false;

  function onTitlePointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    isPointerDown = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
  }

  async function onTitlePointerMove(e: PointerEvent) {
    if (!isPointerDown) return;
    const dx = Math.abs(e.clientX - dragStartX);
    const dy = Math.abs(e.clientY - dragStartY);

    // If dragged more than 3 pixels, initiate Tauri window drag
    if (dx > 3 || dy > 3) {
      isPointerDown = false;
      const el = e.currentTarget as HTMLElement;
      el.releasePointerCapture(e.pointerId);

      const appWindow = getCurrentWindow();
      await appWindow.startDragging();
    }
  }

  function onTitlePointerUp(e: PointerEvent) {
    if (!isPointerDown) return;
    isPointerDown = false;
    const el = e.currentTarget as HTMLElement;
    el.releasePointerCapture(e.pointerId);

    // It was a click (didn't move much)
    toggleDropdown();
  }
  async function toggleCollapse() {
    playCollapse();
    const appWindow = getCurrentWindow();

    // Read live UI scale so OS window dimensions match zoomed content
    const uiScale =
      parseFloat(
        document.documentElement.style.getPropertyValue("--ui-scale") ||
          getComputedStyle(document.documentElement).getPropertyValue(
            "--ui-scale",
          ),
      ) || 1;
    const collapsedH = Math.round(50 * uiScale);
    const minExpandH = Math.round(249 * uiScale);
    const minW = Math.round(356 * uiScale);

    if (!isCollapsed) {
      // 1. Calculate current size
      const size = await appWindow.innerSize();
      const scale = await appWindow.scaleFactor();
      const w = size.width / scale;
      const h = size.height / scale;

      if (h > collapsedH + 10) {
        previousSize = { width: w, height: h };
      } else {
        previousSize.width = w;
      }

      isDropdownOpen = false;
      isCollapsed = true;

      // 2. Shrink OS window instantly
      await appWindow.setMinSize(new LogicalSize(minW, collapsedH));
      await appWindow.setSize(new LogicalSize(previousSize.width, collapsedH));
      await appWindow.setMaxSize(new LogicalSize(9999, collapsedH));
    } else {
      // 1. Prepare to expand: remove max constraints first
      await appWindow.setMaxSize(new LogicalSize(9999, 9999));

      // Read live width — user may have resized while collapsed, so don't use stale previousSize.width
      const currentSize = await appWindow.innerSize();
      const scale = await appWindow.scaleFactor();
      const currentWidth = currentSize.width / scale;

      const targetHeight = Math.max(minExpandH, previousSize.height);

      isCollapsed = false;

      // 2. Expand OS window instantly
      await appWindow.setSize(new LogicalSize(currentWidth, targetHeight));
      await appWindow.setMinSize(new LogicalSize(minW, minExpandH));
    }
  }

  function toggleDropdown() {
    if (isCollapsed) return; // Don't open dropdown if collapsed
    isDropdownOpen = !isDropdownOpen;
  }

  let lastHoveredBtn: Element | null = null;
  function handleGlobalMouseOver(e: MouseEvent) {
    if (!(e.target instanceof Element)) return;
    const btn = e.target.closest(
      ".tool-btn, .title-icon-btn, .timer-btn, .archive-item-btn, .dropdown-item, .trash-item-actions button, .trash-back-btn, .trash-icon-btn, .close-dot",
    );
    if (btn && btn !== lastHoveredBtn) {
      playHover();
      lastHoveredBtn = btn;
    } else if (!btn) {
      lastHoveredBtn = null;
    }
  }
</script>

<svelte:window
  onblur={handleWindowBlur}
  onfocus={handleWindowFocus}
  onpointerdown={handleWindowPointerDown}
  onkeydown={handleWindowKeyDown}
  onmouseover={handleGlobalMouseOver}
/>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<main class="app-container" onscroll={(e) => { const el = e.currentTarget; el.scrollTop = 0; el.scrollLeft = 0; }}>
  <AnimatedGradientBorder
    ringWidth="24px"
    borderRadius="8px"
    blur="64px"
    saturation="200%"
    animationDuration="3s"
    isFocused={(isWindowFocused && focusAnimationEnabled) || isTimerAlerting}
    forceVisible={isTimerAlerting}
  />
  <Toast />
  <UpdaterPopup />
  <div
    class="glass-widget"
    class:collapsed={isCollapsed}
    class:glow-active={(isWindowFocused && focusAnimationEnabled) ||
      isTimerAlerting}
    class:timer-alerting={isTimerAlerting}
    style="background-color: {isWindowFocused
      ? 'var(--bg-focused)'
      : 'var(--bg-unfocused)'}; transition: background-color 0.3s ease; height: 100%;"
    onscroll={(e) => { const el = e.currentTarget; el.scrollTop = 0; el.scrollLeft = 0; }}
  >
    <!-- Expanded drag region to cover top padding -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="top-drag-zone"
      onpointerdown={onTitlePointerDown}
      onpointermove={onTitlePointerMove}
      onpointerup={onTitlePointerUp}
    ></div>

    <!-- Main inner column: Title + Editor + Timer -->
    <div class="inner-column">
      <!-- Title section -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="title-section {isDropdownOpen ? 'expanded' : ''}">
        <!-- First title row (visible) -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <!-- Note: NO onpointerdown=startDragging here — it would intercept HTML5 drag events
             from dropdown-items. Window dragging is handled inside each child that needs it. -->
        <div class="title-row">
          <!-- Title text (draggable button when not editing, input when editing) -->
          {#if isEditingTitle}
            <div class="title-text-btn">
              <input
                type="text"
                class="title-input"
                bind:value={titleEditValue}
                onkeydown={handleTitleKeyDown}
                onblur={saveTitle}
                use:focus
                spellcheck="false"
              />
            </div>
          {:else}
            <button
              class="title-text-btn"
              onpointerdown={onTitlePointerDown}
              onpointermove={onTitlePointerMove}
              onpointerup={onTitlePointerUp}
            >
              <span class="title-text"
                >{activeNote?.title || "No note selected"}</span
              >
            </button>
          {/if}

          <!-- Chevron icon for collapse/expand -->
          <button
            class="title-icon-btn"
            onclick={toggleCollapse}
            aria-label="Toggle Collapse"
            use:tooltip={{ text: isCollapsed ? tip('Expand', 'Alt+F', '⌥F') : tip('Collapse', 'Alt+F', '⌥F'), position: 'bottom' }}
          >
            <svg
              class="title-icon"
              class:collapsed={isCollapsed}
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="currentColor"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M7.66988 5.49915C7.90277 5.34536 8.21875 5.37127 8.42378 5.5763L12.4238 9.5763C12.6581 9.81062 12.6581 10.1896 12.4238 10.424C12.1895 10.6583 11.8104 10.6583 11.5761 10.424L7.99995 6.84779L4.42378 10.424C4.18947 10.6583 3.81044 10.6583 3.57613 10.424C3.34181 10.1896 3.34181 9.81062 3.57613 9.5763L7.57613 5.5763L7.66988 5.49915Z"
                fill="currentColor"
              />
            </svg>
          </button>
        </div>

        <!-- Dropdown Table of Contents -->
        {#if isDropdownOpen && !isCollapsed}
          <div
            class="dropdown-list toc-dropdown"
            transition:slide={{ duration: 200 }}
            style="padding: 0 12px 16px 12px; gap: 4px;"
          >
            {#each headings as heading, headingIdx}
              <button
                class="toc-item level-{heading.level}"
                class:drag-hover={hoveredHeadingId === heading.id || tocFocusedIndex === headingIdx}
                data-id={heading.id}
                onclick={() => {
                  scrollToHeading(heading);
                  toggleDropdown();
                }}
              >
                <span class="toc-bullet">•</span>
                <span class="toc-text">{heading.text}</span>
              </button>
            {:else}
              <div class="toc-empty" style="opacity: 0.5; padding: 4px 8px;">
                (。・・)ノ No heading found
              </div>
            {/each}
          </div>
        {/if}
      </div>

      {#if !isCollapsed}
        <!-- Text editor area -->
        <div class="text-editor" id="note-scroll-area">
          {#if !isLoading && activeNote && activeNote.content !== null}
            <Editor
              noteId={activeNote.id}
              content={activeNote.content}
              bind:editor={editorInstance}
              onUpdate={(content) => {
                if (activeNote) {
                  activeNote.content = content;
                  scheduleSaveContent(activeNote.id, content);
                }
              }}
            />
          {/if}
        </div>

        <!-- Editor Fade Overlay (Solid color with mask, transitions perfectly with glass-widget) -->
        <div
          class="editor-fade-overlay"
          style="background-color: {isWindowFocused
            ? 'var(--bg-focused)'
            : 'var(--bg-unfocused)'}"
        ></div>
      {/if}

      <!-- Timer row: luôn mount để tránh reset timer khi collapse. Ẩn bằng CSS khi cần. -->
      <div
        class="timer-row delay-5"
        class:timer-hidden={isCollapsed || isSettingsOpen}
      >
        <TimerWidget
          onComplete={handleTimerComplete}
          timerPreset={currentTimerPreset}
          bind:isActive={isTimerActive}
        />
      </div>
    </div>

    <!-- Menu dot: absolute top-right (hidden when settings panel is open) -->
    {#if !isSettingsOpen}
      <button
        class="close-dot {isMenuOpen ? 'active' : ''}"
        aria-label="Menu"
        onpointerdown={onDotPointerDown}
        onclick={handleDotClick}
      ></button>
    {/if}

    <!-- Overlay Menu -->
    {#if isMenuOpen}
      <div class="menu-overlay" out:fade={{ duration: 150 }}>
        <!-- Close dot replica for closing menu without layout shift, though original is above it -->
        <div class="toolbar">
          <button
            class="tool-btn delay-5"
            class:drag-hover={hoveredToolAction === "create"}
            data-action="create"
            onclick={createNewNote}
            aria-label="Create Note"
            use:tooltip={{ text: tip('Create Note', 'Ctrl+N', '⌘N') }}
          >
            <svg
              class="tool-icon"
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="currentColor"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M7.50024 12.6665V8.50049H3.33325C3.05722 8.50049 2.83343 8.27648 2.83325 8.00049C2.83325 7.72435 3.05711 7.50049 3.33325 7.50049H7.50024V3.3335C7.50024 3.05735 7.7241 2.8335 8.00024 2.8335C8.27624 2.83367 8.50024 3.05746 8.50024 3.3335V7.50049H12.6663C12.9424 7.50049 13.1663 7.72435 13.1663 8.00049C13.1661 8.27648 12.9423 8.50049 12.6663 8.50049H8.50024V12.6665C8.50024 12.9425 8.27624 13.1663 8.00024 13.1665C7.7241 13.1665 7.50024 12.9426 7.50024 12.6665Z"
                fill="currentColor"
              />
            </svg>
          </button>
          <button
            class="tool-btn delay-4"
            class:drag-hover={hoveredToolAction === "edit"}
            data-action="edit"
            onclick={editTitle}
            aria-label="Edit Title"
            use:tooltip={{ text: tip('Rename Note', 'Ctrl+R', '⌘R') }}
          >
            <svg
              class="tool-icon"
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="currentColor"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M13.5002 3.69092C13.5002 3.37499 13.3749 3.07157 13.1515 2.84814C12.9281 2.62476 12.6247 2.49955 12.3087 2.49951C11.993 2.49953 11.6903 2.625 11.4669 2.84814L3.45816 10.8589C3.37707 10.9399 3.31695 11.0394 3.28336 11.1489L2.59976 13.3989L4.85269 12.7163C4.9623 12.683 5.06257 12.6234 5.14371 12.5425L13.1515 4.53369C13.3749 4.3103 13.5001 4.00686 13.5002 3.69092ZM13.4005 12.8999C13.6765 12.9001 13.9005 13.1239 13.9005 13.3999C13.9005 13.6759 13.6765 13.8997 13.4005 13.8999H8.59976C8.32381 13.8997 8.09976 13.6759 8.09976 13.3999C8.09981 13.1239 8.32384 12.9001 8.59976 12.8999H13.4005ZM14.5002 3.69092C14.5001 4.27203 14.2695 4.82983 13.8586 5.24072L5.84976 13.2505C5.70201 13.3978 5.52864 13.5169 5.33902 13.6011L5.14371 13.6733L2.5314 14.4653C2.39309 14.5069 2.2447 14.5103 2.10464 14.4751C1.9648 14.4398 1.83661 14.368 1.73453 14.2661C1.63237 14.1641 1.56002 14.0359 1.52457 13.896C1.48913 13.756 1.492 13.6086 1.53336 13.4702L1.53433 13.4683L2.3273 10.8569C2.409 10.5905 2.55475 10.3467 2.75211 10.1499L10.7589 2.14111C11.1698 1.73043 11.7278 1.49953 12.3087 1.49951C12.8898 1.49958 13.4477 1.73022 13.8586 2.14111C14.2694 2.55207 14.5002 3.10982 14.5002 3.69092Z"
                fill="currentColor"
              />
            </svg>
          </button>
          <button
            class="tool-btn delay-3"
            class:drag-hover={hoveredToolAction === "archive"}
            data-action="archive"
            onclick={archiveNote}
            aria-label="Archive Note"
            use:tooltip={{ text: tip('Archive Note', 'Ctrl+Shift+Del', '⌘⇧⌫') }}
          >
            <svg
              class="tool-icon"
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect width="20" height="5" x="2" y="3" rx="1" />
              <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
              <path d="M10 12h4" />
            </svg>
          </button>
          <button
            class="tool-btn delay-2 {isPinned ? 'active-tool' : ''}"
            class:drag-hover={hoveredToolAction === "pin"}
            data-action="pin"
            onclick={togglePin}
            aria-label="Pin"
            use:tooltip={{ text: isPinned ? tip('Unpin window', 'Alt+E', '⌥E') : tip('Pin to top', 'Alt+E', '⌥E') }}
          >
            {#if isPinned}
              <svg
                class="tool-icon"
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="currentColor"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M11.5005 2.66602C11.5004 2.4452 11.4124 2.23334 11.2563 2.07715C11.1001 1.92087 10.8875 1.83301 10.6665 1.83301H5.3335C5.11256 1.83301 4.90089 1.92097 4.74463 2.07715C4.58843 2.23335 4.50057 2.44512 4.50049 2.66602C4.50049 2.88703 4.58835 3.09958 4.74463 3.25586C4.90088 3.41194 5.11264 3.5 5.3335 3.5C5.64292 3.5 5.9399 3.623 6.15869 3.8418C6.3772 4.06048 6.5004 4.35687 6.50049 4.66602V7.17285C6.50031 7.51393 6.40485 7.8488 6.2251 8.13867C6.04536 8.4285 5.78831 8.66268 5.48291 8.81445L5.48193 8.81348L4.29932 9.41211L4.29639 9.41406C4.15755 9.48305 4.0402 9.58992 3.9585 9.72168C3.87695 9.85335 3.83358 10.0053 3.8335 10.1602V10.666C3.8335 10.7102 3.85107 10.7529 3.88232 10.7842C3.91358 10.8154 3.95629 10.833 4.00049 10.833H12.0005C12.0445 10.8329 12.0865 10.8153 12.1177 10.7842C12.1489 10.7529 12.1665 10.7102 12.1665 10.666V10.1602C12.1664 10.0052 12.1231 9.85338 12.0415 9.72168C11.9598 9.58998 11.8433 9.48305 11.7046 9.41406L11.7017 9.41211L10.5142 8.8125V8.81152C10.2105 8.65975 9.95487 8.42717 9.77588 8.13867C9.59613 7.8488 9.50067 7.51393 9.50049 7.17285V4.66602C9.50057 4.35671 9.62357 4.06051 9.84229 3.8418C10.061 3.62308 10.3572 3.50009 10.6665 3.5C10.8875 3.5 11.1001 3.41214 11.2563 3.25586C11.4126 3.09958 11.5005 2.88703 11.5005 2.66602ZM12.5005 2.66602C12.5005 3.15225 12.3072 3.61907 11.9634 3.96289C11.6196 4.30671 11.1527 4.5 10.6665 4.5C10.6224 4.50009 10.5805 4.51765 10.5493 4.54883C10.5181 4.58001 10.5006 4.62193 10.5005 4.66602V7.17285L10.5083 7.28809C10.5243 7.40242 10.5642 7.51249 10.6255 7.61133C10.6868 7.71018 10.7675 7.79515 10.8628 7.86035L10.9624 7.91895L10.9653 7.91992L12.1489 8.51855C12.4543 8.67032 12.7114 8.90452 12.8911 9.19434C13.0708 9.48414 13.1663 9.81818 13.1665 10.1592V10.666C13.1665 10.9754 13.0435 11.2724 12.8247 11.4912C12.606 11.7098 12.3097 11.8329 12.0005 11.833H8.50049V14.666C8.50049 14.942 8.27648 15.1658 8.00049 15.166C7.72435 15.166 7.50049 14.9422 7.50049 14.666V11.833H4.00049C3.69107 11.833 3.39409 11.71 3.17529 11.4912C2.9565 11.2724 2.8335 10.9754 2.8335 10.666V10.1592L2.83838 10.0322C2.85916 9.7357 2.95157 9.44805 3.10889 9.19434C3.26618 8.94068 3.48245 8.72953 3.73877 8.5791L3.85107 8.51855L5.03467 7.91992L5.0376 7.91895C5.17644 7.84995 5.29378 7.74309 5.37549 7.61133C5.43667 7.51258 5.47567 7.40229 5.4917 7.28809L5.50049 7.17285V4.66602C5.5004 4.62208 5.48264 4.57998 5.45166 4.54883C5.4204 4.51757 5.3777 4.5 5.3335 4.5C4.84742 4.5 4.38138 4.3065 4.0376 3.96289C3.69378 3.61907 3.50049 3.15225 3.50049 2.66602C3.50057 2.1799 3.69386 1.71386 4.0376 1.37012C4.3814 1.0264 4.84734 0.833008 5.3335 0.833008H10.6665C11.1527 0.833008 11.6196 1.0263 11.9634 1.37012C12.307 1.71384 12.5004 2.17998 12.5005 2.66602Z"
                  fill="currentColor"
                />
              </svg>
            {:else}
              <svg
                class="tool-icon"
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="currentColor"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M11.5005 2.66602C11.5004 2.4452 11.4124 2.23334 11.2563 2.07715C11.1001 1.92087 10.8875 1.83301 10.6665 1.83301H5.3335C5.11256 1.83301 4.90089 1.92097 4.74463 2.07715C4.58843 2.23335 4.50057 2.44512 4.50049 2.66602C4.50049 2.88703 4.58835 3.09958 4.74463 3.25586C4.90088 3.41194 5.11264 3.5 5.3335 3.5C5.64292 3.5 5.9399 3.623 6.15869 3.8418C6.3772 4.06048 6.5004 4.35687 6.50049 4.66602V7.17285C6.50031 7.51393 6.40485 7.8488 6.2251 8.13867C6.04536 8.4285 5.78831 8.66268 5.48291 8.81445L5.48193 8.81348L4.29932 9.41211L4.29639 9.41406C4.15755 9.48305 4.0402 9.58992 3.9585 9.72168C3.87695 9.85335 3.83358 10.0053 3.8335 10.1602V10.666C3.8335 10.7102 3.85107 10.7529 3.88232 10.7842C3.91358 10.8154 3.95629 10.833 4.00049 10.833H12.0005C12.0445 10.8329 12.0865 10.8153 12.1177 10.7842C12.1489 10.7529 12.1665 10.7102 12.1665 10.666V10.1602C12.1664 10.0052 12.1231 9.85338 12.0415 9.72168C11.9598 9.58998 11.8433 9.48305 11.7046 9.41406L11.7017 9.41211L10.5142 8.8125V8.81152C10.2105 8.65975 9.95487 8.42717 9.77588 8.13867C9.59613 7.8488 9.50067 7.51393 9.50049 7.17285V4.66602C9.50057 4.35671 9.62357 4.06051 9.84229 3.8418C10.061 3.62308 10.3572 3.50009 10.6665 3.5C10.8875 3.5 11.1001 3.41214 11.2563 3.25586C11.4126 3.09958 11.5005 2.88703 11.5005 2.66602ZM12.5005 2.66602C12.5005 3.15225 12.3072 3.61907 11.9634 3.96289C11.6196 4.30671 11.1527 4.5 10.6665 4.5C10.6224 4.50009 10.5805 4.51765 10.5493 4.54883C10.5181 4.58001 10.5006 4.62193 10.5005 4.66602V7.17285L10.5083 7.28809C10.5243 7.40242 10.5642 7.51249 10.6255 7.61133C10.6868 7.71018 10.7675 7.79515 10.8628 7.86035L10.9624 7.91895L10.9653 7.91992L12.1489 8.51855C12.4543 8.67032 12.7114 8.90452 12.8911 9.19434C13.0708 9.48414 13.1663 9.81818 13.1665 10.1592V10.666C13.1665 10.9754 13.0435 11.2724 12.8247 11.4912C12.606 11.7098 12.3097 11.8329 12.0005 11.833H8.50049V14.666C8.50049 14.942 8.27648 15.1658 8.00049 15.166C7.72435 15.166 7.50049 14.9422 7.50049 14.666V11.833H4.00049C3.69107 11.833 3.39409 11.71 3.17529 11.4912C2.9565 11.2724 2.8335 10.9754 2.8335 10.666V10.1592L2.83838 10.0322C2.85916 9.7357 2.95157 9.44805 3.10889 9.19434C3.26618 8.94068 3.48245 8.72953 3.73877 8.5791L3.85107 8.51855L5.03467 7.91992L5.0376 7.91895C5.17644 7.84995 5.29378 7.74309 5.37549 7.61133C5.43667 7.51258 5.47567 7.40229 5.4917 7.28809L5.50049 7.17285V4.66602C5.5004 4.62208 5.48264 4.57998 5.45166 4.54883C5.4204 4.51757 5.3777 4.5 5.3335 4.5C4.84742 4.5 4.38138 4.3065 4.0376 3.96289C3.69378 3.61907 3.50049 3.15225 3.50049 2.66602C3.50057 2.1799 3.69386 1.71386 4.0376 1.37012C4.3814 1.0264 4.84734 0.833008 5.3335 0.833008H10.6665C11.1527 0.833008 11.6196 1.0263 11.9634 1.37012C12.307 1.71384 12.5004 2.17998 12.5005 2.66602Z"
                  fill="currentColor"
                />
              </svg>
            {/if}
          </button>
          <button
            class="tool-btn delay-1"
            class:drag-hover={hoveredToolAction === "exit"}
            id="exit-btn"
            data-action="exit"
            onclick={closeApp}
            aria-label="Exit App"
            use:tooltip={{ text: tip('Exit', 'Ctrl+Q', '⌘Q') }}
          >
            <svg
              class="tool-icon"
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="currentColor"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M1.5 12.667V3.33301C1.50009 2.8469 1.69338 2.38084 2.03711 2.03711C2.38085 1.69338 2.8469 1.50009 3.33301 1.5H7.5C7.77614 1.5 8 1.72386 8 2C8 2.27614 7.77614 2.5 7.5 2.5H3.33301C3.11212 2.50009 2.90034 2.58795 2.74414 2.74414C2.58794 2.90034 2.50009 3.11212 2.5 3.33301V12.667C2.50008 12.8879 2.58794 13.0997 2.74414 13.2559C2.90034 13.4121 3.11211 13.4999 3.33301 13.5H7.5C7.77614 13.5 8 13.7239 8 14C8 14.2761 7.77614 14.5 7.5 14.5H3.33301C2.8469 14.4999 2.38085 14.3066 2.03711 13.9629C1.69337 13.6191 1.50008 13.1531 1.5 12.667ZM10.3135 4.31348C10.5087 4.11823 10.8252 4.11822 11.0205 4.31348L14.3535 7.64648C14.5488 7.84174 14.5488 8.15825 14.3535 8.35352L11.0205 11.6865C10.8252 11.8818 10.5087 11.8818 10.3135 11.6865C10.1182 11.4913 10.1182 11.1748 10.3135 10.9795L12.793 8.5H6C5.72386 8.5 5.5 8.27614 5.5 8C5.50001 7.72387 5.72387 7.5 6 7.5H12.793L10.3135 5.02051C10.1182 4.82525 10.1182 4.50874 10.3135 4.31348Z"
                fill="currentColor"
              />
            </svg>
          </button>
        </div>

        <!-- Theme Toggle Button (Below Close Dot) -->
        <button
          class="tool-btn theme-toggle delay-5"
          class:drag-hover={hoveredToolAction === "theme"}
          data-action="theme"
          onclick={toggleTheme}
          aria-label="Toggle Theme"
          style="position: absolute; top: 64px; left: 12px; pointer-events: auto;"
          use:tooltip={{ text: isDarkMode ? tip('Light mode', 'Ctrl+I', '⌘I') : tip('Dark mode', 'Ctrl+I', '⌘I'), position: 'right' }}
        >
          {#if !isDarkMode}
            <svg
              class="tool-icon"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
            </svg>
          {:else}
            <svg
              class="tool-icon"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="12" cy="12" r="5"></circle>
              <line x1="12" y1="1" x2="12" y2="3"></line>
              <line x1="12" y1="21" x2="12" y2="23"></line>
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
              <line x1="1" y1="12" x2="3" y2="12"></line>
              <line x1="21" y1="12" x2="23" y2="12"></line>
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
            </svg>
          {/if}
        </button>

        <!-- Accent Toggle Button -->
        <button
          class="tool-btn accent-toggle delay-5"
          class:drag-hover={hoveredToolAction === "accent"}
          data-action="accent"
          onclick={(e) => {
            e.stopPropagation();
            toggleAccentMenu();
          }}
          aria-label="Change Accent Color"
          style="position: absolute; top: 108px; left: 12px; pointer-events: auto;"
          use:tooltip={{ text: 'Accent Color', position: 'right' }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="currentColor"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              fill-rule="evenodd"
              clip-rule="evenodd"
              d="M10.0002 16.6668C8.23205 16.6668 6.53636 15.9645 5.28612 14.7142C4.03587 13.464 3.3335 11.7683 3.3335 10.0002C3.3335 8.23205 4.03587 6.53636 5.28612 5.28612C6.53636 4.03587 8.23205 3.3335 10.0002 3.3335C11.7683 3.3335 13.464 3.96564 14.7142 5.09086C15.9645 6.21607 16.6668 7.7422 16.6668 9.3335C16.6668 10.2176 16.3156 11.0654 15.6905 11.6905C15.0654 12.3156 14.2176 12.6668 13.3335 12.6668H11.8335C11.6168 12.6668 11.4044 12.7272 11.2201 12.8411C11.0358 12.955 10.8869 13.118 10.79 13.3117C10.6931 13.5055 10.6521 13.7225 10.6715 13.9383C10.691 14.1541 10.7702 14.3602 10.9002 14.5335L11.1002 14.8002C11.2302 14.9735 11.3093 15.1796 11.3288 15.3954C11.3482 15.6112 11.3072 15.8281 11.2103 16.0219C11.1134 16.2157 10.9645 16.3787 10.7802 16.4926C10.5959 16.6065 10.3835 16.6668 10.1668 16.6668H10.0002ZM7.50024 8C8.05253 8 8.50024 7.55228 8.50024 7C8.50024 6.44771 8.05253 6 7.50024 6C6.94796 6 6.50024 6.44771 6.50024 7C6.50024 7.55228 6.94796 8 7.50024 8ZM11.1578 7.09953C11.7124 7.09953 12.1621 6.64987 12.1621 6.09518C12.1621 5.54048 11.7124 5.09082 11.1578 5.09082C10.6031 5.09082 10.1534 5.54048 10.1534 6.09518C10.1534 6.64987 10.6031 7.09953 11.1578 7.09953ZM14.7142 8.5C14.7142 8.96028 14.3411 9.33341 13.8808 9.33341C13.4205 9.33341 13.0474 8.96028 13.0474 8.5C13.0474 8.03972 13.4205 7.66659 13.8808 7.66659C14.3411 7.66659 14.7142 8.03972 14.7142 8.5ZM6.11949 11.1419C6.57975 11.1419 6.95287 10.7687 6.95287 10.3085C6.95287 9.84822 6.57975 9.4751 6.11949 9.4751C5.65923 9.4751 5.28612 9.84822 5.28612 10.3085C5.28612 10.7687 5.65923 11.1419 6.11949 11.1419Z"
              fill="currentColor"
            />
          </svg>
        </button>

        <!-- Settings Toggle Button (Below Accent Toggle) -->
        <button
          class="tool-btn settings-toggle delay-5"
          class:drag-hover={hoveredToolAction === "settings"}
          data-action="settings"
          onclick={handleSettings}
          aria-label="Settings"
          style="position: absolute; top: 152px; left: 12px; pointer-events: auto;"
          use:tooltip={{ text: tip('Settings', 'Ctrl+,', '⌘,'), position: 'right' }}
        >
          <svg
            class="tool-icon"
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="currentColor"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M2.83301 14V9.83301H2C1.72386 9.83301 1.5 9.60915 1.5 9.33301C1.50018 9.05702 1.72397 8.83301 2 8.83301H4.66699C4.94288 8.83318 5.16682 9.05712 5.16699 9.33301C5.16699 9.60904 4.94298 9.83283 4.66699 9.83301H3.83301V14C3.83301 14.2761 3.60915 14.5 3.33301 14.5C3.05702 14.4998 2.83301 14.276 2.83301 14ZM7.5 14V8C7.5 7.72386 7.72386 7.5 8 7.5C8.27614 7.5 8.5 7.72386 8.5 8V14C8.5 14.2761 8.27614 14.5 8 14.5C7.72386 14.5 7.5 14.2761 7.5 14ZM12.167 14V11.167H11.333C11.0571 11.1668 10.8332 10.9429 10.833 10.667C10.833 10.391 11.057 10.1672 11.333 10.167H14C14.2761 10.167 14.5 10.3908 14.5 10.667C14.4998 10.943 14.276 11.167 14 11.167H13.167V14C13.167 14.276 12.943 14.4998 12.667 14.5C12.3908 14.5 12.167 14.2761 12.167 14ZM12.167 8V2C12.167 1.72386 12.3908 1.5 12.667 1.5C12.943 1.50018 13.167 1.72397 13.167 2V8C13.167 8.27603 12.943 8.49982 12.667 8.5C12.3908 8.5 12.167 8.27614 12.167 8ZM2.83301 6.66699V2C2.83301 1.72397 3.05702 1.50018 3.33301 1.5C3.60915 1.5 3.83301 1.72386 3.83301 2V6.66699C3.83283 6.94298 3.60904 7.16699 3.33301 7.16699C3.05712 7.16682 2.83318 6.94288 2.83301 6.66699ZM7.5 2C7.5 1.72386 7.72386 1.5 8 1.5C8.27614 1.5 8.5 1.72386 8.5 2V4.83301H9.33301C9.60904 4.83301 9.83283 5.05702 9.83301 5.33301C9.83301 5.60915 9.60915 5.83301 9.33301 5.83301H6.66699C6.39085 5.83301 6.16699 5.60915 6.16699 5.33301C6.16717 5.05702 6.39096 4.83301 6.66699 4.83301H7.5V2Z"
              fill="currentColor"
            />
          </svg>
        </button>

        <!-- Notes List (Replaces TOC in Overlay) -->
        {#if !isAccentMenuOpen}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="toc-container notes-overlay-container"
            transition:fade={{ duration: 150 }}
          >
            <div class="toc-title">Notes</div>
            <div
              class="toc-list dropdown-list"
              style="max-height: none; padding: 0;"
            >
              {#each dropdownNotes as note, noteIdx (note.id)}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                  class="dropdown-item"
                  class:dragging={draggingNoteId === note.id}
                  class:drag-hover={hoveredDotNoteId === note.id}
                  class:keyboard-focused={menuFocusedIndex === noteIdx}
                  class:drop-target-top={hoveredNoteId === note.id &&
                    dropPosition === "top"}
                  class:drop-target-bottom={hoveredNoteId === note.id &&
                    dropPosition === "bottom"}
                  data-note-id={note.id}
                  onclick={() => {
                    selectNote(note.id);
                    isMenuOpen = false;
                  }}
                  animate:flip={{ duration: 150 }}
                >
                  <!-- Drag Handle — pointer events for drag-to-reorder -->
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <div
                    class="drag-handle"
                    aria-label="Drag to reorder"
                    onpointerdown={(e) => onDragHandlePointerDown(e, note.id)}
                    onpointermove={(e) => onDragHandlePointerMove(e, note.id)}
                    onpointerup={(e) => onDragHandlePointerUp(e, note.id)}
                    onpointercancel={onDragHandlePointerCancel}
                    onclick={(e) => e.stopPropagation()}
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 16 16"
                      fill="currentColor"
                    >
                      <circle cx="5" cy="3" r="1.5" />
                      <circle cx="11" cy="3" r="1.5" />
                      <circle cx="5" cy="8" r="1.5" />
                      <circle cx="11" cy="8" r="1.5" />
                      <circle cx="5" cy="13" r="1.5" />
                      <circle cx="11" cy="13" r="1.5" />
                    </svg>
                  </div>

                  <span
                    class="item-text"
                    class:active={note.id === activeNoteId}
                    >{note.title || "Untitled Note"}</span
                  >
                  <button
                    class="archive-item-btn"
                    onclick={(e) => archiveNoteById(e, note.id)}
                    aria-label="Archive Note"
                    use:tooltip={{ position: 'left' }}
                  >
                    <svg
                      class="item-icon"
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      fill="currentColor"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M12.167 4.50049H3.83301V13.3335C3.83301 13.5544 3.92107 13.7661 4.07715 13.9224C4.23343 14.0786 4.44598 14.1665 4.66699 14.1665H11.333C11.554 14.1665 11.7666 14.0786 11.9229 13.9224C12.0789 13.7661 12.167 13.5544 12.167 13.3335V4.50049ZM6.16699 11.3335V7.3335C6.16699 7.05735 6.39085 6.8335 6.66699 6.8335C6.94299 6.83367 7.16699 7.05746 7.16699 7.3335V11.3335C7.16699 11.6095 6.94299 11.8333 6.66699 11.8335C6.39085 11.8335 6.16699 11.6096 6.16699 11.3335ZM8.83301 11.3335V7.3335C8.83301 7.05746 9.05701 6.83367 9.33301 6.8335C9.60915 6.8335 9.83301 7.05735 9.83301 7.3335V11.3335C9.83301 11.6096 9.60915 11.8335 9.33301 11.8335C9.05701 11.8333 8.83301 11.6095 8.83301 11.3335ZM10.167 2.6665C10.1669 2.44569 10.079 2.23383 9.92285 2.07764C9.76657 1.92136 9.55402 1.8335 9.33301 1.8335H6.66699C6.44598 1.8335 6.23343 1.92136 6.07715 2.07764C5.92105 2.23382 5.83309 2.44568 5.83301 2.6665V3.50049H10.167V2.6665ZM11.167 3.50049H14C14.2761 3.50049 14.5 3.72435 14.5 4.00049C14.4998 4.27648 14.276 4.50049 14 4.50049H13.167V13.3335C13.167 13.8196 12.9735 14.2856 12.6299 14.6294C12.2861 14.9732 11.8192 15.1665 11.333 15.1665H4.66699C4.18076 15.1665 3.71393 14.9732 3.37012 14.6294C3.0265 14.2856 2.83301 13.8196 2.83301 13.3335V4.50049H2C1.72397 4.50049 1.50018 4.27648 1.5 4.00049C1.5 3.72435 1.72386 3.50049 2 3.50049H4.83301V2.6665C4.83309 2.18047 5.02648 1.71433 5.37012 1.37061C5.71393 1.02679 6.18076 0.833496 6.66699 0.833496H9.33301C9.81924 0.833496 10.2861 1.02679 10.6299 1.37061C10.9735 1.71433 11.1669 2.18047 11.167 2.6665V3.50049Z"
                        fill="currentColor"
                      />
                    </svg>
                  </button>
                </div>
              {/each}

              <div
                class="dropdown-separator"
                style="height: 1px; background: var(--border-color); margin: 4px 0px;"
              ></div>
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="dropdown-item trash-row"
                onclick={() => {
                  openTrash();
                  isMenuOpen = false;
                }}
                style="justify-content: start; color: var(--text-muted, #888);"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  style="margin-right: 2px;"
                >
                  <path
                    d="M12.167 4.50049H3.83301V13.3335C3.83301 13.5544 3.92107 13.7661 4.07715 13.9224C4.23343 14.0786 4.44598 14.1665 4.66699 14.1665H11.333C11.554 14.1665 11.7666 14.0786 11.9229 13.9224C12.0789 13.7661 12.167 13.5544 12.167 13.3335V4.50049ZM6.16699 11.3335V7.3335C6.16699 7.05735 6.39085 6.8335 6.66699 6.8335C6.94299 6.83367 7.16699 7.05746 7.16699 7.3335V11.3335C7.16699 11.6095 6.94299 11.8333 6.66699 11.8335C6.39085 11.8335 6.16699 11.6096 6.16699 11.3335ZM8.83301 11.3335V7.3335C8.83301 7.05746 9.05701 6.83367 9.33301 6.8335C9.60915 6.8335 9.83301 7.05735 9.83301 7.3335V11.3335C9.83301 11.6096 9.60915 11.8335 9.33301 11.8335C9.05701 11.8333 8.83301 11.6095 8.83301 11.3335ZM10.167 2.6665C10.1669 2.44569 10.079 2.23383 9.92285 2.07764C9.76657 1.92136 9.55402 1.8335 9.33301 1.8335H6.66699C6.44598 1.8335 6.23343 1.92136 6.07715 2.07764C5.92105 2.23382 5.83309 2.44568 5.83301 2.6665V3.50049H10.167V2.6665ZM11.167 3.50049H14C14.2761 3.50049 14.5 3.72435 14.5 4.00049C14.4998 4.27648 14.276 4.50049 14 4.50049H13.167V13.3335C13.167 13.8196 12.9735 14.2856 12.6299 14.6294C12.2861 14.9732 11.8192 15.1665 11.333 15.1665H4.66699C4.18076 15.1665 3.71393 14.9732 3.37012 14.6294C3.0265 14.2856 2.83301 13.8196 2.83301 13.3335V4.50049H2C1.72397 4.50049 1.50018 4.27648 1.5 4.00049C1.5 3.72435 1.72386 3.50049 2 3.50049H4.83301V2.6665C4.83309 2.18047 5.02648 1.71433 5.37012 1.37061C5.71393 1.02679 6.18076 0.833496 6.66699 0.833496H9.33301C9.81924 0.833496 10.2861 1.02679 10.6299 1.37061C10.9735 1.71433 11.1669 2.18047 11.167 2.6665V3.50049Z"
                  />
                </svg>
                <span class="item-text" style="flex: none;">Trash Bin</span>
              </div>
            </div>
          </div>
        {/if}

        <!-- Accent Menu Bubble -->
        {#if isAccentMenuOpen}
          <div class="accent-menu" transition:fade={{ duration: 150 }}>
            {#each accentColors as color}
              <button
                class="accent-color-btn"
                style="background-color: {color.hex};"
                class:active={currentAccent.hex === color.hex}
                onclick={(e) => selectAccentColor(e, color)}
                aria-label={color.name}
              >
                {#if currentAccent.hex === color.hex}
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#fff"
                    stroke-width="3"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                {/if}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Settings Panel -->
    {#if isSettingsOpen}
      <SettingsPanel onClose={closeSettings} />
    {/if}

    <!-- Trash Bin Overlay -->
    {#if isTrashOpen}
      <div class="trash-overlay" out:fade={{ duration: 150 }}>
        <!-- Header with back button -->
        <div class="trash-overlay-header">
          <button class="trash-back-btn" onclick={closeTrash} aria-label="Back">
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="currentColor"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M10.3535 3.64645C10.5488 3.84171 10.5488 4.15829 10.3535 4.35355L6.70711 8L10.3535 11.6464C10.5488 11.8417 10.5488 12.1583 10.3535 12.3536C10.1583 12.5488 9.84171 12.5488 9.64645 12.3536L5.64645 8.35355C5.45118 8.15829 5.45118 7.84171 5.64645 7.64645L9.64645 3.64645C9.84171 3.45118 10.1583 3.45118 10.3535 3.64645Z"
              />
            </svg>
          </button>
          <span class="trash-overlay-title">Trash bin</span>

          <!-- Chevron icon for collapse/expand -->
          <button
            class="title-icon-btn"
            onclick={toggleCollapse}
            aria-label="Toggle Collapse"
          >
            <svg
              class="title-icon"
              class:collapsed={isCollapsed}
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="currentColor"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M7.66988 5.49915C7.90277 5.34536 8.21875 5.37127 8.42378 5.5763L12.4238 9.5763C12.6581 9.81062 12.6581 10.1896 12.4238 10.424C12.1895 10.6583 11.8104 10.6583 11.5761 10.424L7.99995 6.84779L4.42378 10.424C4.18947 10.6583 3.81044 10.6583 3.57613 10.424C3.34181 10.1896 3.34181 9.81062 3.57613 9.5763L7.57613 5.5763L7.66988 5.49915Z"
                fill="currentColor"
              />
            </svg>
          </button>
        </div>

        <!-- Trash list with time groups -->
        <div class="trash-overlay-list">
          {#each groupedTrashNotes as group}
            <div class="trash-time-group">
              <div class="trash-time-label">{group.label}</div>
              {#each group.notes as note}
                <div class="trash-item" class:keyboard-focused={trashNoteList.indexOf(note) === trashFocusedIndex}>
                  <span class="trash-bullet">·</span>
                  <span class="trash-item-title">{note.title}</span>
                  <div class="trash-item-actions">
                    <button
                      class="trash-icon-btn restore-icon-btn"
                      onclick={() => restoreNote(note.id)}
                      aria-label="Restore"
                      use:tooltip={{ text: 'Restore note', position: 'top' }}
                    >
                      <!-- Undo/Restore icon -->
                      <svg
                        width="20"
                        height="20"
                        viewBox="0 0 16 16"
                        fill="currentColor"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          d="M4.85355 3.14645C5.04882 3.34171 5.04882 3.65829 4.85355 3.85355L3.20711 5.5H9.5C11.433 5.5 13 7.067 13 9C13 10.933 11.433 12.5 9.5 12.5H7C6.72386 12.5 6.5 12.2761 6.5 12C6.5 11.7239 6.72386 11.5 7 11.5H9.5C10.8807 11.5 12 10.3807 12 9C12 7.61929 10.8807 6.5 9.5 6.5H3.20711L4.85355 8.14645C5.04882 8.34171 5.04882 8.65829 4.85355 8.85355C4.65829 9.04882 4.34171 9.04882 4.14645 8.85355L1.64645 6.35355C1.45118 6.15829 1.45118 5.84171 1.64645 5.64645L4.14645 3.14645C4.34171 2.95118 4.65829 2.95118 4.85355 3.14645Z"
                        />
                      </svg>
                    </button>
                    <button
                      class="trash-icon-btn delete-icon-btn"
                      onclick={() => permanentlyDeleteNote(note.id)}
                      aria-label="Delete permanently"
                      use:tooltip={{ text: 'Delete permanently', position: 'top' }}
                    >
                      <!-- Trash/delete icon -->
                      <svg
                        width="28"
                        height="28"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          d="M13.667 18.833V15.5C13.667 15.224 13.443 15.0002 13.167 15C12.8909 15 12.667 15.2239 12.667 15.5V18.833C12.667 19.1091 12.8908 19.333 13.167 19.333C13.443 19.3328 13.667 19.109 13.667 18.833ZM16.333 17.5V15.5C16.333 15.2239 16.1091 15 15.833 15C15.557 15.0002 15.333 15.224 15.333 15.5V17.5C15.333 17.776 15.557 17.9998 15.833 18C16.1092 18 16.333 17.7761 16.333 17.5ZM8.33301 17.5V15.5C8.333 15.2239 8.10915 15 7.83301 15C7.55702 15.0002 7.33301 15.224 7.33301 15.5V17.5C7.33301 17.776 7.55702 17.9998 7.83301 18C8.10915 18 8.33301 17.7761 8.33301 17.5ZM11 16.833V15.5C11 15.2239 10.7761 15 10.5 15C10.2239 15 10 15.2239 10 15.5V16.833C10 17.1091 10.2239 17.333 10.5 17.333C10.7761 17.333 11 17.1091 11 16.833ZM10.5 5V5.00098C10.2233 5.00046 9.94908 5.05342 9.69336 5.15918C9.43756 5.26504 9.20529 5.42121 9.00977 5.61719H9.00879L6.61719 8.00879H6.61816C6.42175 8.2045 6.26521 8.43715 6.15918 8.69336C6.05341 8.94908 5.99948 9.22328 6 9.5V12.333H5.16699C4.89096 12.333 4.66717 12.557 4.66699 12.833C4.66699 13.1091 4.89085 13.333 5.16699 13.333H18.5C18.7761 13.333 19 13.1091 19 12.833C18.9998 12.557 18.776 12.333 18.5 12.333H17.667V6.83301C17.6669 6.34697 17.4735 5.88083 17.1299 5.53711C16.7861 5.19329 16.3192 5 15.833 5H10.5ZM10 8.83301C10 8.87721 9.98243 8.91992 9.95117 8.95117C9.91992 8.98243 9.87721 9 9.83301 9H7.11914C7.17193 8.89563 7.24016 8.79961 7.32324 8.7168L9.7168 6.32324C9.79961 6.24016 9.89563 6.17192 10 6.11914V8.83301ZM16.667 12.333H7V10H9.83301C10.1424 10 10.4394 9.877 10.6582 9.6582C10.877 9.43941 11 9.14243 11 8.83301V6H15.833C16.054 6 16.2666 6.08786 16.4229 6.24414C16.579 6.40033 16.6669 6.61219 16.667 6.83301V12.333Z"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              {/each}
            </div>
          {:else}
            <div class="empty-trash">Trash bin is empty</div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Bottom Right Version & Update Area -->
    {#if !isCollapsed && !isTimerActive}
      <div
        class="version-update-module"
        style="position: absolute; bottom: 14px; right: 12px; display: flex; align-items: center; gap: 6px; font-size: 1rem; color: var(--text-muted, #888); opacity: 0.6; transition: opacity 0.2s ease; z-index: 10;"
      >
        {#if updateStatusMessage}
          <span
            class="version-text"
            style="pointer-events: none; user-select: none;"
            >{updateStatusMessage}</span
          >
        {:else}
          <span
            class="version-text"
            style="pointer-events: none; user-select: none;">v{appVersion}</span
          >
          <!-- svelte-ignore a11y_mouse_events_have_key_events -->
          <!-- svelte-ignore a11y_consider_explicit_label -->
          <button
            class="check-update-btn"
            onclick={handleCheckUpdate}
            aria-label="Check for updates"
            style="background: transparent; border: none; padding: 4px; border-radius: 4px; color: inherit; cursor: pointer; display: flex; align-items: center;"
            onmouseover={(e) =>
              (e.currentTarget.style.background = "rgba(128,128,128,0.2)")}
            onmouseout={(e) =>
              (e.currentTarget.style.background = "transparent")}
            use:tooltip={{ text: 'Check for updates', position: 'top' }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M21.5 2v6h-6M2.13 15.57a10 10 0 1 0 3.8-11.45L2 6"
              ></path>
            </svg>
          </button>
        {/if}
      </div>
    {/if}
  </div>
</main>

<!-- Drag overlay: must be OUTSIDE .glass-widget (which has CSS zoom) so that
     pointer clientX/Y coordinates match the SVG coordinate space exactly -->
{#if isDotDragging}
  <svg class="drag-overlay">
    <line
      x1={dotStartX}
      y1={dotStartY}
      x2={currentPointerX}
      y2={currentPointerY}
      class="drag-line"
    />
    <circle
      cx={currentPointerX}
      cy={currentPointerY}
      r="5"
      class="drag-pointer"
    />
  </svg>
{/if}

<Lightbox />

<style lang="scss">
  @use "../styles/variables" as *;

  .app-container {
    width: 100vw;
    height: 100vh;
    display: flex;
    padding: 0;
    background: transparent;
    overflow: hidden;
    border-radius: 12px;
    position: relative;
    box-sizing: border-box;
    border: 1px solid rgba(128, 128, 128, 0.15);
  }

  .glass-widget {
    @include glass-panel;
    width: 100%;
    height: 100%;
    padding: 12px;
    border-radius: 8px;
    position: relative;
    display: flex;
    align-items: flex-start;
    overflow: hidden;
    box-sizing: border-box;
    animation: fade-in 0.3s ease-out;

    /* UI Scale zoom — scales all contents (text, icons, padding) uniformly */
    zoom: var(--ui-scale, 1);

    // Note: When .collapsed, padding is kept the same as expanded mode to prevent layout jump

    .top-drag-zone {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 40px;
      z-index: 5; // Behind the actual interactive buttons but above the background
    }

    /*
     * Glow fallback for macOS WKWebView: a softly animated box-shadow ring.
     * Activates alongside AnimatedGradientBorder so there’s always a visible
     * effect even if the conic-gradient / CSS mask approach fails on WebKit.
     * Uses 3 layered shadows to simulate a glowing halo without filter:blur.
     */
    &.glow-active {
      box-shadow:
        0 0 6px 1px color-mix(in srgb, var(--color-accent) 25%, transparent),
        0 0 14px 4px color-mix(in srgb, var(--color-accent) 15%, transparent),
        0 0 28px 8px color-mix(in srgb, var(--color-accent) 08%, transparent);
      animation:
        fade-in 0.3s ease-out,
        glow-pulse 3s ease-in-out infinite;
    }

    /* Timer alert: use a stronger, faster pulse so user notices immediately */
    &.timer-alerting {
      box-shadow:
        0 0 8px 2px color-mix(in srgb, #ea4335 40%, transparent),
        0 0 20px 6px color-mix(in srgb, #fbbc05 25%, transparent),
        0 0 36px 12px color-mix(in srgb, #4285f4 15%, transparent);
      animation:
        fade-in 0.3s ease-out,
        glow-alert 1.2s ease-in-out infinite;
    }
  }

  @keyframes glow-pulse {
    0%,
    100% {
      box-shadow:
        0 0 6px 1px color-mix(in srgb, var(--color-accent) 25%, transparent),
        0 0 14px 4px color-mix(in srgb, var(--color-accent) 15%, transparent),
        0 0 28px 8px color-mix(in srgb, var(--color-accent) 08%, transparent);
    }
    50% {
      box-shadow:
        0 0 8px 2px color-mix(in srgb, var(--color-accent) 40%, transparent),
        0 0 20px 6px color-mix(in srgb, var(--color-accent) 25%, transparent),
        0 0 40px 12px color-mix(in srgb, var(--color-accent) 12%, transparent);
    }
  }

  @keyframes glow-alert {
    0%,
    100% {
      box-shadow:
        0 0 8px 2px color-mix(in srgb, #ea4335 40%, transparent),
        0 0 20px 6px color-mix(in srgb, #fbbc05 25%, transparent),
        0 0 36px 12px color-mix(in srgb, #4285f4 15%, transparent);
    }
    50% {
      box-shadow:
        0 0 12px 4px color-mix(in srgb, #4285f4 55%, transparent),
        0 0 28px 8px color-mix(in srgb, #34a853 35%, transparent),
        0 0 48px 16px color-mix(in srgb, #fbbc05 20%, transparent);
    }
  }

  @keyframes fade-in {
    from {
      opacity: 0;
      transform: scale(0.98);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  // Inner flex column: fills the entire widget
  .inner-column {
    display: flex;
    flex-direction: column;
    flex: 1 1 0;
    height: 100%;
    min-height: 0;
    gap: 12px;
    min-width: 1px;
    position: relative;
    justify-content: flex-start;
  }

  // ── Title Section ──
  .title-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
    overflow: visible; // Must NOT be hidden — clips drag ghost + blocks drag targets at boundary
    flex-shrink: 0;
    width: 100%;
    cursor: default;
    user-select: none;
    position: relative;
    z-index: 10;
  }

  .title-row {
    display: flex;
    align-items: center;
    gap: 4px;
    padding-left: 32px;
    padding-right: 4px;
    flex-shrink: 0;
    width: 100%;
    min-width: 0;
    overflow: hidden;
  }

  .title-icon-btn {
    background: transparent;
    border: none;
    padding: 0;
    margin: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    width: 24px;
    height: 24px;
  }

  .title-icon {
    opacity: 0.5;
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    color: $color-text;
    transition:
      color 0.18s cubic-bezier(0.25, 0.46, 0.45, 0.94),
      opacity 0.18s cubic-bezier(0.25, 0.46, 0.45, 0.94),
      transform 0.22s cubic-bezier(0.25, 0.46, 0.45, 0.94);
    will-change: transform;

    &.collapsed {
      transform: rotate(180deg);
    }

    &:hover {
      color: $color-accent;
      opacity: 1;
    }
  }

  .title-text-btn {
    background: transparent;
    border: none;
    padding: 0;
    margin: 0;
    display: flex;
    align-items: center;
    flex: 1 1 0;
    min-width: 0;
    text-align: left;
  }

  .title-text {
    flex: 1 1 0;
    min-width: 0;
    font-family: $font-family-mono;
    font-size: 12px;
    font-weight: 400;
    line-height: 1.2;
    color: var(--color-text, #111);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .title-input {
    font-family: $font-family-mono;
    font-size: 12px;
    font-weight: 400;
    line-height: 1.2;
    color: var(--color-text, #111);
    background: transparent;
    border: none;
    border-bottom: 1px dashed $color-accent;
    outline: none;
    width: 100%;
    padding: 4px 0 4px 0;
    margin: 0;

    &:focus {
      border-bottom: 1px solid $color-accent;
    }
  }

  .dropdown-list {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-height: max(50vh, 200px);
    overflow-y: auto;
    padding-bottom: 16px;
    // Prevent macOS inertia scroll from escaping the dropdown container
    overscroll-behavior: none;
    -webkit-overflow-scrolling: auto;

    // Hide scrollbar
    scrollbar-width: none;
    &::-webkit-scrollbar {
      display: none;
    }
  }

  .dropdown-item {
    background: transparent;
    border: none;
    padding-top: 12px;
    padding-bottom: 12px;
    padding-left: 6px;
    padding-right: 6px;
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    cursor: pointer;
    text-align: left;
    color: $color-text;
    opacity: 0.8;
    transition:
      opacity 0.18s cubic-bezier(0.25, 0.46, 0.45, 0.94),
      background-color 0.18s cubic-bezier(0.25, 0.46, 0.45, 0.94);
    user-select: none;
    position: relative;

    &:first-child {
      border-top: none;
    }

    &:hover {
      opacity: 1;
      background: rgba(128, 128, 128, 0.04);
    }

    &.keyboard-focused {
      opacity: 1;
      background: color-mix(in srgb, var(--color-accent) 10%, transparent);
      outline: none;

      .item-text {
        color: var(--color-accent);
      }
    }

    &.dragging {
      opacity: 0.3;
      background: rgba(128, 128, 128, 0.08);
      border-radius: 4px;
    }

    &.drop-target-top {
      background: rgba(128, 128, 128, 0.04);
      &::before {
        content: "";
        position: absolute;
        top: -1px;
        left: 0;
        right: 0;
        height: 2px;
        background-color: var(--color-accent);
        z-index: 10;
        pointer-events: none;
        box-shadow: 0 0 4px var(--color-accent);
      }
    }

    &.drop-target-bottom {
      background: rgba(128, 128, 128, 0.04);
      &::after {
        content: "";
        position: absolute;
        bottom: -1px;
        left: 0;
        right: 0;
        height: 2px;
        background-color: var(--color-accent);
        z-index: 10;
        pointer-events: none;
        box-shadow: 0 0 4px var(--color-accent);
      }
    }
  }

  .drag-handle {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4px 2px;
    cursor: grab;
    color: $color-text;
    opacity: 0.25;
    transition: opacity 0.2s ease;
    margin-right: 2px;
    touch-action: none; // Required for Pointer Events to fire on touch/stylus without scroll interference

    &:hover {
      opacity: 0.6;
    }

    &:active {
      cursor: grabbing;
    }
  }

  .archive-item-btn {
    background: transparent;
    border: none;
    padding: 2px;
    margin: -2px 0;
    cursor: pointer;
    color: $color-text;
    opacity: 0;
    transition:
      color 0.18s cubic-bezier(0.25, 0.46, 0.45, 0.94),
      opacity 0.18s cubic-bezier(0.25, 0.46, 0.45, 0.94),
      background-color 0.18s cubic-bezier(0.25, 0.46, 0.45, 0.94);
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;

    .dropdown-item:hover & {
      opacity: 0.5;
    }

    &:hover {
      color: $color-accent;
      opacity: 1 !important;
    }
  }

  .item-icon {
    flex-shrink: 0;
  }

  .item-text {
    flex: 1 1 0;
    font-family: $font-family-mono;
    font-size: 12px;
    font-weight: 400;
    line-height: 1.2;
    color: var(--color-text, #111);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;

    &.active {
      font-weight: 700;
    }
  }

  // ── Close Dot ──
  .close-dot {
    width: 10px;
    height: 10px;
    position: absolute;
    top: 19px;
    left: 19px;
    background-color: var(--close-dot-bg, rgba(0, 0, 0, 0.3));
    border-radius: 50%;
    border: none;
    padding: 0;
    cursor: pointer;
    transition:
      background-color 0.15s cubic-bezier(0.25, 0.46, 0.45, 0.94),
      transform 0.12s cubic-bezier(0.25, 0.46, 0.45, 0.94);
    will-change: transform;
    z-index: 20; // Above overlay menu

    // Invisible pseudo-element to expand hit target area for easy touch/drag
    &::after {
      content: "";
      position: absolute;
      top: -15px;
      left: -15px;
      right: -15px;
      bottom: -15px;
      border-radius: 50%;
      background: transparent;
    }

    &:hover {
      background: $color-accent;
    }

    &.active {
      background: var(--close-dot-active-bg, rgba(0, 0, 0, 0.3));
    }

    &:active {
      transform: scale(0.9);
    }
  }

  .menu-overlay {
    position: absolute;
    inset: -1px;
    z-index: 10;
    border-radius: 12px;
    /* Windows/default: semi-transparent + blur creates nice glass depth */
    background-color: color-mix(in srgb, var(--bg-focused) 70%, transparent);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    pointer-events: none;
    animation: fade-in 0.2s ease-out forwards;
  }

  /* macOS WKWebView: Tăng opacity lên 85% và bật lại blur để menu không bị trong suốt quá mức
     làm lộ chữ bên dưới, nhưng vẫn giữ được độ mờ ảo của kính (glassmorphism). */
  :global([data-os="macos"]) .menu-overlay {
    background-color: color-mix(in srgb, var(--bg-focused) 85%, transparent);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
  }

  .toolbar {
    position: absolute;
    top: 9px;
    left: 62px;
    display: flex;
    align-items: center;
    gap: 14px;
    width: max-content;
    pointer-events: auto;
  }

  .tool-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0);
    border: none;
    color: $color-text;
    border-radius: 8px;
    width: 32px;
    height: 32px;
    padding: 4px;
    cursor: pointer;
    /* Only transition composited properties — no layout thrash */
    transition:
      background-color 0.18s cubic-bezier(0.25, 0.46, 0.45, 0.94),
      color 0.18s cubic-bezier(0.25, 0.46, 0.45, 0.94),
      opacity 0.18s cubic-bezier(0.25, 0.46, 0.45, 0.94),
      transform 0.18s cubic-bezier(0.25, 0.46, 0.45, 0.94);

    // Starting state for slide-down animation
    // translateZ(0) promotes to its own GPU compositing layer
    transform: translateY(-10px) translateZ(0);
    opacity: 0;
    will-change: transform, opacity;
    animation: slide-down-fade 0.28s cubic-bezier(0.34, 1.2, 0.64, 1) forwards;

    &:hover,
    &.drag-hover {
      background: $color-accent;
      color: var(--color-accent-text, #ffffff);
      opacity: 1 !important;
      transform: translateY(0) translateZ(0) scale(1.06);
    }

    &:active {
      transform: translateY(0) translateZ(0) scale(0.94);
    }

    &.active-tool {
      background: rgba($color-accent, 0.06);
      color: $color-accent;
      opacity: 1 !important;
    }

    &.active-tool:hover,
    &.active-tool.drag-hover {
      background: $color-accent;
      color: var(--color-accent-text, #ffffff);
      opacity: 1 !important;
    }

    &#exit-btn:hover,
    &#exit-btn.drag-hover {
      background: $color-danger !important;
      color: #fff !important;
    }
  }

  /* macOS: native ease-out (no bounce) + fix washed-out opacity — eliminates stutter in WKWebView */
  :global([data-os="macos"]) .tool-btn {
    /* Use dedicated keyframe that ends at 0.78 opacity (not 0.5) */
    animation: slide-down-fade-mac 0.22s cubic-bezier(0.22, 1, 0.36, 1) forwards;
    transition:
      background-color 0.14s cubic-bezier(0.22, 1, 0.36, 1),
      color 0.14s cubic-bezier(0.22, 1, 0.36, 1),
      opacity 0.14s cubic-bezier(0.22, 1, 0.36, 1),
      transform 0.14s cubic-bezier(0.22, 1, 0.36, 1);

    &:hover,
    &.drag-hover {
      transform: translateY(0) translateZ(0) scale(1.08);
    }

    &:active {
      transform: translateY(0) translateZ(0) scale(0.92);
      transition-duration: 0.07s;
    }

    /* active-tool: rgba(accent, 0.06) is nearly invisible on macOS — bump it up */
    &.active-tool {
      background: color-mix(in srgb, var(--color-accent) 18%, transparent);
    }
  }

  .tool-icon {
    width: 20px;
    height: 20px;
  }

  // Animation delays from right to left
  .delay-0 {
    animation-delay: 0s;
  }
  .delay-1 {
    animation-delay: 0.04s;
  }
  .delay-2 {
    animation-delay: 0.08s;
  }
  .delay-3 {
    animation-delay: 0.12s;
  }
  .delay-4 {
    animation-delay: 0.16s;
  }
  .delay-5 {
    animation-delay: 0.2s;
  }

  /* macOS: slightly tighter stagger — feels snappier */
  :global([data-os="macos"]) {
    .delay-0 {
      animation-delay: 0s;
    }
    .delay-1 {
      animation-delay: 0.03s;
    }
    .delay-2 {
      animation-delay: 0.06s;
    }
    .delay-3 {
      animation-delay: 0.09s;
    }
    .delay-4 {
      animation-delay: 0.12s;
    }
    .delay-5 {
      animation-delay: 0.15s;
    }
  }

  @keyframes slide-down-fade {
    from {
      transform: translateY(-10px) translateZ(0);
      opacity: 0;
    }
    to {
      transform: translateY(0) translateZ(0);
      opacity: 0.5; /* Windows default — macOS override below */
    }
  }

  /* macOS: WKWebView composites layers differently — 0.5 opacity looks
     washed-out. Use a higher resting opacity so icons are clearly readable. */
  @keyframes slide-down-fade-mac {
    from {
      transform: translateY(-10px) translateZ(0);
      opacity: 0;
    }
    to {
      transform: translateY(0) translateZ(0);
      opacity: 0.78;
    }
  }

  @keyframes slide-down-full {
    from {
      transform: translateY(-10px) translateZ(0);
      opacity: 0;
    }
    to {
      transform: translateY(0) translateZ(0);
      opacity: 1;
    }
  }

  .accent-toggle {
    color: var(--color-accent);
    animation-name: slide-down-full;

    &:hover,
    &.drag-hover {
      color: var(--color-accent-text, #ffffff) !important;
    }
  }

  // ── Accent Menu ──
  .accent-menu {
    position: absolute;
    top: 110px;
    left: 52px;
    background: var(--bg-focused);
    border: 1px solid var(--glass-border);
    box-shadow: var(--glass-shadow);
    border-radius: 12px;
    padding: 10px;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    pointer-events: auto;
    z-index: 30;
  }

  .accent-color-btn {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition:
      transform 0.18s cubic-bezier(0.25, 0.46, 0.45, 0.94),
      outline 0.18s cubic-bezier(0.25, 0.46, 0.45, 0.94);
    will-change: transform;

    &:hover {
      transform: scale(1.1);
    }

    &.active {
      outline: 2px solid var(--color-text);
      outline-offset: 2px;
    }
  }

  // ── Text Editor ──
  .text-editor {
    display: flex;
    flex-direction: column;
    flex: 1 0 0;
    min-height: 1px;
    overflow-y: auto;
    overflow-x: hidden;
    width: 100%;
    scroll-padding-bottom: 80px; /* Ensures auto-scroll during typing avoids the fade overlay */
    // Prevent macOS inertia/momentum scrolling from escaping the container
    overscroll-behavior: none;
    -webkit-overflow-scrolling: auto;

    // Hide scrollbar but keep scroll functionality
    -ms-overflow-style: none; /* IE and Edge */
    scrollbar-width: none; /* Firefox */
    &::-webkit-scrollbar {
      display: none; /* Chrome, Safari and Opera */
    }
  }

  .editor-fade-overlay {
    position: absolute;
    bottom: 44px; // 32px (timer widget) + 12px (gap)
    left: 0;
    width: 100%;
    height: 48px;
    pointer-events: none;
    z-index: 5;
    mask-image: linear-gradient(to bottom, transparent 0%, black 100%);
    -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 100%);
    transition: background-color 0.3s ease;
  }

  .trash-overlay {
    position: absolute;
    inset: 0;
    z-index: 25; // Above menu-overlay (10) and close-dot (20)
    border-radius: 8px;
    background-color: var(--bg-focused);
    display: flex;
    flex-direction: column;
    color: var(--color-text);
    overflow: hidden;

    // Enter animation only — exit handled by Svelte out:fade
    animation: trash-slide-in 0.24s cubic-bezier(0.22, 1, 0.36, 1) both;
  }

  @keyframes trash-slide-in {
    from {
      opacity: 0;
      transform: translateX(8px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }

  .trash-overlay-header {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 12px 12px 12px 16px;
    flex-shrink: 0;
  }

  .trash-back-btn {
    background: transparent;
    border: none;
    color: var(--color-text);
    opacity: 0.6;
    cursor: pointer;
    padding: 4px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition:
      opacity 0.15s cubic-bezier(0.25, 0.46, 0.45, 0.94),
      background-color 0.15s cubic-bezier(0.25, 0.46, 0.45, 0.94),
      color 0.15s cubic-bezier(0.25, 0.46, 0.45, 0.94);

    &:hover {
      opacity: 1;
      background: var(--color-accent);
      color: var(--color-accent-text);
    }

    &:active {
      transform: scale(0.92);
    }
  }

  .trash-overlay-title {
    font-family: $font-family-mono;
    font-size: 12px;
    font-weight: 400;
    line-height: 1.2;
    color: var(--color-text, #111);
    flex: 1;
    min-width: 0;
  }

  .trash-overlay-list {
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    flex: 1;
    padding: 0 16px 20px 16px;

    // Prevent macOS inertia scroll escape
    overscroll-behavior: none;
    -webkit-overflow-scrolling: auto;

    // Hide scrollbar
    scrollbar-width: none;
    &::-webkit-scrollbar {
      display: none;
    }
  }

  .trash-time-group {
    display: flex;
    flex-direction: column;
    margin-bottom: 4px;
    margin-left: 12px;
  }

  .trash-time-label {
    font-family: $font-family-mono;
    font-size: 11px;
    font-weight: 500;
    color: var(--color-accent);
    opacity: 0.85;
    padding: 8px 4px 8px 18px;
    letter-spacing: 0.02em;
  }

  .trash-item {
    display: flex;
    align-items: center;
    gap: 6px;
    border-radius: 4px;
    padding-left: 8px;
    cursor: default;
    color: $color-text;
    opacity: 0.7;
    border-left: 2px solid transparent;
    transition:
      opacity 0.18s cubic-bezier(0.25, 0.46, 0.45, 0.94),
      background-color 0.18s cubic-bezier(0.25, 0.46, 0.45, 0.94),
      color 0.18s cubic-bezier(0.25, 0.46, 0.45, 0.94),
      border-left-color 0.18s cubic-bezier(0.25, 0.46, 0.45, 0.94),
      padding-left 0.18s cubic-bezier(0.25, 0.46, 0.45, 0.94);
    min-width: 0;

    &:hover,
    &.keyboard-focused {
      opacity: 1;
      background: rgba(128, 128, 128, 0.08);
      border-left: 2px solid $color-accent;
      padding-left: 12px;
    }
  }

  .trash-bullet {
    opacity: 0.5;
    font-size: 10px;
    flex-shrink: 0;
  }

  .trash-item-title {
    font-family: $font-family-mono;
    font-size: 12px;
    font-weight: 400;
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }

  .trash-item-actions {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }

  .trash-icon-btn {
    background: transparent;
    border: none;
    padding: 4px;
    border-radius: 6px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text);
    opacity: 0.7;
    transition:
      opacity 0.15s cubic-bezier(0.25, 0.46, 0.45, 0.94),
      background-color 0.15s cubic-bezier(0.25, 0.46, 0.45, 0.94),
      color 0.15s cubic-bezier(0.25, 0.46, 0.45, 0.94),
      transform 0.12s cubic-bezier(0.25, 0.46, 0.45, 0.94);

    &:active {
      transform: scale(0.88);
    }
  }

  .restore-icon-btn {
    &:hover {
      opacity: 1;
      color: #38aa57;
    }
  }

  .delete-icon-btn {
    &:hover {
      opacity: 1;
      color: #f3343a;
    }
  }

  .empty-trash {
    font-family: $font-family-base;
    font-size: 13px;
    color: var(--color-text);
    opacity: 0.4;
    text-align: center;
    padding-top: 48px;
    font-style: italic;
  }

  .editor-content {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 0 8px;
    width: 100%;
    font-size: 14px;
    color: var(--color-text, black);
    word-break: break-word;
  }

  .heading-text {
    font-family: $font-family-base;
    font-size: 14px;
    font-weight: 600;
    line-height: 1.2;
    color: var(--color-text, black);
    margin: 0;
    min-width: 100%;
  }

  .body-text {
    font-family: $font-family-base;
    font-size: 14px;
    font-weight: 400;
    line-height: 1.2;
    color: var(--color-text, black);
    margin: 0;
    min-width: 100%;
  }

  :global(.list-block) {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-family: $font-family-base;
    font-size: 14px;
    font-weight: 400;
    line-height: 0;

    :global(ul) {
      display: block;
      margin: 0;
      padding: 0;
      width: 100%;

      :global(li) {
        list-style: disc;
        margin-left: 21px;
        line-height: 1.2;
      }
    }
  }

  // ── Timer Row ──
  .timer-row {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-shrink: 0;
    width: 100%;

    // Ẩn bằng CSS thay vì unmount — giữ nguyên state đếm giờ
    &.timer-hidden {
      display: none;
    }
  }

  .timer-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 4px;
    border: none;
    border-radius: 9999px;
    background: transparent;
    opacity: 0.5;
    overflow: clip;
    cursor: pointer;
    color: $color-text;
    transition: opacity 0.2s ease;

    &:hover {
      opacity: 0.8;
    }

    &:active {
      opacity: 1;
    }
  }

  // ── Table of Contents ──
  .toc-container {
    position: absolute;
    top: 68px;
    left: 64px;
    right: 16px;
    bottom: 16px;
    display: flex;
    flex-direction: column;
    pointer-events: auto;
    z-index: 20;
    max-height: calc(100% - 84px);
  }

  .toc-title {
    font-family: $font-family-mono;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: $color-text;
    opacity: 0.4;
    margin-bottom: 8px;
    padding-left: 8px;
    width: 100%;
    max-width: 800px;
    margin-left: auto;
    margin-right: auto;
  }

  .toc-list {
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    flex: 1;
    max-width: 800px;
    margin: auto;
    padding-right: 4px;

    // Custom scrollbar
    scrollbar-width: thin;
    scrollbar-color: color-mix(in srgb, $color-accent 20%, transparent)
      transparent;
    &::-webkit-scrollbar {
      width: 4px;
    }
    &::-webkit-scrollbar-track {
      background: transparent;
    }
    &::-webkit-scrollbar-thumb {
      background: color-mix(in srgb, $color-accent 20%, transparent);
      border-radius: 2px;
    }
  }

  .toc-item {
    background: transparent;
    border: none;
    padding: 6px 8px;
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    cursor: pointer;
    text-align: left;
    color: $color-text;
    opacity: 0.7;
    transition:
      opacity 0.18s cubic-bezier(0.25, 0.46, 0.45, 0.94),
      background-color 0.18s cubic-bezier(0.25, 0.46, 0.45, 0.94),
      color 0.18s cubic-bezier(0.25, 0.46, 0.45, 0.94),
      border-left-color 0.18s cubic-bezier(0.25, 0.46, 0.45, 0.94),
      padding-left 0.18s cubic-bezier(0.25, 0.46, 0.45, 0.94);
    border-left: 2px solid transparent;
    min-width: 0;

    .toc-bullet {
      opacity: 0.5;
      font-size: 10px;
      flex-shrink: 0;
    }

    .toc-text {
      font-family: $font-family-base;
      font-size: 13px;
      font-weight: 400;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
      min-width: 0;
    }

    &.level-1 {
      padding-left: 8px;
      .toc-text {
        font-weight: 600;
      }
    }
    &.level-2 {
      padding-left: 20px;
      .toc-bullet {
        opacity: 0.3;
      }
    }
    &.level-3 {
      padding-left: 32px;
      .toc-bullet {
        opacity: 0.2;
      }
      .toc-text {
        font-size: 12px;
      }
    }
    &.level-4,
    &.level-5,
    &.level-6 {
      padding-left: 44px;
      .toc-bullet {
        display: none;
      }
      .toc-text {
        font-size: 11px;
        opacity: 0.8;
      }
    }

    &:hover,
    &.drag-hover {
      opacity: 1;
      background: rgba(128, 128, 128, 0.08);
      border-left: 2px solid $color-accent;
      color: $color-accent;
    }

    &.level-1:hover,
    &.level-1.drag-hover {
      padding-left: 12px;
    }
    &.level-2:hover,
    &.level-2.drag-hover {
      padding-left: 24px;
    }
    &.level-3:hover,
    &.level-3.drag-hover {
      padding-left: 36px;
    }
    &.level-4:hover,
    &.level-4.drag-hover,
    &.level-5:hover,
    &.level-5.drag-hover,
    &.level-6:hover,
    &.level-6.drag-hover {
      padding-left: 48px;
    }
  }

  .toc-empty {
    font-family: $font-family-base;
    font-size: 12px;
    color: $color-text;
    opacity: 0.4;
    padding: 12px 8px;
    font-style: italic;
  }

  @keyframes heading-pulse {
    0% {
      background-color: color-mix(in srgb, $color-accent 25%, transparent);
      box-shadow: 0 0 0 4px color-mix(in srgb, $color-accent 25%, transparent);
      border-radius: 4px;
    }
    100% {
      background-color: transparent;
      box-shadow: 0 0 0 4px transparent;
    }
  }

  :global(.highlight-pulse) {
    animation: heading-pulse 1.5s ease-out;
  }

  // ── Drag Visuals ──
  .drag-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 9999;
  }

  .drag-line {
    stroke: $figma-gray-300;
    stroke-width: 1.5px;
  }

  .drag-pointer {
    fill: $color-accent;
  }
</style>
