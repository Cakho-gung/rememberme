import { mergeAttributes, wrappingInputRule } from '@tiptap/core';
import OrderedList from '@tiptap/extension-ordered-list';

export const orderedListInputRegex = /^\s*(\d+)[.)]\s$/;

export const CustomOrderedList = OrderedList.extend({
	addAttributes() {
		return {
			...this.parent?.(),
			start: {
				default: 1,
				parseHTML: (element) => {
					return element.hasAttribute('start') ? parseInt(element.getAttribute('start') || '', 10) : 1;
				},
				renderHTML: (attributes) => {
					const startVal = attributes.start ? parseInt(attributes.start, 10) || 1 : 1;
					return {
						start: startVal,
						style: `--ol-start: ${startVal};`
					};
				}
			}
		};
	},

	renderHTML({ HTMLAttributes }) {
		return ['ol', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
	},

	addInputRules() {
		return [
			wrappingInputRule({
				find: orderedListInputRegex,
				type: this.type,
				getAttributes: (match) => ({ start: parseInt(match[1], 10) }),
				joinPredicate: (match, node) => node.childCount + node.attrs.start === parseInt(match[1], 10)
			})
		];
	}
});
