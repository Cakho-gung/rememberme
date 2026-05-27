<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Editor } from '@tiptap/core';
	import StarterKit from '@tiptap/starter-kit';
	import Placeholder from '@tiptap/extension-placeholder';
	import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
	import { common, createLowlight } from 'lowlight';
	
	import TaskList from '@tiptap/extension-task-list';
	import TaskItem from '@tiptap/extension-task-item';
	import Link from '@tiptap/extension-link';
	import Typography from '@tiptap/extension-typography';
	import BubbleMenuExtension from '@tiptap/extension-bubble-menu';
	import { TextStyle } from '@tiptap/extension-text-style';
	import { Color } from '@tiptap/extension-color';
	import { MathExtension } from '@aarkue/tiptap-math-extension';
	import { fade } from 'svelte/transition';
	
	import { SlashCommands } from './slashExtension';
	import { MentionExtension } from './mentionExtension';
	import { CustomCodeBlock } from './CustomCodeBlock';
	import { SmartSelectAll } from './SmartSelectAll';

	interface Props {
		noteId: number;
		content: object | null;
		onUpdate?: (content: object) => void;
	}

	let { noteId, content, onUpdate }: Props = $props();

	let element = $state<HTMLElement>();
	let bubbleMenuElement = $state<HTMLElement>();
	let editor = $state<Editor>();
	let currentNoteId = $state(noteId);
	let updateTimeout: ReturnType<typeof setTimeout>;

	let isLinkModalOpen = false; // Bỏ
	let showLinkInput = $state(false);
	let linkUrl = $state('');
	let originalLinkUrl = $state('');
	let linkInputEl = $state<HTMLInputElement>();

	const lowlight = createLowlight(common);

	onMount(() => {
		editor = new Editor({
			element: element!,
			editorProps: {
				attributes: {
					spellcheck: 'false',
				},
			},
			extensions: [
				// Cấu hình StarterKit: Tắt codeBlock mặc định vì đã dùng lowlight
				StarterKit.configure({
					codeBlock: false,
				}),
				Placeholder.configure({
					placeholder: "Type '/' for commands...",
					emptyEditorClass: 'is-editor-empty'
				}),
				CustomCodeBlock.configure({
					lowlight,
				}),
				SmartSelectAll,
				MathExtension.configure({ evaluation: false }),
				TaskList,
				TaskItem.configure({
					nested: true, // Hỗ trợ Enter ở cuối sẽ tạo task mới
				}),
				Link.configure({
					autolink: true,
					openOnClick: false, // Ngăn bấm nhầm lúc edit
				}),
				TextStyle,
				Color,
				Typography, // Tự động format ký tự đặc biệt như (c) => ©, -- => —
				SlashCommands,
				MentionExtension,
				BubbleMenuExtension.configure({
					element: bubbleMenuElement!,
					shouldShow: ({ editor, view, state, from, to }) => {
						if (showLinkInput) return true;
						
						const { doc, selection } = state;
						const { empty } = selection;
						if (empty || !view.hasFocus()) {
							return false;
						}
						return true;
					}
				})
			],
			content: content,
			onUpdate: ({ editor }) => {
				// Tối ưu Performance bằng Debounce (300ms)
				clearTimeout(updateTimeout);
				updateTimeout = setTimeout(() => {
					if (onUpdate) {
						onUpdate(editor.getJSON());
					}
				}, 300);
			}
		});
	});

	onDestroy(() => {
		if (editor) {
			editor.destroy();
		}
		clearTimeout(updateTimeout);
	});

	$effect(() => {
		if (editor && noteId !== currentNoteId) {
			currentNoteId = noteId;
			editor.commands.setContent(content);
		}
	});

	function setLink() {
		if (!editor) return;
		
		originalLinkUrl = editor.getAttributes('link').href || '';
		linkUrl = originalLinkUrl;
		showLinkInput = true;
		
		// Biến text thành link tạm thời để user nhìn thấy được highlight
		if (!editor.isActive('link')) {
			editor.chain().extendMarkRange('link').setLink({ href: '' }).run();
		}
		
		setTimeout(() => linkInputEl?.focus(), 50);
	}

	function confirmLink() {
		if (!editor) return;
		showLinkInput = false;
		
		if (linkUrl === '') {
			editor.chain().focus().extendMarkRange('link').unsetLink().run();
			return;
		}

		editor.chain().focus().extendMarkRange('link').setLink({ href: linkUrl }).run();
	}
	
	function cancelLink() {
		if (!editor) return;
		showLinkInput = false;
		
		// Khôi phục lại trạng thái ban đầu
		if (originalLinkUrl === '') {
			editor.chain().focus().extendMarkRange('link').unsetLink().run();
		} else {
			editor.chain().focus().extendMarkRange('link').setLink({ href: originalLinkUrl }).run();
		}
	}
</script>

<div class="text-editor-container">
	<!-- Text Editor Main Area -->
	<div class="text-editor" bind:this={element}></div>
	
</div>

<!-- Tiptap Bubble Menu Template -->
<div style="display: none;">
	<div bind:this={bubbleMenuElement} class="bubble-menu">
		{#if editor}
			<input 
				bind:this={linkInputEl}
				style="display: {showLinkInput ? 'block' : 'none'};"
				type="url"
				class="minimal-link-input"
				placeholder="Paste URL & Enter..."
				bind:value={linkUrl}
				onkeydown={(e) => {
					if (e.key === 'Enter') confirmLink();
					if (e.key === 'Escape') cancelLink();
				}}
				onblur={cancelLink}
			/>
			<div class="bubble-buttons" style="display: {showLinkInput ? 'none' : 'flex'}; gap: 4px;">
				<button 
					class="bubble-btn" 
					class:is-active={editor?.isActive('bold')}
					onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().toggleBold().run() }}
				>
					B
				</button>
				<button 
					class="bubble-btn" 
					class:is-active={editor?.isActive('italic')}
					onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().toggleItalic().run() }}
				>
					I
				</button>
				<button 
					class="bubble-btn" 
					class:is-active={editor?.isActive('link')}
					onmousedown={(e) => { e.preventDefault(); setLink() }}
				>
					🔗
				</button>
				<div class="bubble-divider"></div>
				<button 
					class="bubble-btn color-btn" 
					class:is-active={editor?.isActive('textStyle', { color: '#ff08f3' })}
					onmousedown={(e) => { 
						e.preventDefault(); 
						if (editor?.isActive('textStyle', { color: '#ff08f3' })) {
							editor?.chain().focus().unsetColor().run();
						} else {
							editor?.chain().focus().setColor('#ff08f3').run();
						}
					}}
					title="Highlight Accent Color"
				>
					<span class="color-dot"></span>
				</button>
			</div>
		{/if}
	</div>
</div>

<style lang="scss">
	/* Bố cục Container */
	.minimal-link-input {
		background: transparent;
		border: none;
		color: #333;
		font-family: inherit;
		font-size: 0.9em;
		padding: 4px 8px;
		width: 180px;
		outline: none;

		&::placeholder {
			color: rgba(0, 0, 0, 0.4);
		}
	}

	/* Bố cục Container */
	.text-editor-container {
		width: 100%;
		position: relative;
		display: flex;
		flex-direction: column;
		flex: 1 1 auto;
	}

	.text-editor {
		width: 100%;
		cursor: text;
		flex: 1 1 auto;
		display: flex;
		flex-direction: column;
	}

	/* UI BUBBLE MENU: Glassmorphism nhỏ gọn */
	.bubble-menu {
		display: flex;
		align-items: center;
		width: fit-content;
		gap: 4px;
		padding: 4px;
		background: rgba(255, 255, 255, 0.85); /* Tăng độ đục để dễ đọc text hơn */
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border-radius: 8px;
		border: 1px solid rgba(0, 0, 0, 0.08);
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15); /* Tăng bóng đổ để popup nổi bật hơn */
		transition: opacity 0.2s ease;
		
		&.hidden {
			opacity: 0;
			pointer-events: none;
		}
	}

	.bubble-btn {
		background: transparent;
		border: none;
		border-radius: 6px;
		width: 28px;
		height: 28px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-family: inherit;
		font-size: 14px;
		font-weight: 600;
		color: #444;
		cursor: pointer;
		transition: all 0.15s ease;

		&:hover {
			background: rgba(0, 0, 0, 0.05);
			color: #111;
		}

		&.is-active {
			background: rgba(0, 0, 0, 0.1);
			color: #000;
		}
	}

	.bubble-divider {
		width: 1px;
		height: 16px;
		background: rgba(0, 0, 0, 0.1);
		margin: 0 4px;
	}

	.color-btn {
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.color-dot {
		display: inline-block;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background-color: #ff08f3; /* Khớp với $theme-primary */
		box-shadow: 0 1px 3px rgba(255, 8, 243, 0.4);
		transition: transform 0.2s ease;
	}

	.bubble-btn:hover .color-dot {
		transform: scale(1.15);
	}
</style>
