import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Node } from '@tiptap/pm/model';

function findColors(doc: Node): DecorationSet {
	const hexColor = /(#[0-9a-f]{3,8})\b/gi;
	const decorations: Decoration[] = [];

	doc.descendants((node, position) => {
		if (!node.isText) {
			return;
		}

		const text = node.text || '';
		let match;
		while ((match = hexColor.exec(text)) !== null) {
			const color = match[0];
			
			// Hex color usually is 3, 4, 6 or 8 chars (excluding #).
			if (![4, 5, 7, 9].includes(color.length)) {
				continue;
			}

			const from = position + match.index;
			const to = from + color.length;

			const decoration = Decoration.inline(from, to, {
				class: 'color-highlight',
				style: `--color: ${color};`,
			});

			decorations.push(decoration);
		}
	});

	return DecorationSet.create(doc, decorations);
}

export const ColorHighlighter = Extension.create({
	name: 'colorHighlighter',

	addProseMirrorPlugins() {
		return [
			new Plugin({
				key: new PluginKey('colorHighlighter'),
				state: {
					init(_, { doc }) {
						return findColors(doc);
					},
					apply(transaction, oldState) {
						return transaction.docChanged ? findColors(transaction.doc) : oldState;
					},
				},
				props: {
					decorations(state) {
						return this.getState(state);
					},
				},
			}),
		];
	},
});
