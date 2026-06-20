<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { playTick, playAlarm, showNotification, playStart, playPause, playStop, requestNotificationPermission } from '$lib/audio';
  import { showToast } from '$lib/toastStore';
  import { ToastMessages } from '$lib/messages';

  let { 
    onComplete = () => {},
    timerPreset: presetProp = undefined,
  }: { 
    onComplete?: () => void;
    timerPreset?: string;
  } = $props();

  type TimerState = 'idle' | 'dragging' | 'running' | 'paused';
  let currentState: TimerState = $state('idle');
  
  let containerRef: HTMLDivElement;
  let pillBtnRef: HTMLButtonElement;
  let progressGradientRef: HTMLDivElement | undefined;
  
  // Use Svelte reactive state — we fixed the audio clone bottleneck,
  // so Svelte's reactivity can easily handle 60fps here without lag.
  let dragX = $state(0);
  
  let maxX = $state(0);
  
  let containerWidth = $state(0);

  // Cached UI scale – read once at drag-start and on resize, not per-frame
  let cachedUiScale = 1;

  function readUiScale(): number {
    return parseFloat(
      document.documentElement.style.getPropertyValue('--ui-scale') ||
      getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')
    ) || 1;
  }

  /**
   * Apply transform directly to DOM for the heaviest elements (pill and gradient)
   * to guarantee 60fps on macOS. The rest (dots/labels) use Svelte reactivity.
   */
  function applyTransform(x: number) {
    dragX = x; // Keep Svelte state in sync for dots/labels visibility
    
    // 1. Move pill button directly
    if (pillBtnRef) {
      pillBtnRef.style.transform = `translateX(${x}px)`;
    }
    
    // 2. Update progress bar width directly
    if (progressGradientRef) {
      progressGradientRef.style.width = `${x + 16}px`;
    }
  }
  
  // ── Load Preset Settings ──
  type TimerPreset = '20s' | '60m' | '2h' | '4h' | '8h';

  function getTimerPreset(): TimerPreset {
    if (typeof window === 'undefined') return '60m';
    // Allow parent to pass an override (e.g. after settings change)
    const saved = presetProp ?? localStorage.getItem('timerPreset');
    if (saved === '20s' || saved === '60m' || saved === '2h' || saved === '4h' || saved === '8h') {
      return saved as TimerPreset;
    }
    return '60m';
  }


  // Preset Mapping Configs:
  // maxSeconds: the actual duration in seconds
  // maxUnitsValue: the number to use for calculating dynamic labels
  // unit: the visual unit suffix 's' or 'm'
  // labels: round number markers to render
  // dots: visual midpoint dots to render
  const presetConfig: Record<TimerPreset, { 
    maxSeconds: number; 
    maxUnitsValue: number; 
    unit: string;
    labels: number[];
    dots: number[];
  }> = {
    '20s': { 
      maxSeconds: 20, 
      maxUnitsValue: 20, 
      unit: 's',
      labels: [0, 4, 8, 12, 16, 20],
      dots: [2, 6, 10, 14, 18]
    },
    '60m': { 
      maxSeconds: 3600, 
      maxUnitsValue: 60, 
      unit: 'm',
      labels: [0, 10, 20, 30, 40, 50, 60],
      dots: [5, 15, 25, 35, 45, 55]
    },
    '2h':  { 
      maxSeconds: 7200, 
      maxUnitsValue: 120, 
      unit: 'm',
      labels: [0, 20, 40, 60, 80, 100, 120],
      dots: [10, 30, 50, 70, 90, 110]
    },
    '4h':  { 
      maxSeconds: 14400, 
      maxUnitsValue: 240, 
      unit: 'm',
      labels: [0, 40, 80, 120, 160, 200, 240],
      dots: [20, 60, 100, 140, 180, 220]
    },
    '8h':  { 
      maxSeconds: 28800, 
      maxUnitsValue: 480, 
      unit: 'm',
      labels: [0, 80, 160, 240, 320, 400, 480],
      dots: [40, 120, 200, 280, 360, 440]
    },
  };

  // Reactive preset — re-read when prop changes
  let activePreset = $derived(getTimerPreset());

  let config = $derived(presetConfig[activePreset]);

  // Dynamic bounds configuration — all reactive to preset
  let MAX_SECONDS = $derived(config.maxSeconds);
  let MAX_MINUTES = $derived(config.maxUnitsValue); // Represent maxUnitsValue for geometry
  let timerUnit = $derived(config.unit);

  // Dynamic labels and ticks
  let timeLabels = $derived(config.labels);
  let timeDots = $derived(config.dots);

  let timeRemaining = $state(0);
  let totalTimeSet = $state(0);
  
  let requestRef: number | null = null;
  let lastTime = 0;
  let lastTickTime = 0;
  let isHovered = $state(false);
  let isStopping = $state(false);

  $effect(() => {
    if (containerWidth > 0) {
      maxX = Math.max(0, containerWidth - 32);
      // Nếu đang chạy hoặc tạm dừng, phải tính lại dragX theo width mới
      if (currentState === 'running' || currentState === 'paused') {
        const percentage = timeRemaining / MAX_SECONDS;
        applyTransform(percentage * maxX);
      }
      // Refresh cached scale on resize (window may have changed zoom)
      cachedUiScale = readUiScale();
    }
  });

  function startDrag(e: PointerEvent) {
    if (currentState === 'running' || currentState === 'paused' || isStopping) return;
    
    currentState = 'dragging';
    if (containerWidth > 0) {
      // Container width minus button width (32)
      maxX = Math.max(0, containerWidth - 32);
    }

    // Cache uiScale at drag-start so pointermove handler never calls getComputedStyle
    cachedUiScale = readUiScale();
    
    if (e.target instanceof Element) {
      e.target.setPointerCapture(e.pointerId);
    }
    
    updateDragPosition(e);
    
    window.addEventListener('pointermove', onDragMove as EventListener);
    window.addEventListener('pointerup', onDragEnd as EventListener);
  }

  function onDragMove(e: PointerEvent) {
    updateDragPosition(e);
  }

  function updateDragPosition(e: PointerEvent) {
    if (!containerRef) return;
    const rect = containerRef.getBoundingClientRect();
    
    // Use cached uiScale (set at drag-start) — avoids getComputedStyle on every frame
    // which causes jank on macOS WKWebView
    const uiScale = cachedUiScale || 1;
    
    // Calculate new X based on mouse position relative to container
    // Client X and rect.left are viewport coordinates, so we divide by uiScale to get CSS coordinates
    let newX = (e.clientX - rect.left) / uiScale - 16;
    newX = Math.max(0, Math.min(newX, maxX));
    
    // Direct DOM update bypasses Svelte reactivity — eliminates jank on macOS WKWebView
    applyTransform(newX);
    
    const percentage = newX / maxX;
    totalTimeSet = percentage * MAX_SECONDS;
    
    // Play ~50 ticks across the full slider range
    const currentTickTime = Math.floor(percentage * 50);
    if (currentTickTime !== lastTickTime && currentTickTime > 0) {
      playTick();
      lastTickTime = currentTickTime;
    }
  }

  function onDragEnd(e: PointerEvent) {
    if (e.target instanceof Element && e.target.hasPointerCapture(e.pointerId)) {
      e.target.releasePointerCapture(e.pointerId);
    }
    
    window.removeEventListener('pointermove', onDragMove as EventListener);
    window.removeEventListener('pointerup', onDragEnd as EventListener);
    
    if (totalTimeSet > 0) {
      // Prompt for notification permission on user interaction (required by macOS)
      requestNotificationPermission();
      
      playStart();
      currentState = 'running';
      timeRemaining = totalTimeSet;
      startTimer();
      
      let roundedMins = Math.round(totalTimeSet / 60 / 5) * 5;
      if (roundedMins === 0) roundedMins = Math.max(1, Math.round(totalTimeSet / 60));
      showToast(ToastMessages.TIMER_START(roundedMins));
    } else {
      currentState = 'idle';
      applyTransform(0);
    }
  }

  function startTimer() {
    if (requestRef) cancelAnimationFrame(requestRef);
    lastTime = performance.now();
    
    function tick(now: number) {
      if (currentState !== 'running') return; // Pause or stop handling
      
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      
      timeRemaining = Math.max(0, timeRemaining - dt);
      
      // Update dragX based on time remaining to move it left
      const percentage = timeRemaining / MAX_SECONDS;
      const newX = percentage * maxX;
      // Direct DOM update for smooth animation on macOS — avoids reactive overhead per frame
      applyTransform(newX);
      
      if (timeRemaining > 0) {
        requestRef = requestAnimationFrame(tick);
      } else {
        onTimerComplete();
      }
    }
    requestRef = requestAnimationFrame(tick);
  }

  function onTimerComplete() {
    isStopping = true;
    applyTransform(0);
    
    playAlarm();
    
    const funnyMessages = [
      "Time's up! Back to work, boss! 🚀",
      "Beep beep beep! Time limit reached, you're on fire! 🔥",
      "Ring ring! Time is up, back to reality! 👽",
      "Awesome! One session done, stand up and stretch! 🕺",
      "Time's up! The deadline is chasing you! 🏃‍♂️💨"
    ];
    const randomMsg = funnyMessages[Math.floor(Math.random() * funnyMessages.length)];
    
    showNotification("RememberMe - Time's up!", {
      body: randomMsg,
    });

    showToast(ToastMessages.TIMER_DONE);

    onComplete();
    setTimeout(() => {
      isStopping = false;
      currentState = 'idle';
    }, 400);
  }

  function togglePause() {
    if (currentState === 'running') {
      playPause();
      currentState = 'paused';
      if (requestRef) cancelAnimationFrame(requestRef);
    } else if (currentState === 'paused') {
      playStart();
      currentState = 'running';
      startTimer();
    }
  }

  function stopTimer() {
    playStop();
    if (requestRef) cancelAnimationFrame(requestRef);
    isStopping = true;
    applyTransform(0);
    timeRemaining = 0;
    setTimeout(() => {
      isStopping = false;
      currentState = 'idle';
    }, 400);
  }

  onDestroy(() => {
    if (requestRef) cancelAnimationFrame(requestRef);
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointermove', onDragMove as EventListener);
      window.removeEventListener('pointerup', onDragEnd as EventListener);
    }
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div 
  class="timer-widget-container" 
  bind:this={containerRef}
  bind:clientWidth={containerWidth}
  onmouseenter={() => isHovered = true}
  onmouseleave={() => isHovered = false}
>
  <!-- Background Track & Marks -->
  {#if currentState === 'dragging' || currentState === 'running' || currentState === 'paused'}
    <div class="timer-track" class:stopping={isStopping}>
      <!-- Progress Gradient -->
      <div 
        class="progress-gradient" 
        class:stopping={isStopping} 
        style="width: {dragX + 16}px"
        bind:this={progressGradientRef}
      ></div>

      <!-- Dots -->
      {#each timeDots as dot}
        <div 
          class="time-mark visible" 
          style="left: {(dot / MAX_MINUTES) * 100}%"
        >
          <div class="mark-dot"></div>
        </div>
      {/each}

      <!-- Labels -->
      {#each timeLabels as label}
        <div 
          class="time-mark visible" 
          style="left: {(label / MAX_MINUTES) * 100}%"
          class:hidden-zero={label === 0 && (currentState === 'running' || currentState === 'paused')}
        >
          <span class="mark-label">{label === 0 ? '0' : `${label}${timerUnit}`}</span>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Left Side: Stop button (when active) or Helper Text (when idle) -->
  {#if currentState === 'idle'}
    <div class="idle-text" class:visible={isHovered}>
      Drag to start counting <span class="arrows">&raquo;</span>
    </div>
  {:else if currentState === 'running' || currentState === 'paused'}
    <!-- Stop Button -->
    <button class="timer-btn stop-btn" class:stopping={isStopping} onclick={stopTimer} aria-label="Stop Timer">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect>
      </svg>
    </button>
  {/if}

  <button 
    class="timer-btn pill-btn"
    class:dragging={currentState === 'dragging'}
    class:active={currentState === 'running' || currentState === 'paused'}
    class:stopping={isStopping}
    style="transform: translateX({dragX}px);"
    bind:this={pillBtnRef}
    onpointerdown={startDrag}
    onclick={currentState === 'running' || currentState === 'paused' ? togglePause : undefined}
    aria-label="Timer Control"
  >
    {#if currentState === 'idle' || currentState === 'dragging'}
      <!-- Clock Icon -->
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
        <g clip-path="url(#clip0_1_932)">
          <path d="M12.9808 9.27142C12.9808 6.54096 10.7876 4.32784 8.08297 4.32784C5.37852 4.32803 3.18619 6.54108 3.18619 9.27142C3.18619 12.0018 5.37852 14.2148 8.08297 14.215C10.7876 14.215 12.9808 12.0019 12.9808 9.27142ZM9.65332 6.54207C9.96621 6.2262 10.4735 6.22631 10.7865 6.54207C11.0994 6.85801 11.0994 7.37012 10.7865 7.68606L8.64955 9.84341C8.33659 10.1592 7.82928 10.1593 7.5164 9.84341C7.20368 9.52752 7.20368 9.01532 7.5164 8.69942L9.65332 6.54207ZM9.50829 -0.166992C9.9507 -0.166803 10.3096 0.195329 10.3096 0.642014C10.3096 1.0887 9.9507 1.45083 9.50829 1.45102H6.6587C6.21613 1.45102 5.85735 1.08882 5.85735 0.642014C5.85735 0.195212 6.21613 -0.166992 6.6587 -0.166992H9.50829ZM14.5835 9.27142C14.5835 12.8955 11.6727 15.833 8.08297 15.833C4.49338 15.8328 1.5835 12.8954 1.5835 9.27142C1.5835 5.64747 4.49338 2.71002 8.08297 2.70983C11.6727 2.70983 14.5835 5.64736 14.5835 9.27142Z" fill="currentColor"/>
        </g>
        <defs>
          <clipPath id="clip0_1_932">
            <rect width="16" height="16" fill="currentColor"/>
          </clipPath>
        </defs>
      </svg>
    {:else if currentState === 'running'}
      <!-- Pause Icon -->
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="6" y="4" width="4" height="16"></rect>
        <rect x="14" y="4" width="4" height="16"></rect>
      </svg>
    {:else if currentState === 'paused'}
      <!-- Play Icon -->
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="5 3 19 12 5 21 5 3"></polygon>
      </svg>
    {/if}
  </button>
</div>

<style lang="scss">
  @use '../../styles/variables' as *;

  .timer-widget-container {
    display: flex;
    align-items: center;
    position: relative;
    width: 100%;
    height: 32px;
    user-select: none;
    touch-action: none; // Prevent scrolling while dragging
  }

  .idle-text {
    position: absolute;
    left: 40px; // Spaced after the clock icon
    font-size: 12px;
    color: $color-text;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s ease;
    white-space: nowrap;

    &.visible {
      opacity: 0.6;
    }

    .arrows {
      font-size: 10px;
      margin-left: 2px;
    }
  }

  .timer-track {
    position: absolute;
    left: 16px; // Start offset to align with button center
    right: 16px; // End offset
    height: 100%;
    pointer-events: none;
    transition: opacity 0.4s ease;

    &.stopping {
      opacity: 0;
    }
  }

  .progress-gradient {
    position: absolute;
    left: -16px;
    top: 50%;
    transform: translateY(-50%);
    height: 32px;
    border-radius: 16px;
    background: linear-gradient(to right, color-mix(in srgb, $color-accent 0%, transparent) 0%, color-mix(in srgb, $color-accent 10%, transparent) 100%);

    &.stopping {
      transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    }
  }

  .time-mark {
    position: absolute;
    top: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    color: $color-text;
    transition: opacity 0.2s ease;

    &.visible {
      opacity: 0.4;
    }

    &.hidden-zero {
      opacity: 0 !important;
    }

    .mark-dot {
      width: 4px;
      height: 4px;
      background-color: currentColor;
      border-radius: 50%;
    }

    .mark-label {
      font-size: 10px;
      font-weight: 500;
    }
  }

  .timer-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: none;
    border-radius: 8px;
    background: transparent;
    cursor: pointer;
    color: $color-text;
    transition: background 0.2s ease, opacity 0.2s ease, color 0.2s ease;
    opacity: 0.5;
    position: absolute; // Allow translation
    left: 0; // Base position
    // GPU compositing layer — ensures transform updates don't trigger repaints
    will-change: transform;
    // Force GPU layer creation on macOS WKWebView
    transform: translateX(0) translateZ(0);

    &:hover {
      opacity: 0.8;
    }

    &:active {
      opacity: 1;
    }
  }

  .stop-btn {
    opacity: 0.6;
    z-index: 10;
    &:hover {
      background: rgba($color-text, 0.1);
      color: $color-danger;
      opacity: 1;
    }

    &.stopping {
      opacity: 0 !important;
      pointer-events: none;
    }
  }

  .pill-btn {
    z-index: 20;

    &.dragging {
      background: $color-accent;
      color: #fff;
      opacity: 1;
      cursor: grabbing;
      // Remove ALL transitions during drag for immediate follow on all platforms
      transition: none !important;
      -webkit-transition: none !important;
    }

    &.active {
      background: $color-accent;
      color: #fff;
      opacity: 1;
      // Re-enable smooth transition so backward movement isn't jittery
      transition: background 0.2s ease;
    }

    &.stopping {
      background: transparent !important;
      color: $color-text !important;
      opacity: 0.5 !important;
      transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1), background 0.4s ease, color 0.4s ease, opacity 0.4s ease !important;
    }
  }
</style>
