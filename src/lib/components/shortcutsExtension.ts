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
			// Alt+A/H/D align shortcuts are handled in +page.svelte handleWindowKeyDown
			// using e.code so they work on macOS (Option key produces special chars like å, ˙, ∂)
		};
	},
});
