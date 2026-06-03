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
			'Alt-a': () => {
				if (this.editor.isActive('image')) {
					return this.editor.chain().focus().updateAttributes('image', { float: 'left' }).run();
				}
				return this.editor.chain().focus().setTextAlign('left').run();
			},
			'Alt-h': () => {
				if (this.editor.isActive('image')) {
					return this.editor.chain().focus().updateAttributes('image', { float: 'none' }).run();
				}
				return this.editor.chain().focus().setTextAlign('center').run();
			},
			'Alt-d': () => {
				if (this.editor.isActive('image')) {
					return this.editor.chain().focus().updateAttributes('image', { float: 'right' }).run();
				}
				return this.editor.chain().focus().setTextAlign('right').run();
			},
		};
	},
});
