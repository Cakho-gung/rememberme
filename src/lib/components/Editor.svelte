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
	
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import { readFile } from '@tauri-apps/plugin-fs';
	import { invoke, convertFileSrc } from '@tauri-apps/api/core';
	
	import { Table } from '@tiptap/extension-table';
	import { TableRow } from '@tiptap/extension-table-row';
	import { TableHeader } from '@tiptap/extension-table-header';
	import { TableCell } from '@tiptap/extension-table-cell';
	import Image from '@tiptap/extension-image';
	
	import { SlashCommands } from './slashExtension';
	import { MentionExtension } from './mentionExtension';
	import { CustomCodeBlock } from './CustomCodeBlock';
	import { SmartSelectAll } from './SmartSelectAll';
	import { ImagePasteExtension } from './ImagePasteExtension';
	import { ColorHighlighter } from './ColorHighlighter';

	const CustomImage = Image.extend({
		addAttributes() {
			return {
				...this.parent?.(),
				width: {
					default: '50%',
					parseHTML: element => {
						const rawWidth = element.style.width || element.getAttribute('width') || '50%';
						const match = rawWidth.match(/(\d+(?:\.\d+)?%)/);
						return match ? match[1] : '50%';
					},
					renderHTML: attributes => {
						return {
							style: `width: calc(${attributes.width} - var(--img-gap, 8px)); max-width: 100%;`
						};
					}
				},
				float: {
					default: 'none',
					parseHTML: element => element.style.float || 'none',
					renderHTML: attributes => {
						if (!attributes.float || attributes.float === 'none') {
							return {
								style: 'float: none; margin: 1em 0;'
							};
						}
						const margin = attributes.float === 'left' ? '0.5em 1.5em 0.5em 0' : '0.5em 0 0.5em 1.5em';
						return {
							style: `float: ${attributes.float}; margin: ${margin};`
						};
					}
				}
			};
		}
	});

	interface Props {
		noteId: number;
		content: object | string | null;
		onUpdate?: (content: object) => void;
	}

	let { noteId, content, onUpdate }: Props = $props();

	let element = $state<HTMLElement>();
	let bubbleMenuElement = $state<HTMLElement>();
	let editor = $state<Editor>();
	let currentNoteId = $state<number>();
	let updateTimeout: ReturnType<typeof setTimeout>;
	let unlistenDrop: (() => void) | undefined;

	let isLinkModalOpen = false; // Bỏ
	let showLinkInput = $state(false);
	let linkUrl = $state('');
	let originalLinkUrl = $state('');
	let linkInputEl = $state<HTMLInputElement>();

	let activeStates = $state({
		table: false,
		bold: false,
		italic: false,
		link: false,
		textStyle: false,
		image: false,
		imageWidth: '50%',
		imageFloat: 'none'
	});

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
				Table.configure({
					resizable: true,
				}),
				TableRow,
				TableHeader,
				TableCell,
				SmartSelectAll,
				MathExtension.configure({ evaluation: false }),
				CustomImage.configure({
					inline: false,
					allowBase64: false,
				}),
				ImagePasteExtension,
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
				ColorHighlighter,
				SlashCommands,
				MentionExtension,
				BubbleMenuExtension.configure({
					element: bubbleMenuElement!,
					options: {
						placement: 'bottom-start',
					},
					shouldShow: ({ editor, view, state, from, to }) => {
						if (showLinkInput) return true;
						
						// Show bubble menu inside table even if selection is empty
						if (editor.isActive('table')) {
							return true;
						}
						
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
			onTransaction: ({ editor }) => {
				activeStates.table = editor.isActive('table');
				activeStates.bold = editor.isActive('bold');
				activeStates.italic = editor.isActive('italic');
				activeStates.link = editor.isActive('link');
				activeStates.textStyle = editor.isActive('textStyle', { color: '#ff08f3' });
				activeStates.image = editor.isActive('image');
				if (activeStates.image) {
					const attrs = editor.getAttributes('image');
					activeStates.imageWidth = attrs.width || '50%';
					activeStates.imageFloat = attrs.float || 'none';
				}
			},
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
		currentNoteId = noteId;

		getCurrentWindow().onDragDropEvent(async (event) => {
			if (event.payload.type === 'drop') {
				const { paths, position } = event.payload;
				const editorRect = element?.getBoundingClientRect();
				
				// Kiểm tra xem vị trí thả có nằm trong editor không
				if (editor && editorRect && 
					position.x >= editorRect.left && position.x <= editorRect.right &&
					position.y >= editorRect.top && position.y <= editorRect.bottom) {
					
					// Tìm vị trí text tương ứng trong Editor
					const coordinates = editor.view.posAtCoords({ left: position.x, top: position.y });
					const pos = coordinates?.pos ?? editor.state.selection.from;
					
					for (const path of paths) {
						const extMatch = path.match(/\.(png|jpg|jpeg|gif|webp)$/i);
						if (!extMatch) continue;
						
						const ext = extMatch[1].toLowerCase();
						try {
							const fileData = await readFile(path);
							const bytes = Array.from(fileData);
							const savedPath = await invoke<string>('save_image', {
								imageData: bytes,
								ext: ext === 'jpeg' ? 'jpg' : ext,
							});
							const src = convertFileSrc(savedPath);
							
							const { schema } = editor.state;
							const node = schema.nodes.image.create({ src, title: savedPath });
							const tr = editor.state.tr.insert(pos, node);
							editor.view.dispatch(tr);
						} catch (err) {
							console.error('[Tauri Drop] Failed to save image:', err);
						}
					}
				}
			}
		}).then(unlisten => {
			unlistenDrop = unlisten;
		});
	});

	onDestroy(() => {
		if (editor) {
			editor.destroy();
		}
		clearTimeout(updateTimeout);
		if (unlistenDrop) unlistenDrop();
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
			{#if activeStates.image}
				<div class="bubble-buttons" style="display: flex; gap: 4px; align-items: center;">
					<!-- Align/Float Left -->
					<button 
						class="bubble-btn" 
						class:is-active={activeStates.imageFloat === 'left'}
						onmousedown={(e) => { 
							e.preventDefault(); 
							editor?.chain().focus().updateAttributes('image', { float: 'left' }).run();
						}}
						title="Float Left"
					>
						⬅️
					</button>
					<!-- Align/Float Center (None) -->
					<button 
						class="bubble-btn" 
						class:is-active={activeStates.imageFloat === 'none'}
						onmousedown={(e) => { 
							e.preventDefault(); 
							editor?.chain().focus().updateAttributes('image', { float: 'none' }).run();
						}}
						title="Center (No Float)"
					>
						⏹️
					</button>
					<!-- Align/Float Right -->
					<button 
						class="bubble-btn" 
						class:is-active={activeStates.imageFloat === 'right'}
						onmousedown={(e) => { 
							e.preventDefault(); 
							editor?.chain().focus().updateAttributes('image', { float: 'right' }).run();
						}}
						title="Float Right"
					>
						➡️
					</button>
					
					<div class="bubble-divider"></div>
					
					<!-- Width 25% -->
					<button 
						class="bubble-btn" 
						class:is-active={activeStates.imageWidth === '25%'}
						onmousedown={(e) => { 
							e.preventDefault(); 
							editor?.chain().focus().updateAttributes('image', { width: '25%' }).run();
						}}
						title="Width 25%"
						style="font-size: 11px;"
					>
						25%
					</button>
					<!-- Width 50% -->
					<button 
						class="bubble-btn" 
						class:is-active={activeStates.imageWidth === '50%'}
						onmousedown={(e) => { 
							e.preventDefault(); 
							editor?.chain().focus().updateAttributes('image', { width: '50%' }).run();
						}}
						title="Width 50%"
						style="font-size: 11px;"
					>
						50%
					</button>
					<!-- Width 75% -->
					<button 
						class="bubble-btn" 
						class:is-active={activeStates.imageWidth === '75%'}
						onmousedown={(e) => { 
							e.preventDefault(); 
							editor?.chain().focus().updateAttributes('image', { width: '75%' }).run();
						}}
						title="Width 75%"
						style="font-size: 11px;"
					>
						75%
					</button>
					<!-- Width 100% -->
					<button 
						class="bubble-btn" 
						class:is-active={activeStates.imageWidth === '100%'}
						onmousedown={(e) => { 
							e.preventDefault(); 
							editor?.chain().focus().updateAttributes('image', { width: '100%' }).run();
						}}
						title="Width 100%"
						style="font-size: 11px;"
					>
						100%
					</button>
				</div>
			{:else}
				<div class="bubble-buttons" style="display: {showLinkInput ? 'none' : 'flex'}; gap: 4px;">
					<button 
						class="bubble-btn" 
						class:is-active={activeStates.bold}
						onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().toggleBold().run() }}
					>
						B
					</button>
					<button 
						class="bubble-btn" 
						class:is-active={activeStates.italic}
						onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().toggleItalic().run() }}
					>
						I
					</button>
					<button 
						class="bubble-btn" 
						class:is-active={activeStates.link}
						onmousedown={(e) => { e.preventDefault(); setLink() }}
					>
						🔗
					</button>
					<div class="bubble-divider"></div>
					<button 
						class="bubble-btn color-btn" 
						class:is-active={activeStates.textStyle}
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
					{#if activeStates.table}
						<div class="bubble-divider"></div>
						<button class="bubble-btn" title="Add Row Below" onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().addRowAfter().run() }}>R+</button>
						<button class="bubble-btn" title="Add Col Right" onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().addColumnAfter().run() }}>C+</button>
						<button class="bubble-btn" title="Delete Row" onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().deleteRow().run() }}>R-</button>
						<button class="bubble-btn" title="Delete Col" onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().deleteColumn().run() }}>C-</button>
						<button class="bubble-btn" style="color: #ff4444;" title="Delete Table" onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().deleteTable().run() }}>X</button>
					{/if}
				</div>
			{/if}
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
