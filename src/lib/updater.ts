import { writable } from 'svelte/store';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

export const updateState = writable({
  checking: false,
  available: false,
  version: '',
  date: '',
  body: '',
  downloading: false,
  progress: 0,
  contentLength: 0,
  error: '',
  updateObj: null as any
});

export async function checkForAppUpdates() {
  updateState.update(s => ({ ...s, checking: true, error: '' }));
  try {
    const update = await check();
    if (update) {
      updateState.update(s => ({
        ...s,
        checking: false,
        available: true,
        version: update.version,
        date: update.date || '',
        body: update.body || '',
        updateObj: update
      }));
      return { hasUpdate: true, error: null };
    } else {
      updateState.update(s => ({ ...s, checking: false, available: false }));
      return { hasUpdate: false, error: null };
    }
  } catch (error) {
    console.error('Failed to check for updates:', error);
    updateState.update(s => ({ ...s, checking: false, error: String(error) }));
    return { hasUpdate: false, error: String(error) };
  }
}

export async function downloadAndInstallUpdate() {
  let update: any;
  updateState.subscribe(s => update = s.updateObj)();
  if (!update) return;

  updateState.update(s => ({ ...s, downloading: true, progress: 0 }));

  try {
    await update.downloadAndInstall((event: any) => {
      switch (event.event) {
        case 'Started':
          updateState.update(s => ({ ...s, contentLength: event.data.contentLength || 0 }));
          break;
        case 'Progress':
          updateState.update(s => ({ ...s, progress: s.progress + event.data.chunkLength }));
          break;
        case 'Finished':
          break;
      }
    });
    await relaunch();
  } catch (error) {
    console.error('Failed to install update:', error);
    updateState.update(s => ({ ...s, downloading: false, error: String(error) }));
  }
}

export function dismissUpdate() {
  updateState.update(s => ({ ...s, available: false }));
}
