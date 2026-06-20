import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';

// ── Sound Enabled Toggle ──
let _soundEnabled = true;

export function isSoundEnabled(): boolean {
  return _soundEnabled;
}

export function setSoundEnabled(value: boolean) {
  _soundEnabled = value;
  if (typeof window !== 'undefined') {
    localStorage.setItem('soundEnabled', value ? '1' : '0');
  }
}

export function loadSoundPreference() {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('soundEnabled');
    _soundEnabled = stored !== '0'; // default true
  }
}

// Cache audio elements so they don't have to be re-created every time
const audios: Record<string, HTMLAudioElement | null> = {
  tick: null,
  alarm: null,
  start: null,
  pause: null,
  stop: null,
  collapse: null,
  hover: null,
  themeLight: null,
  themeDark: null
};

function initAudio() {
  if (typeof window !== 'undefined') {
    if (!audios.tick) { audios.tick = new Audio('/sounds/tick.mp3'); audios.tick.volume = 0.4; }
    if (!audios.alarm) { audios.alarm = new Audio('/sounds/alarm.mp3'); audios.alarm.volume = 1.0; }
    if (!audios.start) { audios.start = new Audio('/sounds/start.mp3'); audios.start.volume = 0.8; }
    if (!audios.pause) { audios.pause = new Audio('/sounds/pause.mp3'); audios.pause.volume = 0.6; }
    if (!audios.stop) { audios.stop = new Audio('/sounds/stop.mp3'); audios.stop.volume = 0.6; }
    if (!audios.collapse) { audios.collapse = new Audio('/sounds/collapse.mp3'); audios.collapse.volume = 0.7; }
    if (!audios.hover) { audios.hover = new Audio('/sounds/hover.mp3'); audios.hover.volume = 0.3; }
    if (!audios.themeLight) { audios.themeLight = new Audio('/sounds/theme_light.mp3'); audios.themeLight.volume = 0.6; }
    if (!audios.themeDark) { audios.themeDark = new Audio('/sounds/theme_dark.mp3'); audios.themeDark.volume = 0.6; }
  }
}

function playSound(key: string, clone: boolean = false) {
  if (!_soundEnabled) return;
  try {
    initAudio();
    const audio = audios[key];
    if (audio) {
      if (clone) {
        const clonedNode = audio.cloneNode(true) as HTMLAudioElement;
        clonedNode.volume = audio.volume;
        clonedNode.play().catch(e => console.log(`${key} play blocked:`, e));
      } else {
        audio.currentTime = 0;
        audio.play().catch(e => console.log(`${key} play blocked:`, e));
      }
    }
  } catch (e) {
    console.error(`Audio ${key} play failed`, e);
  }
}

export function playTick() { playSound('tick', false); }
export function playAlarm() { playSound('alarm'); }
export function playStart() { playSound('start'); }
export function playPause() { playSound('pause'); }
export function playStop() { playSound('stop'); }
export function playCollapse() { playSound('collapse'); }
export function playHover() { playSound('hover', false); }
export function playThemeLight() { playSound('themeLight'); }
export function playThemeDark() { playSound('themeDark'); }

export async function requestNotificationPermission() {
  try {
    let permissionGranted = await isPermissionGranted();
    if (!permissionGranted) {
      const permission = await requestPermission();
      permissionGranted = permission === 'granted';
    }
    console.log("Notification permission:", permissionGranted);
  } catch (e) {
    console.error("Failed to request notification permission:", e);
  }
}

export async function showNotification(title: string, options?: { body?: string }) {
  try {
    const permissionGranted = await isPermissionGranted();
    if (permissionGranted) {
      console.log("Sending system notification:", title);
      sendNotification({ title, body: options?.body || '' });
    } else {
      console.log("Cannot send notification, permission denied.");
    }
  } catch (e) {
    console.error("Failed to send notification:", e);
  }
}
