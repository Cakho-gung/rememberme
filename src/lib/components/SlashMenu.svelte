<script lang="ts">
	interface Props {
		items: any[];
		selectedIndex: number;
		command: (item: any) => void;
		setSelectedIndex: (index: number) => void;
	}
	let { items, selectedIndex, command, setSelectedIndex }: Props = $props();

	function selectItem(e: MouseEvent, item: any) {
		// Trong Svelte 5, ta gọi trực tiếp e.preventDefault() thay vì on:mousedown|preventDefault
		e.preventDefault();
		command(item);
	}

	let menuRef = $state<HTMLDivElement | null>(null);

	$effect(() => {
		if (selectedIndex >= 0 && menuRef) {
			const activeBtn = menuRef.querySelector('.is-active');
			if (activeBtn) {
				activeBtn.scrollIntoView({ block: 'nearest' });
			}
		}
	});
</script>

<div class="slash-menu" bind:this={menuRef}>
	<ul>
		{#if items.length > 0}
			{#each items as item, index}
				<li>
					<button 
						class:is-active={index === selectedIndex}
						onmousedown={(e) => selectItem(e, item)}
						onmouseenter={() => setSelectedIndex(index)}
					>
						{item.title}
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
	.slash-menu {
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
	.slash-menu::-webkit-scrollbar {
		width: 6px;
	}
	.slash-menu::-webkit-scrollbar-track {
		background: transparent;
	}
	.slash-menu::-webkit-scrollbar-thumb {
		background: rgba(128, 128, 128, 0.25);
		border-radius: 4px;
	}
	.slash-menu::-webkit-scrollbar-thumb:hover {
		background: rgba(128, 128, 128, 0.4);
	}

	.slash-menu button {
		display: block;
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
	}
	.slash-menu button:hover, .slash-menu button.is-active {
		background: rgba(128, 128, 128, 0.15);
	}
	.slash-menu button.empty-btn {
		cursor: default;
		color: var(--color-text, #999);
        opacity: 0.5;
	}
	.slash-menu button.empty-btn:hover {
		background: transparent;
	}
</style>
