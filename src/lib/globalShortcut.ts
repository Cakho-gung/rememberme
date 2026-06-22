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
