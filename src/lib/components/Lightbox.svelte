<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { fade } from 'svelte/transition';

  let isOpen = $state(false);
  let imageSrc = $state('');
  
  // Transform states
  let scale = $state(1);
  let translateX = $state(0);
  let translateY = $state(0);
  
  // Drag states
  let isDragging = $state(false);
  let startX = 0;
  let startY = 0;

  function handleOpen(e: Event) {
    const customEvent = e as CustomEvent<string>;
    imageSrc = customEvent.detail;
    isOpen = true;
    resetTransform();
  }

  function close() {
    isOpen = false;
    imageSrc = '';
    resetTransform();
  }

  function resetTransform() {
    scale = 1;
    translateX = 0;
    translateY = 0;
  }

  function handleWheel(e: WheelEvent) {
    // Only zoom if the mouse is inside the lightbox
    if (!isOpen) return;
    
    e.preventDefault();
    const zoomIntensity = 0.1;
    
    if (e.deltaY < 0) {
      scale = Math.min(scale + zoomIntensity, 5); // Max zoom 5x
    } else {
      scale = Math.max(scale - zoomIntensity, 0.5); // Min zoom 0.5x
    }
  }

  function handleMouseDown(e: MouseEvent) {
    // Only left click
    if (e.button !== 0) return;
    isDragging = true;
    startX = e.clientX - translateX;
    startY = e.clientY - translateY;
  }

  function handleMouseMove(e: MouseEvent) {
    if (!isDragging) return;
    translateX = e.clientX - startX;
    translateY = e.clientY - startY;
  }

  function handleMouseUp() {
    isDragging = false;
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape' && isOpen) {
      close();
    }
  }

  onMount(() => {
    window.addEventListener('open-lightbox', handleOpen);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('mousemove', handleMouseMove);
  });

  onDestroy(() => {
    window.removeEventListener('open-lightbox', handleOpen);
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('mouseup', handleMouseUp);
    window.removeEventListener('mousemove', handleMouseMove);
  });
</script>

{#if isOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="lightbox-overlay" transition:fade={{ duration: 200 }} onclick={close} onwheel={handleWheel}>
    
    <!-- Close button -->
    <button class="close-btn" onclick={(e) => { e.stopPropagation(); close(); }} title="Close">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </button>
    
    <div 
      class="image-container"
      onclick={(e) => e.stopPropagation()}
      onmousedown={handleMouseDown}
      style="transform: translate({translateX}px, {translateY}px) scale({scale}); cursor: {isDragging ? 'grabbing' : 'grab'}; transition: {isDragging ? 'none' : 'transform 0.1s ease-out'};"
    >
      <img src={imageSrc} alt="Magnified view" draggable="false" />
    </div>
    
    <!-- Controls hint -->
    <div class="hint">Scroll to zoom • Drag to pan</div>
  </div>
{/if}

<style lang="scss">
  .lightbox-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.95);
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .close-btn {
    position: absolute;
    top: 24px;
    right: 24px;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.1);
    border: none;
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 10000;
    transition: all 0.2s ease;

    &:hover {
      background: rgba(255, 255, 255, 0.25);
      transform: scale(1.1);
    }
  }

  .image-container {
    display: flex;
    align-items: center;
    justify-content: center;
    user-select: none;
    
    img {
      max-width: 90vw;
      max-height: 90vh;
      object-fit: contain;
      border-radius: 8px;
      pointer-events: none; /* Let container handle drag */
    }
  }

  .hint {
    position: absolute;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(255, 255, 255, 0.15);
    color: white;
    padding: 6px 16px;
    border-radius: 20px;
    font-size: 14px;
    pointer-events: none;
  }
</style>
