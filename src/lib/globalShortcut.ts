import { register, unregisterAll } from '@tauri-apps/plugin-global-shortcut';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { showToast } from '$lib/toastStore';

export function getSavedToggleShortcut(): string {
  const saved = localStorage.getItem('globalToggleShortcut');
  if (saved) return saved;

  const isMac = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac');
  // Default string format that we'll store and display.
  return isMac ? 'Cmd + Shift + J' : 'Ctrl + Shift + J';
}

export async function applyToggleShortcut(shortcutString: string) {
  try {
    // Unregister any previous shortcuts to prevent conflicts
    await unregisterAll();

    if (!shortcutString) return;

    // Convert UI string (e.g. "Cmd + Shift + J") to Tauri format (e.g. "Command+Shift+J")
    let tauriFormat = shortcutString.replace(/\s+/g, '');
    tauriFormat = tauriFormat.replace(/Cmd/g, 'Command');
    tauriFormat = tauriFormat.replace(/Ctrl/g, 'Control');

    await register(tauriFormat, async (event) => {
      // event.state can be 'Pressed' or 'Released'
      if (event.state === 'Pressed') {
        const appWindow = getCurrentWindow();
        const isVisible = await appWindow.isVisible();
        if (isVisible) {
          await appWindow.hide();
        } else {
          await appWindow.show();
          await appWindow.setFocus();
        }
      }
    });

    console.log(`Global shortcut registered: ${tauriFormat}`);
  } catch (error) {
    console.error('Failed to register global shortcut:', error);
    showToast(`Shortcut Error: ${error}`);
  }
}

export function getLocalShortcut(id: string, defaultShortcut: string): string {
  if (typeof localStorage === 'undefined') return defaultShortcut;
  return localStorage.getItem(`shortcut_${id}`) || defaultShortcut;
}

export function matchShortcut(e: KeyboardEvent, shortcutStr: string): boolean {
  if (!shortcutStr) return false;
  
  const parts = shortcutStr.split('+').map(p => p.trim().toLowerCase());
  const keyStr = parts[parts.length - 1];
  
  // Modifiers expected by shortcut
  const needsCtrl = parts.includes('ctrl');
  const needsAlt = parts.includes('alt');
  const needsShift = parts.includes('shift');
  const needsCmd = parts.includes('cmd') || parts.includes('meta');

  // Check modifiers
  // e.metaKey is Cmd on Mac, e.ctrlKey is Ctrl
  if (e.ctrlKey !== needsCtrl) return false;
  if (e.altKey !== needsAlt) return false;
  if (e.shiftKey !== needsShift) return false;
  if (e.metaKey !== needsCmd) return false;

  // Check key (handling e.key which could be e.g. "Escape", "Enter", "i", ",", "ArrowDown")
  // Or handle e.code e.g. "KeyI", "Comma"
  const eKeyLower = e.key.toLowerCase();
  let eCodeLower = e.code.toLowerCase();
  
  // e.code has "keyi", "digit1", "comma"
  if (eCodeLower.startsWith('key')) {
    eCodeLower = eCodeLower.replace('key', '');
  } else if (eCodeLower.startsWith('digit')) {
    eCodeLower = eCodeLower.replace('digit', '');
  }
  
  // if keyStr is a single character, match against eKeyLower or eCodeLower
  if (keyStr === eKeyLower || keyStr === eCodeLower) {
    return true;
  }
  
  // Handle special cases
  if (keyStr === ',' && (eKeyLower === ',' || eCodeLower === 'comma')) return true;
  
  return false;
}
