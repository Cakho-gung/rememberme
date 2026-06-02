<script lang="ts">
  import { fade, fly } from 'svelte/transition';
  import { isSoundEnabled, setSoundEnabled } from '$lib/audio';

  // ── Props ──
  let {
    onClose,
  }: {
    onClose: () => void;
  } = $props();

  // ── Sound ──
  let soundEnabled = $state(isSoundEnabled());

  function toggleSound() {
    soundEnabled = !soundEnabled;
    setSoundEnabled(soundEnabled);
  }

  // ── Shortcuts ──
  // Each shortcut: label, modifiers array, key
  interface Shortcut {
    id: string;
    label: string;
    description: string;
    modifiers: string[];
    key: string;
    isRecording?: boolean;
  }

  let shortcuts = $state<Shortcut[]>([
    {
      id: 'collapse',
      label: 'Collapse / Expand',
      description: 'Collapse or expand the window',
      modifiers: ['Alt'],
      key: 'F',
    },
    {
      id: 'snap-top',
      label: 'Snap Up',
      description: 'Move the window to the top edge',
      modifiers: ['Alt'],
      key: 'W',
    },
    {
      id: 'snap-bottom',
      label: 'Snap Down',
      description: 'Move the window to the bottom edge',
      modifiers: ['Alt'],
      key: 'S',
    },
    {
      id: 'snap-left',
      label: 'Snap Left',
      description: 'Move the window to the left edge',
      modifiers: ['Alt'],
      key: 'A',
    },
    {
      id: 'snap-right',
      label: 'Snap Right',
      description: 'Move the window to the right edge',
      modifiers: ['Alt'],
      key: 'D',
    },
  ]);

  let recordingId = $state<string | null>(null);
  let recordingKeys = $state<string[]>([]);

  function startRecording(id: string) {
    recordingId = id;
    recordingKeys = [];
  }

  function cancelRecording() {
    recordingId = null;
    recordingKeys = [];
  }

  function onKeyDownRecorder(e: KeyboardEvent) {
    if (!recordingId) return;
    e.preventDefault();
    e.stopPropagation();

    if (e.key === 'Escape') {
      cancelRecording();
      return;
    }

    const modifiers: string[] = [];
    if (e.ctrlKey) modifiers.push('Ctrl');
    if (e.altKey) modifiers.push('Alt');
    if (e.shiftKey) modifiers.push('Shift');
    if (e.metaKey) modifiers.push('Meta');

    const ignoredKeys = ['Control', 'Alt', 'Shift', 'Meta'];
    if (ignoredKeys.includes(e.key)) return;

    // Commit the shortcut
    shortcuts = shortcuts.map(s =>
      s.id === recordingId
        ? { ...s, modifiers, key: e.key.toUpperCase() }
        : s
    );
    recordingId = null;
    recordingKeys = [];
  }

  function formatShortcut(s: Shortcut) {
    return [...s.modifiers, s.key].join(' + ');
  }

  // ── UI Scale ──
  type UIScale = 'small' | 'medium' | 'large';

  const scaleMap: Record<UIScale, string> = {
    small:  '1',
    medium: '1.15',
    large:  '1.30',
  };

  const scaleLabels: Record<UIScale, string> = {
    small:  'Small',
    medium: 'Medium',
    large:  'Large',
  };

  // Read initial scale from current CSS variable (set in onMount by page.svelte)
  function getCurrentScale(): UIScale {
    const v = getComputedStyle(document.documentElement)
      .getPropertyValue('--ui-scale').trim();
    if (v === '1.15') return 'medium';
    if (v === '1.30') return 'large';
    return 'small';
  }

  let currentUIScale = $state<UIScale>(getCurrentScale());

  function setUIScale(scale: UIScale) {
    currentUIScale = scale;
    document.documentElement.style.setProperty('--ui-scale', scaleMap[scale]);
    localStorage.setItem('uiScale', scale);
  }

  // Section open states (collapsed by default)
  let soundOpen = $state(false);
  let uiScaleOpen = $state(false);
  let timerOpen = $state(false);
  let shortcutsOpen = $state(false);

  // ── Timer Limit ──
  type TimerPreset = '20s' | '60m' | '2h' | '4h' | '8h';

  const timerLabelsMap: Record<TimerPreset, string> = {
    '20s': '20s',
    '60m': '60m',
    '2h':  '2h',
    '4h':  '4h',
    '8h':  '8h',
  };

  function getCurrentTimerPreset(): TimerPreset {
    const saved = localStorage.getItem('timerPreset');
    if (saved === '20s' || saved === '60m' || saved === '2h' || saved === '4h' || saved === '8h') {
      return saved;
    }
    return '60m';
  }

  let currentTimerPreset = $state<TimerPreset>(getCurrentTimerPreset());

  function setTimerPreset(preset: TimerPreset) {
    currentTimerPreset = preset;
    localStorage.setItem('timerPreset', preset);
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="settings-panel"
  transition:fly={{ y: -8, duration: 200 }}
  onkeydown={onKeyDownRecorder}
  role="dialog"
  aria-label="Settings"
>
  <!-- Header -->
  <div class="settings-header">
    <button class="settings-back-btn" onclick={onClose} aria-label="Back">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
        <path d="M9.96967 3.46967C10.2626 3.76256 10.2626 4.23744 9.96967 4.53033L6.49999 8L9.96967 11.4697C10.2626 11.7626 10.2626 12.2374 9.96967 12.5303C9.67678 12.8232 9.20191 12.8232 8.90901 12.5303L4.90901 8.53033C4.61612 8.23744 4.61612 7.76256 4.90901 7.46967L8.90901 3.46967C9.20191 3.17678 9.67678 3.17678 9.96967 3.46967Z"/>
      </svg>
    </button>
    <span class="settings-title">Settings</span>
  </div>

  <div class="settings-body">

    <!-- ── Section 1: Sound Effects ── -->
    <div class="settings-section">
      <button class="section-header" onclick={() => soundOpen = !soundOpen} aria-expanded={soundOpen}>
        <div class="section-header-left">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
          </svg>
          <span>Sound</span>
        </div>
        <svg class="chevron {soundOpen ? 'open' : ''}" width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <path d="M7.18963 10.5875C7.43137 10.8142 7.81065 10.8019 8.03729 10.5602L12.0373 6.31016C12.2639 6.06841 12.2517 5.68914 12.0099 5.4625C11.7682 5.23586 11.3889 5.24809 11.1623 5.48984L7.57246 9.35584L3.98263 5.48984C3.75599 5.24809 3.37672 5.23586 3.13497 5.4625C2.89322 5.68914 2.88099 6.06841 3.10763 6.31016L7.10763 10.5602L7.18963 10.5875Z"/>
        </svg>
      </button>

      {#if soundOpen}
        <div class="section-body" transition:fly={{ y: -4, duration: 150 }}>
          <div class="setting-row">
            <div class="setting-info">
              <span class="setting-label">Sound Effects</span>
              <span class="setting-desc">Hover, collapse, and theme switch sounds...</span>
            </div>
            <!-- Toggle Switch -->
            <button
              class="toggle-switch {soundEnabled ? 'on' : 'off'}"
              onclick={toggleSound}
              role="switch"
              aria-checked={soundEnabled}
              aria-label="Toggle sound effects"
            >
              <span class="toggle-thumb"></span>
            </button>
          </div>
        </div>
      {/if}
    </div>

    <div class="section-divider"></div>

    <!-- ── Section 2: UI Scale ── -->
    <div class="settings-section">
      <button class="section-header" onclick={() => uiScaleOpen = !uiScaleOpen} aria-expanded={uiScaleOpen}>
        <div class="section-header-left">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 3 21 3 21 9"></polyline>
            <polyline points="9 21 3 21 3 15"></polyline>
            <line x1="21" y1="3" x2="14" y2="10"></line>
            <line x1="3" y1="21" x2="10" y2="14"></line>
          </svg>
          <span>UI Scale</span>
        </div>
        <svg class="chevron {uiScaleOpen ? 'open' : ''}" width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <path d="M7.18963 10.5875C7.43137 10.8142 7.81065 10.8019 8.03729 10.5602L12.0373 6.31016C12.2639 6.06841 12.2517 5.68914 12.0099 5.4625C11.7682 5.23586 11.3889 5.24809 11.1623 5.48984L7.57246 9.35584L3.98263 5.48984C3.75599 5.24809 3.37672 5.23586 3.13497 5.4625C2.89322 5.68914 2.88099 6.06841 3.10763 6.31016L7.10763 10.5602L7.18963 10.5875Z"/>
        </svg>
      </button>

      {#if uiScaleOpen}
        <div class="section-body" transition:fly={{ y: -4, duration: 150 }}>
          <div class="setting-row">
            <div class="setting-info">
              <span class="setting-label">Interface Size</span>
              <span class="setting-desc">Scale text, icons, and spacing.</span>
            </div>
            <!-- Segmented scale picker -->
            <div class="scale-selector" role="group" aria-label="UI Scale">
              {#each (['small', 'medium', 'large'] as UIScale[]) as scale}
                <button
                  class="scale-btn {currentUIScale === scale ? 'active' : ''}"
                  onclick={() => setUIScale(scale)}
                  aria-pressed={currentUIScale === scale}
                >
                  {scaleLabels[scale]}
                </button>
              {/each}
            </div>
          </div>
        </div>
      {/if}
    </div>

    <div class="section-divider"></div>

    <!-- ── Section 3: Timer Limit ── -->
    <div class="settings-section">
      <button class="section-header" onclick={() => timerOpen = !timerOpen} aria-expanded={timerOpen}>
        <div class="section-header-left">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
          <span>Timer Limit</span>
        </div>
        <svg class="chevron {timerOpen ? 'open' : ''}" width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <path d="M7.18963 10.5875C7.43137 10.8142 7.81065 10.8019 8.03729 10.5602L12.0373 6.31016C12.2639 6.06841 12.2517 5.68914 12.0099 5.4625C11.7682 5.23586 11.3889 5.24809 11.1623 5.48984L7.57246 9.35584L3.98263 5.48984C3.75599 5.24809 3.37672 5.23586 3.13497 5.4625C2.89322 5.68914 2.88099 6.06841 3.10763 6.31016L7.10763 10.5602L7.18963 10.5875Z"/>
        </svg>
      </button>

      {#if timerOpen}
        <div class="section-body" transition:fly={{ y: -4, duration: 150 }}>
          <div class="setting-row">
            <div class="setting-info">
              <span class="setting-label">Maximum Duration</span>
              <span class="setting-desc">Set the maximum duration for the focus timer.</span>
            </div>
            <!-- Segmented scale picker -->
            <div class="scale-selector" role="group" aria-label="Timer Limit">
              {#each (['20s', '60m', '2h', '4h', '8h'] as TimerPreset[]) as preset}
                <button
                  class="scale-btn {currentTimerPreset === preset ? 'active' : ''}"
                  onclick={() => setTimerPreset(preset)}
                  aria-pressed={currentTimerPreset === preset}
                >
                  {timerLabelsMap[preset]}
                </button>
              {/each}
            </div>
          </div>
        </div>
      {/if}
    </div>

    <div class="section-divider"></div>

    <!-- ── Section 4: Keyboard Shortcuts ── -->
    <div class="settings-section">
      <button class="section-header" onclick={() => shortcutsOpen = !shortcutsOpen} aria-expanded={shortcutsOpen}>
        <div class="section-header-left">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2" ry="2"></rect>
            <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10"></path>
          </svg>
          <span>Shortcuts</span>
        </div>
        <svg class="chevron {shortcutsOpen ? 'open' : ''}" width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <path d="M7.18963 10.5875C7.43137 10.8142 7.81065 10.8019 8.03729 10.5602L12.0373 6.31016C12.2639 6.06841 12.2517 5.68914 12.0099 5.4625C11.7682 5.23586 11.3889 5.24809 11.1623 5.48984L7.57246 9.35584L3.98263 5.48984C3.75599 5.24809 3.37672 5.23586 3.13497 5.4625C2.89322 5.68914 2.88099 6.06841 3.10763 6.31016L7.10763 10.5602L7.18963 10.5875Z"/>
        </svg>
      </button>

      {#if shortcutsOpen}
        <div class="section-body" transition:fly={{ y: -4, duration: 150 }}>
          <p class="shortcut-hint">Click a shortcut to record a new key combo. Press <kbd>Esc</kbd> to cancel.</p>
          {#each shortcuts as shortcut}
            <div class="shortcut-row">
              <div class="shortcut-info">
                <span class="shortcut-label">{shortcut.label}</span>
                <span class="shortcut-desc">{shortcut.description}</span>
              </div>
              <button
                class="shortcut-key-btn {recordingId === shortcut.id ? 'recording' : ''}"
                onclick={() => recordingId === shortcut.id ? cancelRecording() : startRecording(shortcut.id)}
                aria-label="Edit shortcut for {shortcut.label}"
              >
                {#if recordingId === shortcut.id}
                  <span class="recording-pulse"></span>
                  <span class="recording-text">Recording...</span>
                {:else}
                  {formatShortcut(shortcut)}
                {/if}
              </button>
            </div>
          {/each}
        </div>
      {/if}
    </div>

  </div>
</div>

<style lang="scss">
  @use '../../styles/variables' as *;

  .settings-panel {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 15;
    background: var(--bg-focused);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  }

  // ── Header ──
  .settings-header {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 6px;
    padding: 12px 14px 10px;
    flex-shrink: 0;
    border-bottom: 1px solid var(--dropdown-divider-bg, rgba(0,0,0,0.08));
  }

  .settings-title {
    font-family: $font-family-mono;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-text);
    opacity: 0.5;
  }

  .settings-back-btn {
    background: transparent;
    border: none;
    color: var(--color-text);
    opacity: 0.45;
    cursor: pointer;
    padding: 3px;
    margin-left: -4px; /* offset padding to align visually with margins */
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;

    &:hover {
      opacity: 1;
      background: rgba(128, 128, 128, 0.1);
      color: var(--color-accent, #6B7280);
    }

    &:active {
      transform: scale(0.92);
    }
  }

  // ── Body ──
  .settings-body {
    flex: 1;
    overflow-y: auto;
    padding: 6px 0 12px;
    display: flex;
    flex-direction: column;

    // Hide scrollbar
    -ms-overflow-style: none;
    scrollbar-width: none;
    &::-webkit-scrollbar { display: none; }
  }

  .section-divider {
    height: 1px;
    background: var(--dropdown-divider-bg, rgba(0,0,0,0.07));
    margin: 4px 14px;
    flex-shrink: 0;
  }

  // ── Section ──
  .settings-section {
    display: flex;
    flex-direction: column;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 14px;
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--color-text);
    transition: background 0.15s ease;
    border-radius: 0;

    &:hover {
      background: rgba(128,128,128,0.06);
    }
  }

  .section-header-left {
    display: flex;
    align-items: center;
    gap: 7px;
    font-family: $font-family-base;
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text);
  }

  .chevron {
    transition: transform 0.2s ease;
    opacity: 0.5;
    flex-shrink: 0;

    &.open {
      transform: rotate(180deg);
    }
  }

  .section-body {
    padding: 4px 14px 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  // ── Sound Setting Row ──
  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 0;
  }

  .setting-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  .setting-label {
    font-family: $font-family-base;
    font-size: 12px;
    font-weight: 500;
    color: var(--color-text);
  }

  .setting-desc {
    font-family: $font-family-base;
    font-size: 10px;
    color: var(--color-text);
    opacity: 0.45;
    line-height: 1.4;
  }

  // ── Toggle Switch ──
  .toggle-switch {
    position: relative;
    width: 34px;
    height: 19px;
    border-radius: 999px;
    border: none;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.25s ease;
    padding: 0;
    display: flex;
    align-items: center;

    &.on {
      background: var(--color-accent, #6B7280);

      .toggle-thumb {
        transform: translateX(15px);
      }
    }

    &.off {
      background: rgba(128, 128, 128, 0.25);

      .toggle-thumb {
        transform: translateX(2px);
      }
    }

    &:hover {
      filter: brightness(1.1);
    }

    &:active {
      transform: scale(0.96);
    }
  }

  .toggle-thumb {
    position: absolute;
    width: 15px;
    height: 15px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0,0,0,0.25);
    transition: transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  // ── Shortcut hint ──
  .shortcut-hint {
    font-family: $font-family-base;
    font-size: 10px;
    color: var(--color-text);
    opacity: 0.4;
    margin: 0 0 4px;
    line-height: 1.5;

    kbd {
      font-family: $font-family-mono;
      font-size: 9px;
      background: rgba(128,128,128,0.15);
      border-radius: 3px;
      padding: 1px 4px;
      border: 1px solid rgba(128,128,128,0.2);
    }
  }

  // ── Shortcut Row ──
  .shortcut-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 5px 0;
    border-bottom: 1px solid rgba(128,128,128,0.07);

    &:last-child {
      border-bottom: none;
    }
  }

  .shortcut-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex: 1;
    min-width: 0;
  }

  .shortcut-label {
    font-family: $font-family-base;
    font-size: 12px;
    font-weight: 500;
    color: var(--color-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .shortcut-desc {
    font-family: $font-family-base;
    font-size: 10px;
    color: var(--color-text);
    opacity: 0.4;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .shortcut-key-btn {
    font-family: $font-family-mono;
    font-size: 10px;
    font-weight: 600;
    color: var(--color-text);
    background: rgba(128,128,128,0.1);
    border: 1px solid rgba(128,128,128,0.18);
    border-radius: 5px;
    padding: 3px 8px;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    min-width: 60px;
    text-align: center;
    transition: all 0.18s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;

    &:hover {
      background: rgba(128,128,128,0.18);
      border-color: var(--color-accent, #6B7280);
      color: var(--color-accent, #6B7280);
    }

    &.recording {
      background: color-mix(in srgb, var(--color-accent, #6B7280) 12%, transparent);
      border-color: var(--color-accent, #6B7280);
      color: var(--color-accent, #6B7280);
      animation: pulse-border 1s ease infinite;
    }
  }

  .recording-pulse {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-accent, #6B7280);
    animation: blink 0.8s ease infinite;
    flex-shrink: 0;
  }

  .recording-text {
    font-size: 10px;
  }

  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.2; }
  }

  @keyframes pulse-border {
    0%, 100% { box-shadow: 0 0 0 0 rgba(128,128,128,0.3); }
    50% { box-shadow: 0 0 0 3px rgba(128,128,128,0.12); }
  }

  // ── UI Scale Segmented Picker ──
  .scale-selector {
    display: flex;
    align-items: center;
    background: rgba(128, 128, 128, 0.08);
    border: 1px solid rgba(128, 128, 128, 0.14);
    border-radius: 7px;
    padding: 2px;
    gap: 2px;
    flex-shrink: 0;
  }

  .scale-btn {
    font-family: $font-family-base;
    font-size: 10px;
    font-weight: 500;
    color: var(--color-text);
    opacity: 0.5;
    background: transparent;
    border: none;
    border-radius: 5px;
    padding: 3px 8px;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.18s ease;
    line-height: 1.4;

    &:hover {
      opacity: 0.8;
      background: rgba(128, 128, 128, 0.1);
    }

    &.active {
      background: var(--color-accent, #6B7280);
      color: var(--color-accent-text, #ffffff);
      opacity: 1;
      font-weight: 600;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
    }
  }
</style>
