<script lang="ts">
  import { fly } from 'svelte/transition';
  import { toastState, hideToast } from '$lib/toastStore';
</script>

{#if $toastState.visible}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div 
    class="toast-zone" 
    transition:fly={{ y: -120, duration: 400 }}
    onclick={hideToast}
  >
    <div class="toast-gradient"></div>
    <div class="toast-content">
      {$toastState.message}
    </div>
  </div>
{/if}

<style lang="scss">
  @use '../../styles/variables' as *;

  .toast-zone {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 120px;
    z-index: 50;
    pointer-events: auto;
    display: flex;
    justify-content: center;
  }

  .toast-gradient {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      to bottom,
      var(--bg-focused) 0%,
      var(--bg-focused) 40%,
      transparent 100%
    );
  }

  .toast-content {
    position: relative;
    z-index: 1;
    margin-top: 16px;
    font-family: $font-family-base;
    font-size: 14px;
    font-weight: 400;
    padding-right: 16px;
    color: var(--color-text);
  }
</style>
