<script lang="ts">
	interface Props {
		items: string[];
		selectedIndex: number;
		command: (item: any) => void;
		setSelectedIndex: (index: number) => void;
	}
	let { items, selectedIndex, command, setSelectedIndex }: Props = $props();

	function selectItem(e: MouseEvent, item: string) {
		e.preventDefault();
		command({ id: item, label: item });
	}
</script>

<div class="mention-menu">
	<ul>
		{#if items.length > 0}
			{#each items as item, index}
				<li>
					<button 
						class:is-active={index === selectedIndex}
						onmousedown={(e) => selectItem(e, item)}
						onmouseenter={() => setSelectedIndex(index)}
					>
						@{item}
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
	.mention-menu {
		display: flex;
		flex-direction: column;
		background: rgba(255, 255, 255, 0.8);
		backdrop-filter: blur(12px);
		border-radius: 8px;
		padding: 4px;
		box-shadow: 0 4px 12px rgba(0,0,0,0.1);
		min-width: 150px;
	}
	.mention-menu button {
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
		color: #333;
	}
	.mention-menu button:hover, .mention-menu button.is-active {
		background: rgba(0, 0, 0, 0.05);
	}
	.mention-menu button.empty-btn {
		cursor: default;
		color: #999;
	}
	.mention-menu button.empty-btn:hover {
		background: transparent;
	}
</style>
