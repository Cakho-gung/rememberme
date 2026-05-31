import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import tippy from 'tippy.js';
import { mount, unmount } from 'svelte';
import EmojiMenu from './EmojiMenu.svelte';

const EMOJI_LIST = [
	{ name: 'anguished', emoji: '😧' },
	{ name: 'astonished', emoji: '😲' },
	{ name: 'blush', emoji: '😊' },
	{ name: 'cold_face', emoji: '🥶' },
	{ name: 'cold_sweat', emoji: '😰' },
	{ name: 'confounded', emoji: '😖' },
	{ name: 'confused', emoji: '😕' },
	{ name: 'cowboy_hat_face', emoji: '🤠' },
	{ name: 'smile', emoji: '😄' },
	{ name: 'laughing', emoji: '😆' },
	{ name: 'wink', emoji: '😉' },
	{ name: 'heart', emoji: '❤️' },
	{ name: 'thumbsup', emoji: '👍' },
	{ name: 'thumbsdown', emoji: '👎' },
	{ name: 'fire', emoji: '🔥' },
	{ name: 'rocket', emoji: '🚀' },
	{ name: 'thinking', emoji: '🤔' },
	{ name: 'sob', emoji: '😭' },
	{ name: 'joy', emoji: '😂' },
	{ name: 'sweat_smile', emoji: '😅' },
	{ name: 'sunglasses', emoji: '😎' },
	{ name: 'star', emoji: '⭐' },
	{ name: 'check', emoji: '✅' },
	{ name: 'cross', emoji: '❌' },
	{ name: 'party', emoji: '🎉' },
	{ name: 'eyes', emoji: '👀' },
	{ name: 'sparkles', emoji: '✨' },
];

export const EmojiExtension = Extension.create({
	name: 'emojiSuggestion',

	addOptions() {
		return {
			suggestion: {
				char: ':',
				items: ({ query }: { query: string }) => {
					return EMOJI_LIST
						.filter(item => item.name.toLowerCase().includes(query.toLowerCase()))
						.slice(0, 10);
				},

				render: () => {
					let componentWrapper: HTMLDivElement;
					let svelteComponent: any;
					let popup: any;
					let selectedIndex = 0;
					let currentItems: any[] = [];
					let currentProps: any;

					const renderComponent = () => {
						if (!svelteComponent) {
							svelteComponent = mount(EmojiMenu, {
								target: componentWrapper,
								props: {
									items: currentItems,
									selectedIndex: selectedIndex,
									command: (item: any) => {
										currentProps.editor.chain().focus().deleteRange(currentProps.range).insertContent(item.emoji).run();
									},
									setSelectedIndex: (index: number) => {
										// Hover handling
									}
								}
							});
						} else {
							unmount(svelteComponent);
							svelteComponent = mount(EmojiMenu, {
								target: componentWrapper,
								props: {
									items: currentItems,
									selectedIndex: selectedIndex,
									command: (item: any) => {
										currentProps.editor.chain().focus().deleteRange(currentProps.range).insertContent(item.emoji).run();
									},
									setSelectedIndex: (index: number) => {
									}
								}
							});
						}
					};

					return {
						onStart: (props: any) => {
							currentProps = props;
							currentItems = props.items;
							selectedIndex = 0;
							componentWrapper = document.createElement('div');
							
							renderComponent();

							popup = tippy('body', {
								getReferenceClientRect: props.clientRect,
								appendTo: () => document.body,
								content: componentWrapper,
								showOnCreate: true,
								interactive: true,
								trigger: 'manual',
								placement: 'bottom-start',
								animation: 'fade',
								theme: 'light',
							});
						},

						onUpdate(props: any) {
							currentProps = props;
							currentItems = props.items;
							selectedIndex = 0;
							renderComponent();
							popup[0]?.setProps({
								getReferenceClientRect: props.clientRect,
							});
						},

						onKeyDown(props: any) {
							if (props.event.key === 'ArrowUp') {
								props.event.preventDefault();
								selectedIndex = (selectedIndex + currentItems.length - 1) % currentItems.length;
								renderComponent();
								return true;
							}

							if (props.event.key === 'ArrowDown') {
								props.event.preventDefault();
								selectedIndex = (selectedIndex + 1) % currentItems.length;
								renderComponent();
								return true;
							}

							if (props.event.key === 'Enter') {
								if (currentItems.length > 0) {
									props.event.preventDefault();
									const item = currentItems[selectedIndex];
									currentProps.editor.chain().focus().deleteRange(currentProps.range).insertContent(item.emoji).run();
									return true;
								}
								return false;
							}

							if (props.event.key === 'Escape') {
								props.event.preventDefault();
								popup[0]?.hide();
								return true;
							}

							return false;
						},

						onExit() {
							popup[0]?.destroy();
							if (svelteComponent) {
								unmount(svelteComponent);
							}
							componentWrapper.remove();
						},
					};
				},
			},
		};
	},

	addProseMirrorPlugins() {
		return [
			Suggestion({
				editor: this.editor,
				pluginKey: new PluginKey('emojiSuggestionKey'),
				...this.options.suggestion,
			}),
		];
	},
});
