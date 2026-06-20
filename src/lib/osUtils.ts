/**
 * osUtils.ts — Platform detection & OS-aware UI hints
 *
 * Usage:
 *   import { initOSClass, isMac } from '$lib/osUtils';
 *   onMount(() => initOSClass());
 */

/** Returns true when running on macOS (covers Tauri + browser). */
export function isMac(): boolean {
  // navigator.userAgentData (modern, available in Chromium/Tauri WebView)
  if ('userAgentData' in navigator) {
    const uad = (navigator as any).userAgentData;
    if (uad?.platform) {
      return (uad.platform as string).toLowerCase().includes('mac');
    }
  }
  // Fallback: classic UA string
  return /macintosh|mac os x/i.test(navigator.userAgent);
}

/** Returns true when running on Windows. */
export function isWindows(): boolean {
  if ('userAgentData' in navigator) {
    const uad = (navigator as any).userAgentData;
    if (uad?.platform) {
      return (uad.platform as string).toLowerCase().includes('win');
    }
  }
  return /windows/i.test(navigator.userAgent);
}

/** Returns true when running on Linux. */
export function isLinux(): boolean {
  if ('userAgentData' in navigator) {
    const uad = (navigator as any).userAgentData;
    if (uad?.platform) {
      const p = (uad.platform as string).toLowerCase();
      return p.includes('linux') && !p.includes('android');
    }
  }
  return /linux/i.test(navigator.userAgent) && !/android/i.test(navigator.userAgent);
}

/**
 * Applies a `data-os` attribute to `<html>` so CSS can target platform
 * differences via `[data-os="macos"]`, `[data-os="windows"]`, etc.
 *
 * Also sets `data-high-dpi` when devicePixelRatio >= 2 (Retina / HiDPI).
 *
 * Call this once inside `onMount()`.
 */
export function initOSClass(): void {
  const root = document.documentElement;

  if (isMac()) {
    root.setAttribute('data-os', 'macos');
  } else if (isWindows()) {
    root.setAttribute('data-os', 'windows');
  } else if (isLinux()) {
    root.setAttribute('data-os', 'linux');
  } else {
    root.setAttribute('data-os', 'unknown');
  }

  // HiDPI / Retina hint for sharper border/shadow tuning
  if (window.devicePixelRatio >= 2) {
    root.setAttribute('data-high-dpi', 'true');
  }
}
