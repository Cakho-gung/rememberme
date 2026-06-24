import { Extension } from '@tiptap/core';

export const GlobalShortcuts = Extension.create({
	name: 'globalShortcuts',

	addKeyboardShortcuts() {
		return {
			'Tab': () => {
				if (this.editor.commands.sinkListItem('listItem')) return true;
				if (this.editor.commands.sinkListItem('taskItem')) return true;
				return true; // prevent default focus shift
			},
			'Shift-Tab': () => {
				if (this.editor.commands.liftListItem('listItem')) return true;
				if (this.editor.commands.liftListItem('taskItem')) return true;
				return true; // prevent default focus shift
			},
			'Backspace': ({ editor }) => {
				const { state } = editor;
				const { selection } = state;
				const { $from, empty } = selection;
				
				if (empty && $from.parentOffset === 0 && $from.depth >= 1) {
					const parentName = $from.node($from.depth - 1)?.type.name;
					const isDirectlyInListItem = parentName === 'listItem' || parentName === 'taskItem';
					const isDeeplyNestedInListItem = editor.isActive('listItem') || editor.isActive('taskItem');

					if (isDeeplyNestedInListItem && !isDirectlyInListItem) {
						if (editor.commands.joinBackward()) return true;
						if (editor.commands.selectNodeBackward()) return true;
						return true; // Prevent ListKeymap from lifting the list item
					}
				}
				return false;
			},
			// Alt+A/H/D align shortcuts are handled in +page.svelte handleWindowKeyDown
			// using e.code so they work on macOS (Option key produces special chars like å, ˙, ∂)
		};
	},
});
