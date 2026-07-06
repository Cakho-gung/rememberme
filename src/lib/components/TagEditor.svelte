<script lang="ts">
  import { TAG_PALETTE, normalizeTag, getTagColor } from '$lib/tags';

  interface Props {
    /** Tags của note đang mở */
    tags: string[];
    /** Mọi tag đang tồn tại (để autocomplete) */
    allTags: string[];
    colorOverrides: Record<string, string>;
    onAdd: (name: string) => void;
    onRemove: (name: string) => void;
    onColorChange: (name: string, color: string) => void;
    onClose: () => void;
  }

  let { tags, allTags, colorOverrides, onAdd, onRemove, onColorChange, onClose }: Props =
    $props();

  let inputValue = $state('');
  /** Tag đang mở bảng chọn màu (null = đóng) */
  let colorPickerTag = $state<string | null>(null);
  let rootEl = $state<HTMLElement>();

  let suggestions = $derived(
    allTags.filter(
      (t) =>
        !tags.includes(t) &&
        (inputValue.trim() === '' || t.includes(normalizeTag(inputValue))),
    ).slice(0, 6),
  );

  function submitInput() {
    const name = normalizeTag(inputValue);
    if (!name) return;
    if (!tags.includes(name)) onAdd(name);
    inputValue = '';
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitInput();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
  }

  function handleWindowPointerDown(e: PointerEvent) {
    // Click ra ngoài popover (và ngoài cụm chấm mở nó) → đóng
    const target = e.target as HTMLElement;
    if (rootEl && !rootEl.contains(target) && !target.closest('.tag-dots-cluster')) {
      onClose();
    }
  }

  function focus(node: HTMLElement) {
    node.focus();
  }
</script>

<svelte:window onpointerdown={handleWindowPointerDown} />

<div class="tag-popover" bind:this={rootEl}>
  {#if tags.length > 0}
    <div class="tag-rows">
      {#each tags as tag (tag)}
        <div class="tag-row">
          <button
            class="tag-color-dot"
            style="background-color: {getTagColor(tag, colorOverrides)}"
            aria-label="Change color of {tag}"
            onclick={() => (colorPickerTag = colorPickerTag === tag ? null : tag)}
          ></button>
          <span class="tag-name">{tag}</span>
          <button class="tag-remove" aria-label="Remove {tag}" onclick={() => onRemove(tag)}>
            ×
          </button>
        </div>
        {#if colorPickerTag === tag}
          <div class="tag-palette">
            {#each TAG_PALETTE as color (color)}
              <button
                class="palette-swatch"
                class:selected={getTagColor(tag, colorOverrides) === color}
                style="background-color: {color}"
                aria-label="Set color {color}"
                onclick={() => {
                  onColorChange(tag, color);
                  colorPickerTag = null;
                }}
              ></button>
            {/each}
          </div>
        {/if}
      {/each}
    </div>
  {/if}

  <input
    class="tag-input"
    type="text"
    placeholder={tags.length === 0 ? 'Add a tag...' : 'Add another...'}
    bind:value={inputValue}
    onkeydown={handleKeyDown}
    use:focus
    spellcheck="false"
  />

  {#if suggestions.length > 0}
    <div class="tag-suggestions">
      {#each suggestions as sug (sug)}
        <button class="suggestion-chip" onclick={() => onAdd(sug)}>
          <span
            class="suggestion-dot"
            style="background-color: {getTagColor(sug, colorOverrides)}"
          ></span>
          {sug}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style lang="scss">
  .tag-popover {
    position: absolute;
    top: calc(100% + 6px);
    right: 28px;
    width: 200px;
    background: var(--bg-focused);
    border: 1px solid var(--dropdown-divider-bg);
    border-radius: 10px;
    box-shadow: var(--glass-shadow);
    padding: 8px;
    z-index: 100;
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-family: 'IBM Plex Mono', monospace;
  }

  .tag-rows {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .tag-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    border-radius: 6px;

    &:hover {
      background: var(--dropdown-item-hover);
    }
  }

  .tag-color-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: none;
    padding: 0;
    cursor: pointer;
    flex-shrink: 0;
    transition: transform 0.15s ease;

    &:hover {
      transform: scale(1.25);
    }
  }

  .tag-name {
    flex: 1 1 0;
    min-width: 0;
    font-size: 11px;
    color: var(--color-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tag-remove {
    background: transparent;
    border: none;
    padding: 0 2px;
    font-size: 13px;
    line-height: 1;
    color: var(--color-text-muted);
    cursor: pointer;
    opacity: 0.6;

    &:hover {
      opacity: 1;
    }
  }

  .tag-palette {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    padding: 4px 6px 6px 26px;
  }

  .palette-swatch {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid transparent;
    padding: 0;
    cursor: pointer;
    transition: transform 0.15s ease;

    &:hover {
      transform: scale(1.2);
    }

    &.selected {
      border-color: var(--color-text);
    }
  }

  .tag-input {
    font-family: inherit;
    font-size: 11px;
    color: var(--color-text);
    background: transparent;
    border: none;
    border-bottom: 1px dashed var(--dropdown-divider-bg);
    outline: none;
    padding: 4px 6px;

    &::placeholder {
      color: var(--color-text-muted);
      opacity: 0.5;
    }

    &:focus {
      border-bottom-style: solid;
    }
  }

  .tag-suggestions {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .suggestion-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-family: inherit;
    font-size: 10px;
    color: var(--color-text-muted);
    background: var(--dropdown-item-hover);
    border: none;
    border-radius: 99px;
    padding: 3px 8px;
    cursor: pointer;

    &:hover {
      color: var(--color-text);
    }
  }

  .suggestion-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
</style>
