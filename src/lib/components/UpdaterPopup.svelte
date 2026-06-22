<script lang="ts">
  import { updateState, downloadAndInstallUpdate, dismissUpdate } from '$lib/updater';
  import { fade, scale } from 'svelte/transition';
  
  let state = $state({
    available: false,
    version: '',
    body: '',
    error: '',
    downloading: false,
    progress: 0,
    contentLength: 0
  });

  updateState.subscribe(s => {
    state = s;
  });
</script>

{#if state.available}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="updater-overlay" transition:fade={{ duration: 200 }}>
    <div class="updater-dialog" transition:scale={{ duration: 250, start: 0.9 }}>
      <h3>Update Available</h3>
      <p class="version-text">Version {state.version} is ready to install.</p>
      
      {#if state.body}
        <div class="release-notes">
          {@html state.body}
        </div>
      {/if}

      {#if state.error}
        <p class="error-text">{state.error}</p>
      {/if}

      {#if state.downloading}
        <div class="progress-container">
          <div class="progress-bar" style="width: {state.contentLength ? (state.progress / state.contentLength) * 100 : 0}%"></div>
        </div>
        <p class="progress-text">Downloading... {Math.round(state.contentLength ? (state.progress / state.contentLength) * 100 : 0)}%</p>
      {:else}
        <div class="actions">
          <button class="btn-cancel" onclick={dismissUpdate}>Later</button>
          <button class="btn-install" onclick={downloadAndInstallUpdate}>Install & Restart</button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style lang="scss">
  .updater-overlay {
    position: absolute;
    inset: 0;
    top: 50px; /* offset by 50px so it doesn't cover the title bar / header */
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    z-index: 9999;
    padding: 1rem;
    pointer-events: auto;
  }

  // macOS WKWebView: no blur — use higher opacity to maintain overlay effect
  :global([data-os="macos"]) .updater-overlay {
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    background: rgba(0, 0, 0, 0.65);
  }

  .updater-dialog {
    background: var(--bg-focused, #1e1e1e);
    color: var(--color-text, #ffffff);
    border-radius: 12px;
    padding: 24px;
    width: 100%;
    max-width: 400px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(128, 128, 128, 0.2);
    pointer-events: auto;
  }

  h3 {
    margin: 0 0 8px 0;
    font-size: 1.25rem;
    font-weight: 600;
  }

  .version-text {
    margin: 0 0 16px 0;
    font-size: 0.9rem;
    opacity: 0.8;
  }

  .release-notes {
    background: rgba(128, 128, 128, 0.05);
    padding: 12px;
    border-radius: 8px;
    font-size: 0.85rem;
    max-height: 120px;
    overflow-y: auto;
    margin-bottom: 20px;
    
    :global(p) { margin: 0 0 8px 0; }
    :global(p:last-child) { margin: 0; }
  }

  .error-text {
    color: #ef4444;
    font-size: 0.85rem;
    margin-bottom: 16px;
  }

  .progress-container {
    height: 8px;
    background: rgba(128, 128, 128, 0.2);
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 8px;
  }

  .progress-bar {
    height: 100%;
    background: var(--color-accent, #38AA57);
    transition: width 0.2s ease-out;
  }

  .progress-text {
    text-align: center;
    font-size: 0.85rem;
    opacity: 0.8;
    margin: 0;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
  }

  button {
    border: none;
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 0.9rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .btn-cancel {
    background: transparent;
    color: var(--color-text);
    opacity: 0.7;
    
    &:hover {
      opacity: 1;
      background: rgba(128, 128, 128, 0.1);
    }
  }

  .btn-install {
    background: var(--color-accent, #38AA57);
    color: var(--color-accent-text, #ffffff);
    
    &:hover {
      filter: brightness(1.1);
    }
  }
</style>
