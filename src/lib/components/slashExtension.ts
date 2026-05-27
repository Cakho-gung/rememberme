import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import tippy from 'tippy.js';
import { mount, unmount } from 'svelte';
import SlashMenu from './SlashMenu.svelte';

export const SlashCommands = Extension.create({
	name: 'slashCommands',

	addOptions() {
		return {
			suggestion: {
				char: '/',
				items: ({ query }: { query: string }) => {
					return [
						{
							title: 'Heading 1',
							command: ({ editor, range }: any) => {
								editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run();
							},
						},
						{
							title: 'Heading 2',
							command: ({ editor, range }: any) => {
								editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run();
							},
						},
						{
							title: 'Bullet List',
							command: ({ editor, range }: any) => {
								editor.chain().focus().deleteRange(range).toggleBulletList().run();
							},
						},
						{
							title: 'Code Block',
							command: ({ editor, range }: any) => {
								editor.chain().focus().deleteRange(range).toggleCodeBlock().run();
							},
						}
					]
						.filter(item => item.title.toLowerCase().startsWith(query.toLowerCase()))
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
						if (svelteComponent) {
							unmount(svelteComponent);
						}
						svelteComponent = mount(SlashMenu, {
							target: componentWrapper,
							props: {
								items: currentItems,
								selectedIndex: selectedIndex,
								command: (item: any) => {
									// Execute command directly bypassing suggestion layer focus issues
									item.command({ editor: currentProps.editor, range: currentProps.range });
								},
								setSelectedIndex: (index: number) => {
									selectedIndex = index;
									renderComponent();
								}
							}
						});
					};

					return {
						onStart: (props: any) => {
							currentProps = props;
							currentItems = props.items;
							selectedIndex = 0;
							componentWrapper = document.createElement('div');
							
							renderComponent();

							// Sử dụng tippy.js để mount Component nổi lên tại tọa độ con trỏ (clientRect)
							popup = tippy('body', {
								getReferenceClientRect: props.clientRect,
								appendTo: () => document.body,
								content: componentWrapper,
								showOnCreate: true,
								interactive: true,
								trigger: 'manual',
								placement: 'bottom-start',
								animation: 'fade',
								theme: 'light', // Tippy default light or you can customize
							});
						},

						onUpdate(props: any) {
							currentProps = props;
							currentItems = props.items;
							selectedIndex = 0;
							renderComponent();
							popup[0].setProps({
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
								props.event.preventDefault();
								if (currentItems.length > 0) {
									const item = currentItems[selectedIndex];
									item.command({ editor: currentProps.editor, range: currentProps.range });
								}
								return true;
							}

							if (props.event.key === 'Escape') {
								props.event.preventDefault();
								popup[0].hide();
								return true;
							}

							return false;
						},

						onExit() {
							popup[0].destroy();
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
				...this.options.suggestion,
			}),
		];
	},
});
