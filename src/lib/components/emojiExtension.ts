import { Emoji, gitHubEmojis } from '@tiptap/extension-emoji';
import tippy from 'tippy.js';
import { mount, unmount } from 'svelte';
import EmojiMenu from './EmojiMenu.svelte';

export const EmojiExtension = Emoji.configure({
	enableEmoticons: true,
	suggestion: {
		items: ({ editor, query }: any) => {
			return gitHubEmojis
				.filter((item: any) => item.name.toLowerCase().startsWith(query.toLowerCase()) || item.shortcodes.some((sc: string) => sc.startsWith(query.toLowerCase())))
				.slice(0, 30);
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
							items: currentItems.map(item => ({
								name: item.name,
								emoji: item.emoji,
								fallbackImage: item.fallbackImage,
							})),
							selectedIndex: selectedIndex,
							command: (item: any) => {
								currentProps.command({ name: item.name });
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
							items: currentItems.map(item => ({
								name: item.name,
								emoji: item.emoji,
								fallbackImage: item.fallbackImage,
							})),
							selectedIndex: selectedIndex,
							command: (item: any) => {
								currentProps.command({ name: item.name });
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
						arrow: false,
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
							currentProps.command({ name: item.name });
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
});
