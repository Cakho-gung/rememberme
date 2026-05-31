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
	import Underline from '@tiptap/extension-underline';
	import Subscript from '@tiptap/extension-subscript';
	import Superscript from '@tiptap/extension-superscript';
	import TextAlign from '@tiptap/extension-text-align';
	import { MathExtension } from '@aarkue/tiptap-math-extension';
	import { fade } from 'svelte/transition';
	
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import { readFile } from '@tauri-apps/plugin-fs';
	import { invoke, convertFileSrc } from '@tauri-apps/api/core';
	
	import { Table } from '@tiptap/extension-table';
	import { TableRow } from '@tiptap/extension-table-row';
	import { TableHeader } from '@tiptap/extension-table-header';
	import { TableCell } from '@tiptap/extension-table-cell';
	
	import { SlashCommands } from './slashExtension';
	import { MentionExtension } from './mentionExtension';
	import { CustomCodeBlock } from './CustomCodeBlock';
	import { SmartSelectAll } from './SmartSelectAll';
	import { ImagePasteExtension } from './ImagePasteExtension';
	import { ColorHighlighter } from './ColorHighlighter';
	import { EmojiExtension } from './emojiExtension';
	import { CustomImage } from './CustomImage';

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

	let showHeadingMenu = $state(false);
	let showMoreMenu = $state(false);

	let activeStates = $state({
		table: false,
		bold: false,
		italic: false,
		underline: false,
		strike: false,
		code: false,
		subscript: false,
		superscript: false,
		textAlign: 'left',
		headingLevel: 0,
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
					inline: true,
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
				Underline,
				Subscript,
				Superscript,
				TextAlign.configure({
					types: ['heading', 'paragraph'],
				}),
				ColorHighlighter,
				SlashCommands,
				MentionExtension,
				EmojiExtension,
				BubbleMenuExtension.configure({
					element: bubbleMenuElement!,
					options: {
						placement: 'bottom-start',
					},
					shouldShow: ({ editor, view, state, from, to }) => {
						if (showLinkInput) return true;
						
						// Không hiển thị bubble menu khi ở trong code block
						if (editor.isActive('codeBlock')) {
							return false;
						}
						
						// Show bubble menu inside table even if selection is empty
						if (editor.isActive('table')) {
							return true;
						}
						
						const { doc, selection } = state;
						const { empty } = selection;
						if (empty || !view.hasFocus()) {
							showHeadingMenu = false;
							showMoreMenu = false;
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
				activeStates.underline = editor.isActive('underline');
				activeStates.strike = editor.isActive('strike');
				activeStates.code = editor.isActive('code');
				activeStates.subscript = editor.isActive('subscript');
				activeStates.superscript = editor.isActive('superscript');
				
				if (editor.isActive({ textAlign: 'center' })) activeStates.textAlign = 'center';
				else if (editor.isActive({ textAlign: 'right' })) activeStates.textAlign = 'right';
				else if (editor.isActive({ textAlign: 'justify' })) activeStates.textAlign = 'justify';
				else activeStates.textAlign = 'left';

				if (editor.isActive('heading', { level: 1 })) activeStates.headingLevel = 1;
				else if (editor.isActive('heading', { level: 2 })) activeStates.headingLevel = 2;
				else if (editor.isActive('heading', { level: 3 })) activeStates.headingLevel = 3;
				else if (editor.isActive('heading', { level: 4 })) activeStates.headingLevel = 4;
				else if (editor.isActive('heading', { level: 5 })) activeStates.headingLevel = 5;
				else if (editor.isActive('heading', { level: 6 })) activeStates.headingLevel = 6;
				else activeStates.headingLevel = 0;

				activeStates.link = editor.isActive('link');
				activeStates.textStyle = editor.isActive('textStyle', { color: 'var(--color-accent)' });
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
				<div class="bubble-buttons" style="display: {showLinkInput ? 'none' : 'flex'}; gap: 4px; position: relative;">
					<!-- Heading Selector -->
					<button class="bubble-btn heading-btn" onmousedown={(e) => { e.preventDefault(); showHeadingMenu = !showHeadingMenu; showMoreMenu = false; }}>
						{activeStates.headingLevel === 0 ? 'Text' : `Heading ${activeStates.headingLevel}`}
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-left: 4px;"><path d="m6 9 6 6 6-6"/></svg>
					</button>
					
					<!-- Heading Menu Popover -->
					{#if showHeadingMenu}
						<div class="popover-menu">
							<button class="popover-item" class:is-active={activeStates.headingLevel === 0} onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().setParagraph().run(); showHeadingMenu = false; }}>Text</button>
							<button class="popover-item" class:is-active={activeStates.headingLevel === 1} onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().toggleHeading({ level: 1 }).run(); showHeadingMenu = false; }}>Heading 1</button>
							<button class="popover-item" class:is-active={activeStates.headingLevel === 2} onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().toggleHeading({ level: 2 }).run(); showHeadingMenu = false; }}>Heading 2</button>
							<button class="popover-item" class:is-active={activeStates.headingLevel === 3} onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().toggleHeading({ level: 3 }).run(); showHeadingMenu = false; }}>Heading 3</button>
						</div>
					{/if}

					<div class="bubble-divider"></div>

					<button 
						class="bubble-btn" 
						class:is-active={activeStates.bold}
						onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().toggleBold().run() }}
						title="Bold"
					>
						<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 12a4 4 0 0 0 0-8H6v8"/><path d="M15 20a4 4 0 0 0 0-8H6v8Z"/></svg>
					</button>
					<button 
						class="bubble-btn" 
						class:is-active={activeStates.italic}
						onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().toggleItalic().run() }}
						title="Italic"
					>
						<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="19" x2="10" y1="4" y2="4"/><line x1="14" x2="5" y1="20" y2="20"/><line x1="15" x2="9" y1="4" y2="20"/></svg>
					</button>
					<button 
						class="bubble-btn" 
						class:is-active={activeStates.underline}
						onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().toggleUnderline().run() }}
						title="Underline"
					>
						<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4v6a6 6 0 0 0 12 0V4"/><line x1="4" x2="20" y1="20" y2="20"/></svg>
					</button>
					<button 
						class="bubble-btn" 
						class:is-active={activeStates.strike}
						onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().toggleStrike().run() }}
						title="Strikethrough"
					>
						<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" x2="20" y1="12" y2="12"/></svg>
					</button>
					<button 
						class="bubble-btn" 
						class:is-active={activeStates.code}
						onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().toggleCode().run() }}
						title="Code"
					>
						<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
					</button>

					<div class="bubble-divider"></div>

					<button 
						class="bubble-btn" 
						class:is-active={activeStates.link}
						onmousedown={(e) => { e.preventDefault(); setLink() }}
						title="Link"
					>
						<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
					</button>
					<button 
						class="bubble-btn color-btn" 
						class:is-active={activeStates.textStyle}
						onmousedown={(e) => { 
							e.preventDefault(); 
							if (editor?.isActive('textStyle', { color: 'var(--color-accent)' })) {
								editor?.chain().focus().unsetColor().run();
							} else {
								editor?.chain().focus().setColor('var(--color-accent)').run();
							}
						}}
						title="Highlight Accent Color"
					>
						<span class="color-dot"></span>
					</button>

					<div class="bubble-divider"></div>

					<!-- More Options Button -->
					<button class="bubble-btn" onmousedown={(e) => { e.preventDefault(); showMoreMenu = !showMoreMenu; showHeadingMenu = false; }} title="More options">
						<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
					</button>

					<!-- More Menu Popover -->
					{#if showMoreMenu}
						<div class="popover-menu more-menu">
							<div class="popover-row">
								<button class="bubble-btn" class:is-active={activeStates.superscript} onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().toggleSuperscript().run(); }} title="Superscript">
									<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m4 19 8-8"/><path d="m12 19-8-8"/><path d="M20 12h-4c0-1.5 2-3 2-4s-2-2.5-2-4"/></svg>
								</button>
								<button class="bubble-btn" class:is-active={activeStates.subscript} onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().toggleSubscript().run(); }} title="Subscript">
									<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m4 5 8 8"/><path d="m12 5-8 8"/><path d="M20 19h-4c0-1.5 2-3 2-4s-2-2.5-2-4"/></svg>
								</button>
								<div class="bubble-divider"></div>
								<button class="bubble-btn" class:is-active={activeStates.textAlign === 'left'} onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().setTextAlign('left').run(); }} title="Align Left">
									<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="21" x2="3" y1="6" y2="6"/><line x1="15" x2="3" y1="12" y2="12"/><line x1="17" x2="3" y1="18" y2="18"/></svg>
								</button>
								<button class="bubble-btn" class:is-active={activeStates.textAlign === 'center'} onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().setTextAlign('center').run(); }} title="Align Center">
									<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="21" x2="3" y1="6" y2="6"/><line x1="19" x2="5" y1="12" y2="12"/><line x1="21" x2="3" y1="18" y2="18"/></svg>
								</button>
								<button class="bubble-btn" class:is-active={activeStates.textAlign === 'right'} onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().setTextAlign('right').run(); }} title="Align Right">
									<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="21" x2="3" y1="6" y2="6"/><line x1="21" x2="9" y1="12" y2="12"/><line x1="21" x2="7" y1="18" y2="18"/></svg>
								</button>
							</div>
						</div>
					{/if}

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
		color: var(--color-text, #333);
		font-family: inherit;
		font-size: 0.9em;
		padding: 4px 8px;
		width: 180px;
		outline: none;

		&::placeholder {
			color: var(--color-text-muted, rgba(0, 0, 0, 0.4));
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
		background: var(--bg-focused, rgba(255, 255, 255, 0.95));
		border-radius: 8px;
		border: 1px solid var(--dropdown-divider-bg, rgba(0, 0, 0, 0.1));
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
		color: var(--color-text-muted, #444);
		cursor: pointer;
		transition: all 0.15s ease;

		&:hover {
			background: var(--dropdown-item-hover, rgba(0, 0, 0, 0.05));
			color: var(--color-text, #111);
		}

		&.is-active {
			background: var(--dropdown-divider-bg, rgba(0, 0, 0, 0.1));
			color: var(--color-text, #000);
		}
	}

	.bubble-divider {
		width: 1px;
		height: 16px;
		background: var(--dropdown-divider-bg, rgba(0, 0, 0, 0.1));
		margin: 4px 4px;
	}

	.color-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0 6px;
		width: auto;
	}

	.color-dot {
		display: inline-block;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background-color: var(--color-accent); /* Khớp với $theme-primary */
		box-shadow: 0 1px 3px color-mix(in srgb, var(--color-accent) 40%, transparent);
		transition: transform 0.2s ease;
	}

	.bubble-btn:hover .color-dot {
		transform: scale(1.15);
	}

	/* Popover Styles */
	.popover-menu {
		position: absolute;
		top: calc(100% + 8px);
		left: 100px;
		background: var(--bg-focused, rgba(255, 255, 255, 0.98));
		border-radius: 8px;
		border: 1px solid var(--dropdown-divider-bg, rgba(0, 0, 0, 0.1));
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
		padding: 4px;
		display: flex;
		flex-direction: column;
		min-width: 120px;
		z-index: 50;
	}

	.popover-item {
		background: transparent;
		border: none;
		padding: 6px 12px;
		text-align: left;
		border-radius: 4px;
		cursor: pointer;
		font-family: inherit;
		font-size: 13px;
		color: var(--color-text, #333);
		transition: background 0.15s ease;

		&:hover {
			background: var(--dropdown-item-hover, rgba(0, 0, 0, 0.05));
		}

		&.is-active {
			background: var(--dropdown-divider-bg, rgba(0, 0, 0, 0.08));
			font-weight: 500;
		}
	}

	.more-menu {
		left: auto;
		right: 0;
		min-width: auto;
		padding: 4px 6px;
	}

	.popover-row {
		display: flex;
		align-items: center;
		gap: 2px;
	}

	.heading-btn {
		width: auto;
		padding: 0 8px;
		font-weight: 500;
		min-width: 90px;
		justify-content: space-between;
	}
</style>
