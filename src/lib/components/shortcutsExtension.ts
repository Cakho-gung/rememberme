import { Extension } from '@tiptap/core';

export const GlobalShortcuts = Extension.create({
	name: 'globalShortcuts',

	addKeyboardShortcuts() {
		return {
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
