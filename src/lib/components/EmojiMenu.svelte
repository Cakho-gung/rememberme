<script lang="ts">
	interface EmojiItem {
		name: string;
		emoji: string;
		fallbackImage?: string;
	}

	interface Props {
		items: EmojiItem[];
		selectedIndex: number;
		command: (item: EmojiItem) => void;
		setSelectedIndex: (index: number) => void;
	}
	let { items, selectedIndex, command, setSelectedIndex }: Props = $props();

	function selectItem(e: MouseEvent, item: EmojiItem) {
		e.preventDefault();
		command(item);
	}

	let menuRef = $state<HTMLDivElement | null>(null);

	$effect(() => {
		if (selectedIndex >= 0 && menuRef) {
			// Find the active button and scroll it into view
			const activeBtn = menuRef.querySelector('.is-active');
			if (activeBtn) {
				activeBtn.scrollIntoView({ block: 'nearest' });
			}
		}
	});
</script>

<div class="emoji-menu" bind:this={menuRef}>
	<ul>
		{#if items.length > 0}
			{#each items as item, index}
				<li>
					<button 
						class:is-active={index === selectedIndex}
						onmousedown={(e) => selectItem(e, item)}
						onmouseenter={() => setSelectedIndex(index)}
					>
						{#if item.fallbackImage}
							<img src={item.fallbackImage} class="emoji-img" alt={item.name} />
						{:else}
							<span class="emoji">{item.emoji}</span>
						{/if}
						<span class="name">:{item.name}:</span>
					</button>
				</li>
			{/each}
		{:else}
			<li>
				<button disabled class="empty-btn">No results</button>
			</li>
		{/if}
	</ul>
</div>

<style>
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	li {
		margin: 0;
		padding: 0;
	}
	.emoji-menu {
		display: flex;
		flex-direction: column;
		background: var(--bg-focused, #ffffff);
		border: 1px solid var(--glass-border, rgba(128, 128, 128, 0.15));
		border-radius: 8px;
		padding: 4px;
		min-width: 180px;
		max-height: 250px;
		overflow-y: auto;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
	}

	/* Tùy chỉnh thanh cuộn cho khớp với theme */
	.emoji-menu::-webkit-scrollbar {
		width: 6px;
	}
	.emoji-menu::-webkit-scrollbar-track {
		background: transparent;
	}
	.emoji-menu::-webkit-scrollbar-thumb {
		background: rgba(128, 128, 128, 0.25);
		border-radius: 4px;
	}
	.emoji-menu::-webkit-scrollbar-thumb:hover {
		background: rgba(128, 128, 128, 0.4);
	}

	.emoji-menu button {
		display: flex;
		align-items: center;
		width: 100%;
		text-align: left;
		padding: 8px 12px;
		border: none;
		background: transparent;
		border-radius: 4px;
		cursor: pointer;
		font-family: inherit;
		font-size: 14px;
		color: var(--color-text, #333);
		gap: 8px;
	}
	.emoji-menu button:hover, .emoji-menu button.is-active {
		background: rgba(128, 128, 128, 0.15);
	}
	.emoji-menu button.empty-btn {
		cursor: default;
		color: var(--color-text, #999);
        opacity: 0.5;
	}
	.emoji-menu button.empty-btn:hover {
		background: transparent;
	}
	.emoji {
		font-size: 16px;
	}
	.emoji-img {
		width: 16px;
		height: 16px;
		object-fit: contain;
	}
	.name {
		color: var(--color-text, #555);
        opacity: 0.8;
	}
</style>
