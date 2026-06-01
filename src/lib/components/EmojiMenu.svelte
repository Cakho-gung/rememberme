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
</script>

<div class="emoji-menu">
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
		background: #ffffff;
		border: 1px solid rgba(0, 0, 0, 0.1);
		border-radius: 8px;
		padding: 4px;
		min-width: 180px;
		max-height: 250px;
		overflow-y: auto;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
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
		color: #333;
		gap: 8px;
	}
	.emoji-menu button:hover, .emoji-menu button.is-active {
		background: rgba(0, 0, 0, 0.05);
	}
	.emoji-menu button.empty-btn {
		cursor: default;
		color: #999;
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
		color: #555;
	}
</style>
