<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { playTick, playAlarm, requestNotificationPermission, showNotification, playStart, playPause, playStop } from '$lib/audio';

  let { onComplete = () => {} }: { onComplete?: () => void } = $props();

  type TimerState = 'idle' | 'dragging' | 'running' | 'paused';
  let currentState: TimerState = $state('idle');
  
  let containerRef: HTMLDivElement;
  
  let dragX = $state(0);
  let maxX = $state(0);
  
  let containerWidth = $state(0);
  
  // Tạm thời set 10s để test
  const MAX_MINUTES = 10; // Coi label là giây
  const MAX_SECONDS = 10;
  
  let timeRemaining = $state(0);
  let totalTimeSet = $state(0);
  
  let requestRef: number | null = null;
  let lastTime = 0;
  let lastTickTime = 0;
  let isHovered = $state(false);
  let isStopping = $state(false);

  // Sửa label thành các mốc giây để test
  const timeLabels = [0, 2, 4, 6, 8];
  const timeDots = [1, 3, 5, 7, 9];

  $effect(() => {
    if (containerWidth > 0) {
      maxX = Math.max(0, containerWidth - 32);
      // Nếu đang chạy hoặc tạm dừng, phải tính lại dragX theo width mới
      if (currentState === 'running' || currentState === 'paused') {
        const percentage = timeRemaining / MAX_SECONDS;
        dragX = percentage * maxX;
      }
    }
  });

  function startDrag(e: PointerEvent) {
    if (currentState === 'running' || currentState === 'paused' || isStopping) return;
    
    currentState = 'dragging';
    if (containerWidth > 0) {
      // Container width minus button width (32)
      maxX = Math.max(0, containerWidth - 32);
    }
    
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
    
    // Calculate new X based on mouse position relative to container
    let newX = e.clientX - rect.left - 16;
    newX = Math.max(0, Math.min(newX, maxX));
    
    dragX = newX; // Smooth drag, no visual snapping
    
    const percentage = newX / maxX;
    totalTimeSet = percentage * MAX_SECONDS;
    
    const currentTickTime = Math.floor(totalTimeSet * 5);
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
      requestNotificationPermission();
      playStart();
      currentState = 'running';
      timeRemaining = totalTimeSet;
      startTimer();
    } else {
      currentState = 'idle';
      dragX = 0;
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
      dragX = percentage * maxX;
      
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
    dragX = 0;
    
    playAlarm();
    showNotification("Timer Complete", {
      body: "Your time is up!",
    });

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
    dragX = 0;
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
      <div class="progress-gradient" class:stopping={isStopping} style="width: {dragX + 16}px"></div>

      <!-- Dots -->
      {#each timeDots as dot}
        <div 
          class="time-mark" 
          style="left: {(dot / MAX_MINUTES) * 100}%"
          class:visible={(dot / MAX_MINUTES) <= (maxX > 0 ? dragX / maxX : 0)}
        >
          <div class="mark-dot"></div>
        </div>
      {/each}

      <!-- Labels -->
      {#each timeLabels as label}
        <div 
          class="time-mark" 
          style="left: {(label / MAX_MINUTES) * 100}%"
          class:visible={(label / MAX_MINUTES) <= (maxX > 0 ? dragX / maxX : 0)}
          class:hidden-zero={label === 0 && (currentState === 'running' || currentState === 'paused')}
        >
          <span class="mark-label">{label}</span>
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
    onpointerdown={startDrag}
    onclick={currentState === 'running' || currentState === 'paused' ? togglePause : undefined}
    aria-label="Timer Control"
  >
    {#if currentState === 'idle' || currentState === 'dragging'}
      <!-- Clock Icon -->
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
        <path d="M12.8335 8.5332C12.8335 5.86383 10.6689 3.69922 7.99951 3.69922C5.33029 3.69939 3.1665 5.86393 3.1665 8.5332C3.16661 11.2024 5.33035 13.366 7.99951 13.3662C10.6688 13.3662 12.8334 11.2025 12.8335 8.5332ZM9.646 6.17969C9.84124 5.98445 10.1578 5.98449 10.353 6.17969C10.5483 6.37495 10.5483 6.69146 10.353 6.88672L8.35303 8.88672C8.15774 9.08172 7.84117 9.08189 7.646 8.88672C7.45089 8.69154 7.45102 8.37495 7.646 8.17969L9.646 6.17969ZM9.3335 0.833008C9.60949 0.833184 9.8335 1.05697 9.8335 1.33301C9.8335 1.60904 9.60949 1.83283 9.3335 1.83301H6.6665C6.39036 1.83301 6.1665 1.60915 6.1665 1.33301C6.1665 1.05687 6.39036 0.833008 6.6665 0.833008H9.3335ZM13.8335 8.5332C13.8334 11.7548 11.2211 14.3662 7.99951 14.3662C4.77807 14.366 2.16661 11.7547 2.1665 8.5332C2.1665 5.31165 4.778 2.69939 7.99951 2.69922C11.2212 2.69922 13.8335 5.31154 13.8335 8.5332Z" fill="currentColor"/>
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
      transition: none; // Remove transition during drag for immediate follow
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
