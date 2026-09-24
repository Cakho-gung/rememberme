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
	import { TextStyle } from '@tiptap/extension-text-style';
	import { Color } from '@tiptap/extension-color';
	import Underline from '@tiptap/extension-underline';
	import Subscript from '@tiptap/extension-subscript';
	import Superscript from '@tiptap/extension-superscript';
	import TextAlign from '@tiptap/extension-text-align';
	import { MathExtension } from '@aarkue/tiptap-math-extension';
	import { fade, slide } from 'svelte/transition';
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
	import { ImageCopyExtension } from './ImageCopyExtension';
	import { FileTreeExtension } from './FileTreeExtension';
	import { CustomOrderedList } from './CustomOrderedList';
	import { isMac } from '$lib/osUtils';

	interface Props {
		noteId: string;
		content: object | string | null;
		onUpdate?: (content: object) => void;
		editor?: Editor;
	}

	let { noteId, content, onUpdate, editor = $bindable() }: Props = $props();

	let element = $state<HTMLElement>();
	let showContextMenu = $state(false);
	let contextMenuRawPos = $state({ top: 0, left: 0 }); // Mouse position
	let contextMenuPos = $state({ top: 0, left: 0 }); // Adjusted position
	let currentNoteId = $state<string>();
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
		bulletList: false,
		orderedList: false,
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
					autocorrect: 'off',
					autocapitalize: 'off',
					autocomplete: 'off',
				},
				scrollThreshold: { top: 0, bottom: 80, left: 0, right: 0 },
				scrollMargin: { top: 0, bottom: 80, left: 0, right: 0 },
				clipboardTextSerializer: (slice) => {
					return slice.content.textBetween(0, slice.content.size, '\n');
				},
			},
			extensions: [
				// Cấu hình StarterKit: Tắt codeBlock mặc định vì đã dùng lowlight, tắt orderedList mặc định để dùng CustomOrderedList
				StarterKit.configure({
					codeBlock: false,
					orderedList: false,
				}),
				CustomOrderedList,
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
				FileTreeExtension,
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
				ImageCopyExtension,
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
				GlobalShortcuts
			],
			content: content,
			onTransaction: ({ editor }) => {
				// Always update heading level (lightweight, needed by TOC/title)
				if (editor.isActive('heading', { level: 1 })) activeStates.headingLevel = 1;
				else if (editor.isActive('heading', { level: 2 })) activeStates.headingLevel = 2;
				else if (editor.isActive('heading', { level: 3 })) activeStates.headingLevel = 3;
				else if (editor.isActive('heading', { level: 4 })) activeStates.headingLevel = 4;
				else if (editor.isActive('heading', { level: 5 })) activeStates.headingLevel = 5;
				else if (editor.isActive('heading', { level: 6 })) activeStates.headingLevel = 6;
				else activeStates.headingLevel = 0;

				const { empty } = editor.state.selection;
				const isCellSelection = '$anchorCell' in editor.state.selection;
				activeStates.table = editor.isActive('table') && (empty || isCellSelection);

				// Full state refresh
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

				activeStates.bulletList = editor.isActive('bulletList');
				activeStates.orderedList = editor.isActive('orderedList');
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

		window.addEventListener('scroll', removeHeadingTooltip, true);
	});

	onDestroy(() => {
		window.removeEventListener('scroll', removeHeadingTooltip, true);
		removeHeadingTooltip();
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

	function getLinkEditorChain() {
		if (!editor) return null;
		let chain = editor.chain().focus();
		if (contextMenuLinkElement) {
			try {
				const pos = editor.view.posAtDOM(contextMenuLinkElement, 0);
				if (pos >= 0) chain = chain.setTextSelection(pos);
			} catch (e) {}
		}
		return chain;
	}

	function setLink() {
		if (!editor) return;
		const chain = getLinkEditorChain();
		if (!chain) return;

		originalLinkUrl = editor.getAttributes('link').href || contextMenuLinkHref || '';
		linkUrl = originalLinkUrl;
		showLinkInput = true;
		
		// Biến text thành link tạm thời để user nhìn thấy được highlight
		if (!editor.isActive('link') && !contextMenuLinkElement) {
			chain.extendMarkRange('link').setLink({ href: '' }).run();
		}
		
		setTimeout(() => linkInputEl?.focus(), 50);
	}

	function confirmLink() {
		const chain = getLinkEditorChain();
		if (!chain) return;
		showLinkInput = false;
		
		if (linkUrl === '') {
			chain.extendMarkRange('link').unsetLink().run();
			return;
		}

		chain.extendMarkRange('link').setLink({ href: linkUrl }).run();
	}
	
	function cancelLink() {
		const chain = getLinkEditorChain();
		if (!chain) return;
		showLinkInput = false;
		
		// Khôi phục lại trạng thái ban đầu
		if (originalLinkUrl === '') {
			chain.extendMarkRange('link').unsetLink().run();
		} else {
			chain.extendMarkRange('link').setLink({ href: originalLinkUrl }).run();
		}
	}

	// ── Context Menu Link State ──
	let contextMenuLinkElement = $state<HTMLElement | null>(null);
	let contextMenuLinkHref = $state('');

	function updateContextMenuLink(newUrl: string) {
		if (!editor || !contextMenuLinkElement) return;
		contextMenuLinkHref = newUrl;
		const pos = editor.view.posAtDOM(contextMenuLinkElement, 0);
		if (pos >= 0) {
			editor.chain().setTextSelection(pos).extendMarkRange('link').setLink({ href: newUrl }).run();
		}
	}

	function removeContextMenuLink() {
		if (!editor || !contextMenuLinkElement) return;
		const pos = editor.view.posAtDOM(contextMenuLinkElement, 0);
		if (pos >= 0) {
			editor.chain().focus().setTextSelection(pos).unsetLink().run();
		}
		showContextMenu = false;
	}

	// ── Heading Hover Tooltip ──
	let headingTooltipEl: HTMLElement | null = null;
	let headingTooltipTimer: ReturnType<typeof setTimeout> | null = null;
	let currentHoveredHeading: HTMLElement | null = null;

	function removeHeadingTooltip() {
		if (headingTooltipTimer) {
			clearTimeout(headingTooltipTimer);
			headingTooltipTimer = null;
		}
		if (headingTooltipEl) {
			const toRemove = headingTooltipEl;
			headingTooltipEl = null;
			currentHoveredHeading = null;
			toRemove.classList.remove('visible');
			setTimeout(() => toRemove.remove(), 130);
		}
	}

	function positionHeadingTooltip(heading: HTMLElement, tooltipEl: HTMLElement) {
		const rect = heading.getBoundingClientRect();
		const gap = 6;
		tooltipEl.style.left = '0px';
		tooltipEl.style.top = '0px';
		const tipW = tooltipEl.offsetWidth;
		const tipH = tooltipEl.offsetHeight;

		let top = rect.top - tipH - gap;
		let left = rect.left;

		if (top < 10) {
			top = rect.bottom + gap;
		}
		left = Math.max(8, Math.min(window.innerWidth - tipW - 8, left));

		tooltipEl.style.left = `${left}px`;
		tooltipEl.style.top = `${top}px`;
	}

	function handleEditorMouseOver(e: MouseEvent) {
		const target = e.target as HTMLElement;
		const heading = target?.closest?.('h1, h2, h3, h4, h5, h6') as HTMLElement | null;

		if (!heading || !element?.contains(heading)) {
			if (currentHoveredHeading && !heading) {
				removeHeadingTooltip();
			}
			return;
		}

		if (currentHoveredHeading === heading) return;
		removeHeadingTooltip();
		currentHoveredHeading = heading;

		const tag = heading.tagName.toLowerCase();
		const level = tag.replace('h', '');
		const headingText = `Heading ${level}`;

		headingTooltipTimer = setTimeout(() => {
			if (!currentHoveredHeading || currentHoveredHeading !== heading) return;

			const el = document.createElement('div');
			el.className = 'app-tooltip';
			el.textContent = headingText;
			document.body.appendChild(el);
			headingTooltipEl = el;

			positionHeadingTooltip(heading, el);
			void el.offsetWidth;
			el.classList.add('visible');
		}, 200);
	}

	function handleEditorMouseOut(e: MouseEvent) {
		const related = e.relatedTarget as HTMLElement | null;
		if (currentHoveredHeading && (!related || !currentHoveredHeading.contains(related))) {
			removeHeadingTooltip();
		}
	}
</script>

<svelte:window onmousedown={() => { if (showContextMenu) showContextMenu = false; }} />

<div class="text-editor-container">
	<!-- Text Editor Main Area -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_mouse_events_have_key_events -->
	<div 
		class="text-editor" 
		bind:this={element} 
		onmousedown={(e) => { removeHeadingTooltip(); showContextMenu = false; }}
		onkeydown={removeHeadingTooltip}
		oncontextmenu={(e) => {
			e.preventDefault();
			showContextMenu = true;
			showLinkInput = false;
			showMoreMenu = false;
			contextMenuRawPos = { top: e.clientY, left: e.clientX };
			
			const target = e.target as HTMLElement;
			const aTag = target.closest('a');
			if (aTag) {
				contextMenuLinkElement = aTag;
				contextMenuLinkHref = aTag.getAttribute('href') || '';
				originalLinkUrl = contextMenuLinkHref;
				linkUrl = contextMenuLinkHref;
				showLinkInput = true;
				setTimeout(() => linkInputEl?.focus(), 50);
			} else {
				contextMenuLinkElement = null;
				contextMenuLinkHref = '';
			}
		}}
	></div>
	

</div>

<script module>
	export function contextMenuAction(node: HTMLElement, { top, left }: { top: number, left: number }) {
		// Di chuyển menu ra ngoài body để không bị giới hạn bởi overflow: hidden hay transform của cha
		document.body.appendChild(node);

		function updatePos(y: number, x: number) {
			const rect = node.getBoundingClientRect();
			const vw = window.innerWidth;
			const vh = window.innerHeight;
			
			let adjustedLeft = x + 2;
			let adjustedTop = y + 2;

			// Check right and bottom bounds
			if (adjustedLeft + rect.width > vw) {
				adjustedLeft = vw - rect.width - 8;
			}
			if (adjustedTop + rect.height > vh) {
				adjustedTop = vh - rect.height - 8;
			}
			
			// Check left and top bounds
			if (adjustedLeft < 8) adjustedLeft = 8;
			if (adjustedTop < 8) adjustedTop = 8;
			
			// Ensure it doesn't exceed viewport height
			node.style.maxHeight = `${vh - 16}px`;
			
			node.style.left = `${adjustedLeft}px`;
			node.style.top = `${adjustedTop}px`;
		}
		
		// Run on next tick so DOM is fully rendered to measure width/height
		setTimeout(() => updatePos(top, left), 0);
		
		return {
			update(newParams: { top: number, left: number }) {
				updatePos(newParams.top, newParams.left);
			},
			destroy() {
				if (node.parentNode) {
					node.parentNode.removeChild(node);
				}
			}
		}
	}
</script>

<!-- Tiptap Context Menu Template -->
{#if showContextMenu}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div 
		class="context-menu" 
		style="position: fixed; top: -1000px; left: -1000px; z-index: 1000;"
		use:contextMenuAction={contextMenuRawPos}
		onmousedown={(e) => e.stopPropagation()}
	>
		{#if editor}
			<!-- Link Input Area -->
			{#if showLinkInput}
				<div transition:slide={{ duration: 150 }} style="display: flex; align-items: center; padding: 2px 4px; gap: 4px; border-bottom: 1px solid var(--dropdown-divider-bg, rgba(0, 0, 0, 0.1)); margin-bottom: 4px; overflow: hidden;">
					<input 
						bind:this={linkInputEl}
						style="flex: 1; width: auto;"
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
					<button class="bubble-btn" style="color: #ff4444;" onmousedown={(e) => { e.preventDefault(); getLinkEditorChain()?.extendMarkRange('link').unsetLink().run(); showContextMenu = false; }} title="Remove link">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
					</button>
				</div>
			{/if}

			{#if activeStates.image}
					<div class="menu-horizontal-row" style="margin-bottom: 4px;">
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
					</div>
					
					<div class="menu-horizontal-row">
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
				{:else if activeStates.table}
					<div class="menu-vertical-group">
						<button class="menu-list-item" onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().addRowAfter().run(); showContextMenu = false; }}>
							<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
								<path d="M13.5002 10C13.5002 9.90795 13.4253 9.83301 13.3332 9.83301H6.00021C5.90816 9.83301 5.83321 9.90795 5.83321 10V13.333C5.83321 13.4251 5.90816 13.5 6.00021 13.5H13.3332C13.4253 13.5 13.5002 13.4251 13.5002 13.333V10ZM0.979699 5.64648C1.17496 5.45122 1.49147 5.45122 1.68673 5.64648L3.68673 7.64648C3.88199 7.84175 3.88199 8.15825 3.68673 8.35352L1.68673 10.3535C1.49147 10.5488 1.17496 10.5488 0.979699 10.3535C0.784437 10.1583 0.784436 9.84175 0.979699 9.64648L2.62618 8L0.979699 6.35352C0.784436 6.15825 0.784436 5.84175 0.979699 5.64648ZM13.5002 2.66699C13.5002 2.57495 13.4253 2.5 13.3332 2.5H6.00021C5.90816 2.5 5.83321 2.57494 5.83321 2.66699V6C5.83321 6.09205 5.90816 6.16699 6.00021 6.16699H13.3332C13.4253 6.16699 13.5002 6.09205 13.5002 6V2.66699ZM14.5002 13.333C14.5002 13.9773 13.9775 14.5 13.3332 14.5H6.00021C5.35587 14.5 4.83321 13.9773 4.83321 13.333V10C4.83321 9.35567 5.35587 8.83301 6.00021 8.83301H13.3332C13.9775 8.83301 14.5002 9.35567 14.5002 10V13.333ZM14.5002 6C14.5002 6.64433 13.9775 7.16699 13.3332 7.16699H6.00021C5.35587 7.16699 4.83321 6.64433 4.83321 6V2.66699C4.83321 2.02266 5.35587 1.5 6.00021 1.5H13.3332C13.9775 1.5 14.5002 2.02266 14.5002 2.66699V6Z" fill="currentColor"/>
							</svg>
							<span>Add Row Below</span>
						</button>
						<button class="menu-list-item" onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().addColumnAfter().run(); showContextMenu = false; }}>
							<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
								<path d="M6.16699 6.00045C6.16699 5.9084 6.09205 5.83346 6 5.83346H2.66699C2.57494 5.83346 2.5 5.9084 2.5 6.00045V13.3335C2.5 13.4255 2.57495 13.5005 2.66699 13.5005H6C6.09205 13.5005 6.16699 13.4255 6.16699 13.3335V6.00045ZM13.5 6.00045C13.5 5.9084 13.4251 5.83346 13.333 5.83346H10C9.90795 5.83346 9.83301 5.9084 9.83301 6.00045V13.3335C9.83301 13.4255 9.90795 13.5005 10 13.5005H13.333C13.4251 13.5005 13.5 13.4255 13.5 13.3335V6.00045ZM9.64648 0.979943C9.84175 0.784681 10.1583 0.784681 10.3535 0.979943C10.5488 1.1752 10.5488 1.49171 10.3535 1.68697L8.35352 3.68697C8.15825 3.88224 7.84175 3.88224 7.64648 3.68697L5.64648 1.68697C5.45122 1.49171 5.45122 1.1752 5.64648 0.979943C5.84175 0.784681 6.15825 0.784681 6.35352 0.979943L8 2.62643L9.64648 0.979943ZM7.16699 13.3335C7.16699 13.9778 6.64433 14.5005 6 14.5005H2.66699C2.02266 14.5005 1.5 13.9778 1.5 13.3335V6.00045C1.5 5.35612 2.02266 4.83346 2.66699 4.83346H6C6.64433 4.83346 7.16699 5.35612 7.16699 6.00045V13.3335ZM14.5 13.3335C14.5 13.9778 13.9773 14.5005 13.333 14.5005H10C9.35567 14.5005 8.83301 13.9778 8.83301 13.3335V6.00045C8.83301 5.35612 9.35567 4.83346 10 4.83346H13.333C13.9773 4.83346 14.5 5.35612 14.5 6.00045V13.3335Z" fill="currentColor"/>
							</svg>
							<span>Add Col Right</span>
						</button>
						<button class="menu-list-item danger" onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().deleteRow().run(); showContextMenu = false; }}>
							<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
								<path d="M4.19238 10.4754C4.10513 10.4754 4.04337 10.5018 4.01269 10.524C4.00674 10.5284 4.00269 10.5323 4 10.5349L4 13.0174C4.00269 13.02 4.00668 13.0239 4.0127 13.0282C4.04334 13.0505 4.10505 13.0769 4.19238 13.0769L11.8076 13.0769C11.895 13.0769 11.9567 13.0505 11.9873 13.0282C11.9933 13.0239 11.9973 13.02 12 13.0174L12 10.5349C11.9973 10.5323 11.9933 10.5284 11.9873 10.524C11.9566 10.5018 11.8949 10.4754 11.8076 10.4754L4.19238 10.4754ZM4.19238 2.92308C4.10505 2.92308 4.04334 2.94955 4.01269 2.97175C4.00668 2.97613 4.00269 2.97996 4 2.98257L4 5.46514C4.00269 5.46775 4.00674 5.47163 4.01269 5.47596C4.04337 5.49816 4.10513 5.52464 4.19238 5.52464L11.8076 5.52464C11.8949 5.52464 11.9566 5.49816 11.9873 5.47596C11.9933 5.47163 11.9973 5.46775 12 5.46514L12 2.98257C11.9973 2.97996 11.9933 2.97613 11.9873 2.97175C11.9567 2.94955 11.895 2.92308 11.8076 2.92308L4.19238 2.92308ZM11.8076 9.55228C12.3485 9.55228 13 9.88828 13 10.5177L13 13.0346C13 13.664 12.3485 14 11.8076 14L4.19238 14C3.65154 14 3 13.664 3 13.0346L3 10.5177C3 9.88828 3.65153 9.55228 4.19238 9.55228L11.8076 9.55228ZM11.8076 2C12.3485 2 13 2.336 13 2.96544L13 5.48227C13 6.11172 12.3485 6.44772 11.8076 6.44772L4.19238 6.44772C3.65153 6.44772 3 6.11172 3 5.48227L3 2.96544C3 2.336 3.65153 2 4.19238 2L11.8076 2Z" fill="currentColor"/>
								<path d="M14.4615 8.46154L13.3846 8.46154C13.0872 8.46154 12.8462 8.2549 12.8462 8C12.8462 7.7451 13.0872 7.53846 13.3846 7.53846L14.4615 7.53846C14.7589 7.53846 15 7.7451 15 8C15 8.2549 14.7589 8.46154 14.4615 8.46154ZM11.2308 8.46154L9.07692 8.46154C8.77954 8.46154 8.53846 8.2549 8.53846 8C8.53846 7.7451 8.77954 7.53846 9.07692 7.53846L11.2308 7.53846C11.5282 7.53846 11.7692 7.7451 11.7692 8C11.7692 8.2549 11.5282 8.46154 11.2308 8.46154ZM6.92308 8.46154L4.76923 8.46154C4.47185 8.46154 4.23077 8.2549 4.23077 8C4.23077 7.7451 4.47185 7.53846 4.76923 7.53846L6.92308 7.53846C7.22046 7.53846 7.46154 7.7451 7.46154 8C7.46154 8.2549 7.22046 8.46154 6.92308 8.46154ZM2.61538 8.46154L1.53846 8.46154C1.24108 8.46154 1 8.2549 1 8C1 7.7451 1.24108 7.53846 1.53846 7.53846L2.61538 7.53846C2.91277 7.53846 3.15385 7.7451 3.15385 8C3.15385 8.2549 2.91277 8.46154 2.61538 8.46154Z" fill="currentColor"/>
							</svg>
							<span>Delete Row</span>
						</button>
						<button class="menu-list-item danger" onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().deleteColumn().run(); showContextMenu = false; }}>
							<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
								<path d="M5.52464 4.19238C5.52464 4.10513 5.49816 4.04337 5.47596 4.0127C5.47163 4.00674 5.46775 4.00269 5.46514 4H2.98257C2.97996 4.00269 2.97613 4.00668 2.97175 4.0127C2.94955 4.04334 2.92308 4.10505 2.92308 4.19238V11.8076C2.92308 11.895 2.94955 11.9567 2.97175 11.9873C2.97613 11.9933 2.97996 11.9973 2.98257 12H5.46514C5.46775 11.9973 5.47163 11.9933 5.47596 11.9873C5.49816 11.9566 5.52464 11.8949 5.52464 11.8076V4.19238ZM13.0769 4.19238C13.0769 4.10505 13.0505 4.04334 13.0282 4.0127C13.0239 4.00668 13.02 4.00269 13.0174 4H10.5349C10.5323 4.00269 10.5284 4.00674 10.524 4.0127C10.5018 4.04337 10.4754 4.10513 10.4754 4.19238V11.8076C10.4754 11.8949 10.5018 11.9566 10.524 11.9873C10.5284 11.9933 10.5323 11.9973 10.5349 12H13.0174C13.02 11.9973 13.0239 11.9933 13.0282 11.9873C13.0505 11.9567 13.0769 11.895 13.0769 11.8076V4.19238ZM6.44772 11.8076C6.44772 12.3485 6.11172 13 5.48227 13H2.96544C2.336 13 2 12.3485 2 11.8076V4.19238C2 3.65154 2.336 3 2.96544 3H5.48227C6.11172 3 6.44772 3.65153 6.44772 4.19238V11.8076ZM14 11.8076C14 12.3485 13.664 13 13.0346 13H10.5177C9.88828 13 9.55228 12.3485 9.55228 11.8076V4.19238C9.55228 3.65153 9.88828 3 10.5177 3H13.0346C13.664 3 14 3.65154 14 4.19238V11.8076Z" fill="currentColor"/>
								<path d="M7.53846 14.4615V13.3846C7.53846 13.0872 7.7451 12.8462 8 12.8462C8.2549 12.8462 8.46154 13.0872 8.46154 13.3846V14.4615C8.46154 14.7589 8.2549 15 8 15C7.7451 15 7.53846 14.7589 7.53846 14.4615ZM7.53846 11.2308V9.07692C7.53846 8.77954 7.7451 8.53846 8 8.53846C8.2549 8.53846 8.46154 8.77954 8.46154 9.07692L8.46154 11.2308C8.46154 11.5282 8.2549 11.7692 8 11.7692C7.7451 11.7692 7.53846 11.5282 7.53846 11.2308ZM7.53846 6.92308L7.53846 4.76923C7.53846 4.47185 7.7451 4.23077 8 4.23077C8.2549 4.23077 8.46154 4.47185 8.46154 4.76923V6.92308C8.46154 7.22046 8.2549 7.46154 8 7.46154C7.7451 7.46154 7.53846 7.22046 7.53846 6.92308ZM7.53846 2.61538V1.53846C7.53846 1.24108 7.7451 1 8 1C8.2549 1 8.46154 1.24108 8.46154 1.53846V2.61538C8.46154 2.91277 8.2549 3.15385 8 3.15385C7.7451 3.15385 7.53846 2.91277 7.53846 2.61538Z" fill="currentColor"/>
							</svg>
							<span>Delete Col</span>
						</button>
						<button class="menu-list-item danger" onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().deleteTable().run(); showContextMenu = false; }}>
							<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
								<path d="M13.5 6.5H6.5V13.5H12.667C12.8879 13.4999 13.0997 13.4121 13.2559 13.2559C13.4121 13.0997 13.4999 12.8879 13.5 12.667V6.5ZM2.5 12.667C2.50009 12.8879 2.58794 13.0997 2.74414 13.2559C2.90034 13.4121 3.11211 13.4999 3.33301 13.5H5.5V6.5H2.5V12.667ZM13.5 3.33301C13.4999 3.11211 13.4121 2.90034 13.2559 2.74414C13.0997 2.58794 12.8879 2.50009 12.667 2.5H6.5V5.5H13.5V3.33301ZM2.5 5.5H5.5V2.5H3.33301C3.11211 2.50009 2.90034 2.58794 2.74414 2.74414C2.58794 2.90034 2.50009 3.11211 2.5 3.33301V5.5ZM14.5 12.667C14.4999 13.1531 14.3066 13.6191 13.9629 13.9629C13.6191 14.3066 13.1531 14.4999 12.667 14.5H3.33301C2.8469 14.4999 2.38085 14.3066 2.03711 13.9629C1.69337 13.6192 1.50009 13.1531 1.5 12.667V3.33301C1.50009 2.8469 1.69337 2.38085 2.03711 2.03711C2.38085 1.69337 2.8469 1.50009 3.33301 1.5H12.667C13.1531 1.50009 13.6192 1.69337 13.9629 2.03711C14.3066 2.38085 14.4999 2.8469 14.5 3.33301V12.667Z" fill="currentColor"/>
								<path d="M7.64645 7.64645C7.84171 7.45118 8.15822 7.45118 8.35348 7.64645L12.3535 11.6464C12.5487 11.8417 12.5487 12.1582 12.3535 12.3535C12.1582 12.5487 11.8417 12.5487 11.6464 12.3535L7.64645 8.35348C7.45118 8.15822 7.45118 7.84171 7.64645 7.64645Z" fill="currentColor"/>
								<path d="M12.3536 7.64645C12.1583 7.45118 11.8418 7.45118 11.6465 7.64645L7.64652 11.6464C7.45126 11.8417 7.45126 12.1582 7.64652 12.3535C7.84178 12.5487 8.15829 12.5487 8.35355 12.3535L12.3536 8.35348C12.5488 8.15822 12.5488 7.84171 12.3536 7.64645Z" fill="currentColor"/>
							</svg>
							<span>Delete Table</span>
						</button>
					</div>
				{:else}
					<div class="menu-horizontal-row">
						<!-- Format Buttons Row -->
						<button class="bubble-btn" class:is-active={activeStates.bold} onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().toggleBold().run() }} title="Bold">
							<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 12a4 4 0 0 0 0-8H6v8"/><path d="M15 20a4 4 0 0 0 0-8H6v8Z"/></svg>
						</button>
						<button class="bubble-btn" class:is-active={activeStates.italic} onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().toggleItalic().run() }} title="Italic">
							<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="19" x2="10" y1="4" y2="4"/><line x1="14" x2="5" y1="20" y2="20"/><line x1="15" x2="9" y1="4" y2="20"/></svg>
						</button>
						<button class="bubble-btn" class:is-active={activeStates.underline} onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().toggleUnderline().run() }} title="Underline">
							<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4v6a6 6 0 0 0 12 0V4"/><line x1="4" x2="20" y1="20" y2="20"/></svg>
						</button>
						<button class="bubble-btn" class:is-active={activeStates.strike} onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().toggleStrike().run() }} title="Strikethrough">
							<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" x2="20" y1="12" y2="12"/></svg>
						</button>
						<button class="bubble-btn" class:is-active={activeStates.code} onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().toggleCode().run() }} title="Code">
							<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
						</button>
						<button class="bubble-btn" class:is-active={activeStates.link} onmousedown={(e) => { 
							e.preventDefault(); 
							if (showLinkInput) {
								cancelLink();
							} else {
								setLink();
							}
						}} title="Link">
							<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
						</button>
					</div>

					<div class="menu-vertical-group">
						<button class="menu-list-item" onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().toggleBulletList().run(); showContextMenu = false; }}>
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<line x1="9" x2="21" y1="6" y2="6"/>
								<line x1="9" x2="21" y1="12" y2="12"/>
								<line x1="9" x2="21" y1="18" y2="18"/>
								<circle cx="4" cy="6" r="1.5" fill="currentColor"/>
								<circle cx="4" cy="12" r="1.5" fill="currentColor"/>
								<circle cx="4" cy="18" r="1.5" fill="currentColor"/>
							</svg>
							<span>Bulleted List</span>
						</button>
						<button class="menu-list-item" onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().toggleOrderedList().run(); showContextMenu = false; }}>
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<line x1="10" x2="21" y1="6" y2="6"/>
								<line x1="10" x2="21" y1="12" y2="12"/>
								<line x1="10" x2="21" y1="18" y2="18"/>
								<path d="M4 6h1v4"/>
								<path d="M4 10h2"/>
								<path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>
							</svg>
							<span>Numbered List</span>
						</button>
						<button class="menu-list-item" onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().toggleTaskList().run(); showContextMenu = false; }}>
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<rect x="3" y="5" width="6" height="6" rx="1"/>
								<path d="m3 17 2 2 4-4"/>
								<path d="M13 6h8"/>
								<path d="M13 12h8"/>
								<path d="M13 18h8"/>
							</svg>
							<span>To-do List</span>
						</button>
					</div>

					<div class="menu-vertical-group">
						{#if contextMenuLinkElement}
							<button class="menu-list-item" onmousedown={async (e) => { 
								e.preventDefault(); 
								if (contextMenuLinkHref) await navigator.clipboard.writeText(contextMenuLinkHref);
								showContextMenu = false; 
							}}>
								<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
									<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
								</svg>
								<span>Copy Link</span>
							</button>
						{/if}

						<button class="menu-list-item" onmousedown={async (e) => { 
							e.preventDefault(); 
							const text = editor?.state.selection.empty ? editor.getText() : editor?.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, '\n');
							if (text) await navigator.clipboard.writeText(text);
							showContextMenu = false; 
						}}>
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
								<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
							</svg>
							<span>Copy as Markdown</span>
						</button>
						<button class="menu-list-item" onmousedown={async (e) => { 
							e.preventDefault(); 
							const html = editor?.getHTML();
							if (html) await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }) })]);
							showContextMenu = false; 
						}}>
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<polyline points="16 18 22 12 16 6"></polyline>
								<polyline points="8 6 2 12 8 18"></polyline>
							</svg>
							<span>Copy as HTML</span>
						</button>
					</div>
				{/if}
		{/if}
	</div>
{/if}


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

	.context-menu {
		display: flex;
		flex-direction: column;
		width: 220px;
		max-height: 400px;
		overflow-y: auto;
		background: var(--bg-focused, rgba(255, 255, 255, 0.98));
		border-radius: 8px;
		border: 1px solid var(--dropdown-divider-bg, rgba(0, 0, 0, 0.1));
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
		padding: 6px;
		gap: 6px;
	}

	.menu-horizontal-row {
		display: flex;
		flex-direction: row;
		align-items: center;
		flex-wrap: wrap;
		gap: 4px;
	}

	.menu-vertical-group {
		display: flex;
		flex-direction: column;
		border-top: 1px solid var(--dropdown-divider-bg, rgba(0, 0, 0, 0.1));
		padding-top: 4px;
		gap: 2px;
	}

	.menu-list-item {
		display: flex;
		align-items: center;
		width: 100%;
		padding: 6px 8px;
		background: transparent;
		border: none;
		border-radius: 4px;
		color: var(--color-text, #333);
		font-family: inherit;
		font-size: 13.5px;
		cursor: pointer;
		text-align: left;
		transition: background 0.15s ease;
		
		svg {
			margin-right: 8px;
			color: var(--color-text-muted, #666);
		}

		&:hover {
			background: var(--dropdown-item-hover, rgba(0, 0, 0, 0.05));
		}

		&.danger {
			color: #ff4444;
			svg {
				color: #ff4444;
			}
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
