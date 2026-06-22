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
	import { Details, DetailsSummary, DetailsContent } from '@tiptap/extension-details';
	
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
	import { GlobalShortcuts } from './shortcutsExtension';

	interface Props {
		noteId: number;
		content: object | string | null;
		onUpdate?: (content: object) => void;
		editor?: Editor;
	}

	let { noteId, content, onUpdate, editor = $bindable() }: Props = $props();

	let element = $state<HTMLElement>();
	let bubbleMenuElement = $state<HTMLElement>();
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
				scrollThreshold: { top: 0, bottom: 80, left: 0, right: 0 },
				scrollMargin: { top: 0, bottom: 80, left: 0, right: 0 },
			},
			extensions: [
				// Cấu hình StarterKit: Tắt codeBlock mặc định vì đã dùng lowlight
				StarterKit.configure({
					codeBlock: false,
				}),
				Placeholder.configure({
					placeholder: ({ node }) => {
						if (node.type.name === 'detailsSummary') {
							return 'Summary...';
						}
						return "Type '/' for commands...";
					},
					emptyEditorClass: 'is-editor-empty',
					emptyNodeClass: 'is-empty',
					showOnlyWhenEditable: true,
					showOnlyCurrent: true,
					includeChildren: true,
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
				Details.extend({
					addAttributes() {
						return {
							open: {
								default: true,
								parseHTML: element => element.hasAttribute('open'),
								renderHTML: ({ open }) => {
									if (!open) return {};
									return { open: '' };
								},
							}
						};
					}
				}).configure({
					persist: true,
					HTMLAttributes: {
						class: 'details',
					},
				}),
				DetailsSummary,
				DetailsContent,
				TextAlign.configure({
					types: ['heading', 'paragraph'],
				}),
				ColorHighlighter,
				SlashCommands,
				MentionExtension,
				EmojiExtension,
				GlobalShortcuts,
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
				// ── Performance: skip expensive isActive() checks during caret navigation ──
				// When selection is empty (just a cursor), bubble menu is hidden,
				// so toolbar states (bold/italic/etc.) are not visible — no need to compute them.
				// Only compute heading level (used by page title extraction) on every transaction.
				const { empty } = editor.state.selection;

				// Always update heading level (lightweight, needed by TOC/title)
				if (editor.isActive('heading', { level: 1 })) activeStates.headingLevel = 1;
				else if (editor.isActive('heading', { level: 2 })) activeStates.headingLevel = 2;
				else if (editor.isActive('heading', { level: 3 })) activeStates.headingLevel = 3;
				else if (editor.isActive('heading', { level: 4 })) activeStates.headingLevel = 4;
				else if (editor.isActive('heading', { level: 5 })) activeStates.headingLevel = 5;
				else if (editor.isActive('heading', { level: 6 })) activeStates.headingLevel = 6;
				else activeStates.headingLevel = 0;

				// Skip remaining checks when no text is selected (cursor-only navigation)
				if (empty) return;

				// Full state refresh — only when bubble menu is potentially visible
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

	// ── Hover Link Popup ──
	let hoverLinkPopupEl = $state<HTMLElement>();
	let hoverTimer: ReturnType<typeof setTimeout> | null = null;
	let hidePopupTimer: ReturnType<typeof setTimeout> | null = null;
	let showHoverLinkPopup = $state(false);
	let hoverLinkHref = $state('');
	let hoverLinkPos = $state({ top: 0, left: 0 });
	let hoveredLinkElement = $state<HTMLElement | null>(null);
	let isMouseOverPopup = false;
	let isPopupFocused = false;

	function handleEditorMouseMove(e: MouseEvent) {
		const target = e.target as HTMLElement;
		const aTag = target.closest('a');
		
		if (aTag) {
			if (hidePopupTimer) clearTimeout(hidePopupTimer);
			
			if (!isPopupFocused) {
				if (hoveredLinkElement !== aTag || (!showHoverLinkPopup && !hoverTimer)) {
					if (hoverTimer) clearTimeout(hoverTimer);
					hoveredLinkElement = aTag;
					hoverLinkHref = aTag.getAttribute('href') || '';
					hoverTimer = setTimeout(() => {
						const rect = aTag.getBoundingClientRect();
						const containerRect = element?.parentElement?.getBoundingClientRect();
						if (containerRect) {
							hoverLinkPos = { 
								top: rect.bottom - containerRect.top + 4, 
								left: rect.left - containerRect.left 
							};
							showHoverLinkPopup = true;
						}
						hoverTimer = null;
					}, 1000);
				}
			}
		} else {
			if (hoveredLinkElement) {
				if (hoverTimer) {
					clearTimeout(hoverTimer);
					hoverTimer = null;
				}
				if (!isMouseOverPopup && !isPopupFocused) {
					if (hidePopupTimer) clearTimeout(hidePopupTimer);
					hidePopupTimer = setTimeout(() => {
						if (!isMouseOverPopup && !isPopupFocused) {
							hoveredLinkElement = null;
							showHoverLinkPopup = false;
						}
					}, 300);
				}
			}
		}
	}

	function handlePopupMouseEnter() {
		isMouseOverPopup = true;
		if (hidePopupTimer) clearTimeout(hidePopupTimer);
	}

	function handlePopupMouseLeave() {
		isMouseOverPopup = false;
		if (isPopupFocused) return;
		if (hidePopupTimer) clearTimeout(hidePopupTimer);
		hidePopupTimer = setTimeout(() => {
			showHoverLinkPopup = false;
			hoveredLinkElement = null;
		}, 100);
	}

	function handlePopupBlur() {
		isPopupFocused = false;
		if (!isMouseOverPopup) {
			showHoverLinkPopup = false;
			hoveredLinkElement = null;
		}
	}

	function updateHoveredLink(newUrl: string) {
		if (!editor || !hoveredLinkElement) return;
		hoverLinkHref = newUrl;
		const pos = editor.view.posAtDOM(hoveredLinkElement, 0);
		if (pos >= 0) {
			// update link without stealing focus
			editor.chain().setTextSelection(pos).extendMarkRange('link').setLink({ href: newUrl }).run();
		}
	}

	function removeHoveredLink() {
		if (!editor || !hoveredLinkElement) return;
		const pos = editor.view.posAtDOM(hoveredLinkElement, 0);
		if (pos >= 0) {
			editor.chain().focus().setTextSelection(pos).unsetLink().run();
		}
		showHoverLinkPopup = false;
		hoveredLinkElement = null;
		isMouseOverPopup = false;
	}
</script>

<div class="text-editor-container">
	<!-- Text Editor Main Area -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="text-editor" bind:this={element} onmousemove={handleEditorMouseMove}></div>
	
	{#if showHoverLinkPopup}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div 
			bind:this={hoverLinkPopupEl}
			class="hover-link-popup"
			style="top: {hoverLinkPos.top}px; left: {hoverLinkPos.left}px;"
			onmouseenter={handlePopupMouseEnter}
			onmouseleave={handlePopupMouseLeave}
			transition:fade={{ duration: 150 }}
		>
			<input 
				class="hover-link-input"
				value={hoverLinkHref}
				onfocus={() => isPopupFocused = true}
				onblur={handlePopupBlur}
				oninput={(e) => updateHoveredLink(e.currentTarget.value)}
				onkeydown={(e) => {
					if (e.key === 'Enter' || e.key === 'Escape') {
						e.currentTarget.blur();
					}
				}}
				placeholder="Link URL"
			/>
			<div class="hover-link-divider"></div>
			<button class="hover-link-remove" onmousedown={(e) => { e.preventDefault(); removeHoveredLink(); }} title="Remove link">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
			</button>
		</div>
	{/if}
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
						<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
						<g clip-path="url(#clip0_656_3041)">
						<path d="M0.833252 14.6665V1.3335C0.833252 1.05735 1.05711 0.833496 1.33325 0.833496C1.60939 0.833496 1.83325 1.05735 1.83325 1.3335V14.6665C1.83325 14.9426 1.60939 15.1665 1.33325 15.1665C1.05711 15.1665 0.833252 14.9426 0.833252 14.6665ZM9.50024 10.6665C9.50007 10.2064 9.12639 9.8335 8.66626 9.8335H5.33325C4.87312 9.8335 4.50042 10.2064 4.50024 10.6665V12.0005C4.50042 12.4606 4.87312 12.8335 5.33325 12.8335H8.66626C9.12639 12.8335 9.50007 12.4606 9.50024 12.0005V10.6665ZM14.1663 4.00049C14.1663 3.54025 13.7935 3.1665 13.3333 3.1665H5.33325C4.87301 3.1665 4.50024 3.54025 4.50024 4.00049V5.3335C4.50024 5.79373 4.87301 6.1665 5.33325 6.1665H13.3333C13.7935 6.1665 14.1663 5.79373 14.1663 5.3335V4.00049ZM10.5002 12.0005C10.5001 13.0129 9.67867 13.8335 8.66626 13.8335H5.33325C4.32084 13.8335 3.50042 13.0129 3.50024 12.0005V10.6665C3.50042 9.65413 4.32084 8.8335 5.33325 8.8335H8.66626C9.67867 8.8335 10.5001 9.65413 10.5002 10.6665V12.0005ZM15.1663 5.3335C15.1663 6.34602 14.3458 7.1665 13.3333 7.1665H5.33325C4.32073 7.1665 3.50024 6.34602 3.50024 5.3335V4.00049C3.50024 2.98797 4.32073 2.1665 5.33325 2.1665H13.3333C14.3458 2.1665 15.1663 2.98797 15.1663 4.00049V5.3335Z" fill="currentColor"/>
						</g>
						<defs>
						<clipPath id="clip0_656_3041">
						<rect width="16" height="16" fill="currentColor"/>
						</clipPath>
						</defs>
						</svg>
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
						<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
						<path d="M2.16675 14.6665V1.3335C2.16675 1.05735 2.39061 0.833496 2.66675 0.833496C2.94289 0.833496 3.16675 1.05735 3.16675 1.3335V14.6665C3.16675 14.9426 2.94289 15.1665 2.66675 15.1665C2.39061 15.1665 2.16675 14.9426 2.16675 14.6665ZM12.8337 14.6665V1.3335C12.8337 1.05735 13.0576 0.833496 13.3337 0.833496C13.6097 0.833671 13.8337 1.05746 13.8337 1.3335V14.6665C13.8337 14.9425 13.6097 15.1663 13.3337 15.1665C13.0576 15.1665 12.8337 14.9426 12.8337 14.6665ZM9.49976 6.00049C9.49976 5.54025 9.12699 5.1665 8.66675 5.1665H7.33374C6.8735 5.1665 6.49976 5.54025 6.49976 6.00049V10.0005C6.49993 10.4606 6.87361 10.8335 7.33374 10.8335H8.66675C9.12688 10.8335 9.49958 10.4606 9.49976 10.0005V6.00049ZM10.4998 10.0005C10.4996 11.0129 9.67916 11.8335 8.66675 11.8335H7.33374C6.32133 11.8335 5.49993 11.0129 5.49976 10.0005V6.00049C5.49976 4.98797 6.32122 4.1665 7.33374 4.1665H8.66675C9.67927 4.1665 10.4998 4.98797 10.4998 6.00049V10.0005Z" fill="currentColor"/>
						</svg>
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
						<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
						<g clip-path="url(#clip0_656_3042)">
						<path d="M14.1663 14.6665V1.3335C14.1663 1.05746 14.3903 0.833672 14.6663 0.833496C14.9424 0.833496 15.1663 1.05735 15.1663 1.3335V14.6665C15.1663 14.9426 14.9424 15.1665 14.6663 15.1665C14.3903 15.1663 14.1663 14.9425 14.1663 14.6665ZM11.5002 10.6665C11.5001 10.2064 11.1264 9.8335 10.6663 9.8335H7.33325C6.87312 9.8335 6.50042 10.2064 6.50024 10.6665V12.0005C6.50042 12.4606 6.87312 12.8335 7.33325 12.8335H10.6663C11.1264 12.8335 11.5001 12.4606 11.5002 12.0005V10.6665ZM11.5002 4.00049C11.5002 3.54025 11.1265 3.1665 10.6663 3.1665H2.66626C2.20617 3.16668 1.83325 3.54036 1.83325 4.00049V5.3335C1.83325 5.79363 2.20617 6.16633 2.66626 6.1665H10.6663C11.1265 6.1665 11.5002 5.79373 11.5002 5.3335V4.00049ZM12.5002 12.0005C12.5001 13.0129 11.6787 13.8335 10.6663 13.8335H7.33325C6.32084 13.8335 5.50042 13.0129 5.50024 12.0005V10.6665C5.50042 9.65413 6.32084 8.8335 7.33325 8.8335H10.6663C11.6787 8.8335 12.5001 9.65413 12.5002 10.6665V12.0005ZM12.5002 5.3335C12.5002 6.34602 11.6788 7.1665 10.6663 7.1665H2.66626C1.65389 7.16633 0.833252 6.34591 0.833252 5.3335V4.00049C0.833252 2.98807 1.65389 2.16668 2.66626 2.1665H10.6663C11.6788 2.1665 12.5002 2.98797 12.5002 4.00049V5.3335Z" fill="currentColor"/>
						</g>
						<defs>
						<clipPath id="clip0_656_3042">
						<rect width="16" height="16" fill="currentColor"/>
						</clipPath>
						</defs>
						</svg>
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
					{#if activeStates.table}
						<button class="bubble-btn" title="Add Row Below" onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().addRowAfter().run() }}>
							<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
								<path d="M13.5002 10C13.5002 9.90795 13.4253 9.83301 13.3332 9.83301H6.00021C5.90816 9.83301 5.83321 9.90795 5.83321 10V13.333C5.83321 13.4251 5.90816 13.5 6.00021 13.5H13.3332C13.4253 13.5 13.5002 13.4251 13.5002 13.333V10ZM0.979699 5.64648C1.17496 5.45122 1.49147 5.45122 1.68673 5.64648L3.68673 7.64648C3.88199 7.84175 3.88199 8.15825 3.68673 8.35352L1.68673 10.3535C1.49147 10.5488 1.17496 10.5488 0.979699 10.3535C0.784437 10.1583 0.784436 9.84175 0.979699 9.64648L2.62618 8L0.979699 6.35352C0.784436 6.15825 0.784436 5.84175 0.979699 5.64648ZM13.5002 2.66699C13.5002 2.57495 13.4253 2.5 13.3332 2.5H6.00021C5.90816 2.5 5.83321 2.57494 5.83321 2.66699V6C5.83321 6.09205 5.90816 6.16699 6.00021 6.16699H13.3332C13.4253 6.16699 13.5002 6.09205 13.5002 6V2.66699ZM14.5002 13.333C14.5002 13.9773 13.9775 14.5 13.3332 14.5H6.00021C5.35587 14.5 4.83321 13.9773 4.83321 13.333V10C4.83321 9.35567 5.35587 8.83301 6.00021 8.83301H13.3332C13.9775 8.83301 14.5002 9.35567 14.5002 10V13.333ZM14.5002 6C14.5002 6.64433 13.9775 7.16699 13.3332 7.16699H6.00021C5.35587 7.16699 4.83321 6.64433 4.83321 6V2.66699C4.83321 2.02266 5.35587 1.5 6.00021 1.5H13.3332C13.9775 1.5 14.5002 2.02266 14.5002 2.66699V6Z" fill="currentColor"/>
							</svg>
						</button>
						<button class="bubble-btn" title="Add Col Right" onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().addColumnAfter().run() }}>
							<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
								<path d="M6.16699 6.00045C6.16699 5.9084 6.09205 5.83346 6 5.83346H2.66699C2.57494 5.83346 2.5 5.9084 2.5 6.00045V13.3335C2.5 13.4255 2.57495 13.5005 2.66699 13.5005H6C6.09205 13.5005 6.16699 13.4255 6.16699 13.3335V6.00045ZM13.5 6.00045C13.5 5.9084 13.4251 5.83346 13.333 5.83346H10C9.90795 5.83346 9.83301 5.9084 9.83301 6.00045V13.3335C9.83301 13.4255 9.90795 13.5005 10 13.5005H13.333C13.4251 13.5005 13.5 13.4255 13.5 13.3335V6.00045ZM9.64648 0.979943C9.84175 0.784681 10.1583 0.784681 10.3535 0.979943C10.5488 1.1752 10.5488 1.49171 10.3535 1.68697L8.35352 3.68697C8.15825 3.88224 7.84175 3.88224 7.64648 3.68697L5.64648 1.68697C5.45122 1.49171 5.45122 1.1752 5.64648 0.979943C5.84175 0.784681 6.15825 0.784681 6.35352 0.979943L8 2.62643L9.64648 0.979943ZM7.16699 13.3335C7.16699 13.9778 6.64433 14.5005 6 14.5005H2.66699C2.02266 14.5005 1.5 13.9778 1.5 13.3335V6.00045C1.5 5.35612 2.02266 4.83346 2.66699 4.83346H6C6.64433 4.83346 7.16699 5.35612 7.16699 6.00045V13.3335ZM14.5 13.3335C14.5 13.9778 13.9773 14.5005 13.333 14.5005H10C9.35567 14.5005 8.83301 13.9778 8.83301 13.3335V6.00045C8.83301 5.35612 9.35567 4.83346 10 4.83346H13.333C13.9773 4.83346 14.5 5.35612 14.5 6.00045V13.3335Z" fill="currentColor"/>
								</svg>
						</button>
						<button class="bubble-btn" title="Delete Row" onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().deleteRow().run() }}>
							<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
								<path d="M4.19238 10.4754C4.10513 10.4754 4.04337 10.5018 4.01269 10.524C4.00674 10.5284 4.00269 10.5323 4 10.5349L4 13.0174C4.00269 13.02 4.00668 13.0239 4.0127 13.0282C4.04334 13.0505 4.10505 13.0769 4.19238 13.0769L11.8076 13.0769C11.895 13.0769 11.9567 13.0505 11.9873 13.0282C11.9933 13.0239 11.9973 13.02 12 13.0174L12 10.5349C11.9973 10.5323 11.9933 10.5284 11.9873 10.524C11.9566 10.5018 11.8949 10.4754 11.8076 10.4754L4.19238 10.4754ZM4.19238 2.92308C4.10505 2.92308 4.04334 2.94955 4.01269 2.97175C4.00668 2.97613 4.00269 2.97996 4 2.98257L4 5.46514C4.00269 5.46775 4.00674 5.47163 4.01269 5.47596C4.04337 5.49816 4.10513 5.52464 4.19238 5.52464L11.8076 5.52464C11.8949 5.52464 11.9566 5.49816 11.9873 5.47596C11.9933 5.47163 11.9973 5.46775 12 5.46514L12 2.98257C11.9973 2.97996 11.9933 2.97613 11.9873 2.97175C11.9567 2.94955 11.895 2.92308 11.8076 2.92308L4.19238 2.92308ZM11.8076 9.55228C12.3485 9.55228 13 9.88828 13 10.5177L13 13.0346C13 13.664 12.3485 14 11.8076 14L4.19238 14C3.65154 14 3 13.664 3 13.0346L3 10.5177C3 9.88828 3.65153 9.55228 4.19238 9.55228L11.8076 9.55228ZM11.8076 2C12.3485 2 13 2.336 13 2.96544L13 5.48227C13 6.11172 12.3485 6.44772 11.8076 6.44772L4.19238 6.44772C3.65153 6.44772 3 6.11172 3 5.48227L3 2.96544C3 2.336 3.65153 2 4.19238 2L11.8076 2Z" fill="currentColor"/>
								<path d="M14.4615 8.46154L13.3846 8.46154C13.0872 8.46154 12.8462 8.2549 12.8462 8C12.8462 7.7451 13.0872 7.53846 13.3846 7.53846L14.4615 7.53846C14.7589 7.53846 15 7.7451 15 8C15 8.2549 14.7589 8.46154 14.4615 8.46154ZM11.2308 8.46154L9.07692 8.46154C8.77954 8.46154 8.53846 8.2549 8.53846 8C8.53846 7.7451 8.77954 7.53846 9.07692 7.53846L11.2308 7.53846C11.5282 7.53846 11.7692 7.7451 11.7692 8C11.7692 8.2549 11.5282 8.46154 11.2308 8.46154ZM6.92308 8.46154L4.76923 8.46154C4.47185 8.46154 4.23077 8.2549 4.23077 8C4.23077 7.7451 4.47185 7.53846 4.76923 7.53846L6.92308 7.53846C7.22046 7.53846 7.46154 7.7451 7.46154 8C7.46154 8.2549 7.22046 8.46154 6.92308 8.46154ZM2.61538 8.46154L1.53846 8.46154C1.24108 8.46154 1 8.2549 1 8C1 7.7451 1.24108 7.53846 1.53846 7.53846L2.61538 7.53846C2.91277 7.53846 3.15385 7.7451 3.15385 8C3.15385 8.2549 2.91277 8.46154 2.61538 8.46154Z" fill="currentColor"/>
							</svg>
						</button>
						<button class="bubble-btn" title="Delete Col" onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().deleteColumn().run() }}>
							<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
								<path d="M5.52464 4.19238C5.52464 4.10513 5.49816 4.04337 5.47596 4.0127C5.47163 4.00674 5.46775 4.00269 5.46514 4H2.98257C2.97996 4.00269 2.97613 4.00668 2.97175 4.0127C2.94955 4.04334 2.92308 4.10505 2.92308 4.19238V11.8076C2.92308 11.895 2.94955 11.9567 2.97175 11.9873C2.97613 11.9933 2.97996 11.9973 2.98257 12H5.46514C5.46775 11.9973 5.47163 11.9933 5.47596 11.9873C5.49816 11.9566 5.52464 11.8949 5.52464 11.8076V4.19238ZM13.0769 4.19238C13.0769 4.10505 13.0505 4.04334 13.0282 4.0127C13.0239 4.00668 13.02 4.00269 13.0174 4H10.5349C10.5323 4.00269 10.5284 4.00674 10.524 4.0127C10.5018 4.04337 10.4754 4.10513 10.4754 4.19238V11.8076C10.4754 11.8949 10.5018 11.9566 10.524 11.9873C10.5284 11.9933 10.5323 11.9973 10.5349 12H13.0174C13.02 11.9973 13.0239 11.9933 13.0282 11.9873C13.0505 11.9567 13.0769 11.895 13.0769 11.8076V4.19238ZM6.44772 11.8076C6.44772 12.3485 6.11172 13 5.48227 13H2.96544C2.336 13 2 12.3485 2 11.8076V4.19238C2 3.65154 2.336 3 2.96544 3H5.48227C6.11172 3 6.44772 3.65153 6.44772 4.19238V11.8076ZM14 11.8076C14 12.3485 13.664 13 13.0346 13H10.5177C9.88828 13 9.55228 12.3485 9.55228 11.8076V4.19238C9.55228 3.65153 9.88828 3 10.5177 3H13.0346C13.664 3 14 3.65154 14 4.19238V11.8076Z" fill="currentColor"/>
								<path d="M7.53846 14.4615V13.3846C7.53846 13.0872 7.7451 12.8462 8 12.8462C8.2549 12.8462 8.46154 13.0872 8.46154 13.3846V14.4615C8.46154 14.7589 8.2549 15 8 15C7.7451 15 7.53846 14.7589 7.53846 14.4615ZM7.53846 11.2308V9.07692C7.53846 8.77954 7.7451 8.53846 8 8.53846C8.2549 8.53846 8.46154 8.77954 8.46154 9.07692L8.46154 11.2308C8.46154 11.5282 8.2549 11.7692 8 11.7692C7.7451 11.7692 7.53846 11.5282 7.53846 11.2308ZM7.53846 6.92308L7.53846 4.76923C7.53846 4.47185 7.7451 4.23077 8 4.23077C8.2549 4.23077 8.46154 4.47185 8.46154 4.76923V6.92308C8.46154 7.22046 8.2549 7.46154 8 7.46154C7.7451 7.46154 7.53846 7.22046 7.53846 6.92308ZM7.53846 2.61538V1.53846C7.53846 1.24108 7.7451 1 8 1C8.2549 1 8.46154 1.24108 8.46154 1.53846V2.61538C8.46154 2.91277 8.2549 3.15385 8 3.15385C7.7451 3.15385 7.53846 2.91277 7.53846 2.61538Z" fill="currentColor"/>
							</svg>
						</button>
						<button class="bubble-btn" style="color: #ff4444;" title="Delete Table" onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().deleteTable().run() }}>
							<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
								<path d="M13.5 6.5H6.5V13.5H12.667C12.8879 13.4999 13.0997 13.4121 13.2559 13.2559C13.4121 13.0997 13.4999 12.8879 13.5 12.667V6.5ZM2.5 12.667C2.50009 12.8879 2.58794 13.0997 2.74414 13.2559C2.90034 13.4121 3.11211 13.4999 3.33301 13.5H5.5V6.5H2.5V12.667ZM13.5 3.33301C13.4999 3.11211 13.4121 2.90034 13.2559 2.74414C13.0997 2.58794 12.8879 2.50009 12.667 2.5H6.5V5.5H13.5V3.33301ZM2.5 5.5H5.5V2.5H3.33301C3.11211 2.50009 2.90034 2.58794 2.74414 2.74414C2.58794 2.90034 2.50009 3.11211 2.5 3.33301V5.5ZM14.5 12.667C14.4999 13.1531 14.3066 13.6191 13.9629 13.9629C13.6191 14.3066 13.1531 14.4999 12.667 14.5H3.33301C2.8469 14.4999 2.38085 14.3066 2.03711 13.9629C1.69337 13.6192 1.50009 13.1531 1.5 12.667V3.33301C1.50009 2.8469 1.69337 2.38085 2.03711 2.03711C2.38085 1.69337 2.8469 1.50009 3.33301 1.5H12.667C13.1531 1.50009 13.6192 1.69337 13.9629 2.03711C14.3066 2.38085 14.4999 2.8469 14.5 3.33301V12.667Z" fill="currentColor"/>
								<path d="M7.64645 7.64645C7.84171 7.45118 8.15822 7.45118 8.35348 7.64645L12.3535 11.6464C12.5487 11.8417 12.5487 12.1582 12.3535 12.3535C12.1582 12.5487 11.8417 12.5487 11.6464 12.3535L7.64645 8.35348C7.45118 8.15822 7.45118 7.84171 7.64645 7.64645Z" fill="currentColor"/>
								<path d="M12.3536 7.64645C12.1583 7.45118 11.8418 7.45118 11.6465 7.64645L7.64652 11.6464C7.45126 11.8417 7.45126 12.1582 7.64652 12.3535C7.84178 12.5487 8.15829 12.5487 8.35355 12.3535L12.3536 8.35348C12.5488 8.15822 12.5488 7.84171 12.3536 7.64645Z" fill="currentColor"/>
							</svg>
						</button>
					{:else}
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
									<svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
										<path d="M7.6462 6.9796C7.84138 6.78442 8.15795 6.78459 8.35323 6.9796C8.5485 7.17486 8.5485 7.49137 8.35323 7.68663L6.03976 9.99913L8.35323 12.3126C8.5485 12.5079 8.5485 12.8254 8.35323 13.0206C8.15796 13.2155 7.84134 13.2157 7.6462 13.0206L5.33273 10.7071L3.02023 13.0206C2.82502 13.2156 2.5084 13.2156 2.31319 13.0206C2.11793 12.8254 2.11793 12.5079 2.31319 12.3126L4.62569 9.99913L2.31319 7.68663C2.11802 7.49136 2.11796 7.17483 2.31319 6.9796C2.50843 6.78446 2.82499 6.78446 3.02023 6.9796L5.33273 9.2921L7.6462 6.9796ZM12.8337 4.66808C12.8337 4.47382 12.7631 4.28543 12.6335 4.13683V4.13585C12.4966 3.98237 12.3111 3.8807 12.1081 3.84679C11.9037 3.81273 11.6936 3.84991 11.5134 3.95226C11.3349 4.05388 11.2035 4.21075 11.1374 4.39366C11.0437 4.6534 10.7565 4.78821 10.4968 4.69444C10.2371 4.60065 10.1023 4.31353 10.196 4.05382C10.3446 3.64247 10.6372 3.30011 11.0183 3.08312L11.0192 3.08214C11.3989 2.8665 11.8415 2.7887 12.2722 2.86046C12.6492 2.9233 12.9973 3.09754 13.2722 3.35948L13.3855 3.47667L13.3874 3.4796C13.6764 3.81098 13.8337 4.23306 13.8337 4.66808C13.8337 5.32084 13.4711 5.78303 13.0778 6.09874C12.6947 6.4063 12.2201 6.62482 11.8806 6.78526C11.5531 6.94003 11.4068 7.05762 11.322 7.18858C11.2762 7.25934 11.2371 7.35559 11.2087 7.50011H13.3337C13.6097 7.50028 13.8337 7.72407 13.8337 8.00011C13.8336 8.27608 13.6096 8.49993 13.3337 8.50011H10.6667C10.3906 8.50011 10.1668 8.27618 10.1667 8.00011C10.1667 7.46013 10.2439 7.01261 10.4821 6.64464C10.721 6.27566 11.075 6.05952 11.4528 5.88097C11.8187 5.70808 12.1781 5.53818 12.4519 5.31847C12.7153 5.10698 12.8337 4.90306 12.8337 4.66808Z" fill="currentColor"/>
									</svg>
								</button>
								<button class="bubble-btn" class:is-active={activeStates.subscript} onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().toggleSubscript().run(); }} title="Subscript">
									<svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
										<path d="M12.8337 9.33346C12.8337 9.14194 12.7646 8.95284 12.6384 8.80416C12.5008 8.64855 12.3139 8.54462 12.1091 8.51022C11.9047 8.47593 11.6949 8.51308 11.5144 8.61471L11.3903 8.70065C11.2746 8.79715 11.1869 8.92183 11.1374 9.061C11.0448 9.32108 10.7589 9.4572 10.4987 9.36471C10.2388 9.27206 10.1035 8.9861 10.196 8.72604C10.3434 8.31151 10.6362 7.96389 11.0183 7.74557L11.0202 7.74459C11.4007 7.5295 11.8441 7.45151 12.2751 7.52389C12.6522 7.58726 13.0002 7.76265 13.2751 8.02486L13.3884 8.14205L13.3923 8.14693C13.677 8.47758 13.8337 8.90025 13.8337 9.33346C13.8337 9.98081 13.4765 10.4413 13.0866 10.7573C12.7066 11.0653 12.2358 11.2847 11.8942 11.4458L11.8796 11.4526C11.5521 11.6071 11.4065 11.7244 11.322 11.8549C11.2763 11.9256 11.2371 12.0219 11.2087 12.1665H13.3337C13.6096 12.1666 13.8335 12.3906 13.8337 12.6665C13.8337 12.9425 13.6097 13.1663 13.3337 13.1665H10.6667C10.3906 13.1665 10.1667 12.9426 10.1667 12.6665C10.1667 12.127 10.2442 11.68 10.4821 11.312C10.721 10.9427 11.0752 10.7269 11.4538 10.5483L11.4675 10.5415C11.8311 10.37 12.1871 10.1985 12.4567 9.97994C12.7166 9.76934 12.8337 9.56665 12.8337 9.33346ZM7.6462 2.97994C7.84141 2.78473 8.15796 2.78484 8.35323 2.97994C8.5485 3.1752 8.5485 3.49171 8.35323 3.68697L6.03976 5.99947L8.35323 8.31295C8.5485 8.50821 8.5485 8.82472 8.35323 9.01998C8.15797 9.21524 7.84146 9.21524 7.6462 9.01998L5.33273 6.70651L3.02023 9.01998C2.82496 9.21524 2.50846 9.21524 2.31319 9.01998C2.1181 8.82471 2.11799 8.50816 2.31319 8.31295L4.62569 5.99947L2.31319 3.68697C2.11793 3.49171 2.11793 3.1752 2.31319 2.97994C2.50846 2.78468 2.82496 2.78468 3.02023 2.97994L5.33273 5.29244L7.6462 2.97994Z" fill="currentColor"/>
									</svg>
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

	/* Hover Link Popup */
	.hover-link-popup {
		position: absolute;
		z-index: 100;
		display: flex;
		align-items: center;
		background: var(--bg-focused, rgba(255, 255, 255, 0.98));
		border: 1px solid var(--dropdown-divider-bg, rgba(0, 0, 0, 0.1));
		border-radius: 8px;
		padding: 4px 8px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
		gap: 6px;
	}

	.hover-link-input {
		font-family: inherit;
		font-size: 13px;
		color: var(--color-text, #333);
		background: transparent;
		border: none;
		outline: none;
		padding: 4px 6px;
		width: 250px;
		border-radius: 4px;
		transition: background 0.15s ease;

		&:hover, &:focus {
			background: var(--dropdown-item-hover, rgba(0, 0, 0, 0.05));
		}
	}

	.hover-link-divider {
		width: 1px;
		height: 14px;
		background: var(--dropdown-divider-bg, rgba(0, 0, 0, 0.15));
	}

	.hover-link-remove {
		background: transparent;
		border: none;
		color: var(--color-text-muted, #666);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 4px;
		border-radius: 4px;
		transition: all 0.15s ease;

		&:hover {
			background: rgba(255, 0, 0, 0.1);
			color: #ff4444;
		}
	}
</style>
