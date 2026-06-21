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

// Cache HTMLAudioElements for longer or one-off sounds
const audios: Record<string, HTMLAudioElement | null> = {
  start: null,
  pause: null,
  stop: null,
  collapse: null,
  themeLight: null,
  themeDark: null
};

// Use Web Audio API for rapid, repeated sound effects to fix macOS WKWebView lag
let audioCtx: AudioContext | null = null;
const webAudioBuffers: Record<string, AudioBuffer | null> = {
  tick: null,
  hover: null,
  alarm: null
};

export function initAudio() {
  if (typeof window !== 'undefined') {
    // 1. Initialize Web Audio API
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
        
        const loadBuffer = async (key: string, path: string) => {
          try {
            const res = await fetch(path);
            const arrayBuffer = await res.arrayBuffer();
            webAudioBuffers[key] = await audioCtx!.decodeAudioData(arrayBuffer);
          } catch (e) {
            console.error(`Failed to load ${key}`, e);
          }
        };

        loadBuffer('tick', '/sounds/tick.mp3');
        loadBuffer('hover', '/sounds/hover.mp3');
        loadBuffer('alarm', '/sounds/alarm.mp3');
      }
    } else if (audioCtx.state === 'suspended') {
      // Safari requires resuming AudioContext on user interaction
      audioCtx.resume();
    }

    // 2. Initialize HTML5 Audio for standard sounds
    if (!audios.start) { audios.start = new Audio('/sounds/start.mp3'); audios.start.volume = 0.8; }
    if (!audios.pause) { audios.pause = new Audio('/sounds/pause.mp3'); audios.pause.volume = 0.6; }
    if (!audios.stop) { audios.stop = new Audio('/sounds/stop.mp3'); audios.stop.volume = 0.6; }
    if (!audios.collapse) { audios.collapse = new Audio('/sounds/collapse.mp3'); audios.collapse.volume = 0.7; }
    if (!audios.themeLight) { audios.themeLight = new Audio('/sounds/theme_light.mp3'); audios.themeLight.volume = 0.6; }
    if (!audios.themeDark) { audios.themeDark = new Audio('/sounds/theme_dark.mp3'); audios.themeDark.volume = 0.6; }
  }
}

function playWebAudio(key: string, volume: number = 1.0) {
  if (!_soundEnabled) return;
  try {
    initAudio();
    if (audioCtx && webAudioBuffers[key]) {
      const source = audioCtx.createBufferSource();
      source.buffer = webAudioBuffers[key];
      
      const gainNode = audioCtx.createGain();
      gainNode.gain.value = volume;
      
      source.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      source.start(0);
    }
  } catch (e) {
    console.error(`WebAudio ${key} play failed`, e);
  }
}

function playSound(key: string) {
  if (!_soundEnabled) return;
  try {
    initAudio();
    const audio = audios[key];
    if (audio) {
      audio.currentTime = 0;
      audio.play().catch(e => console.log(`${key} play blocked:`, e));
    }
  } catch (e) {
    console.error(`Audio ${key} play failed`, e);
  }
}

export function playTick() { playWebAudio('tick', 0.4); }
export function playHover() { playWebAudio('hover', 0.3); }
export function playAlarm() { playWebAudio('alarm', 1.0); }

export function playStart() { playSound('start'); }
export function playPause() { playSound('pause'); }
export function playStop() { playSound('stop'); }
export function playCollapse() { playSound('collapse'); }
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
