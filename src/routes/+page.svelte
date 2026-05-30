<script lang="ts">
  import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
  import { fade } from 'svelte/transition';
  import { onMount } from 'svelte';
  import Editor from '$lib/components/Editor.svelte';
  import Lightbox from '$lib/components/Lightbox.svelte';
  import { loadNotes, saveNotes, type Note } from '$lib/db';
  
  import 'highlight.js/styles/tokyo-night-dark.css';
  import 'katex/dist/katex.min.css';

  // -- Menu & Editing State --
  let isMenuOpen = $state(false);
  let isEditingTitle = $state(false);
  let titleEditValue = $state('');

  function focus(node: HTMLElement) {
    node.focus();
  }

  let isPinned = $state(true);

  async function closeApp() {
    const appWindow = getCurrentWindow();
    await appWindow.hide();
    isMenuOpen = false;
  }

  async function togglePin() {
    isPinned = !isPinned;
    const appWindow = getCurrentWindow();
    await appWindow.setAlwaysOnTop(isPinned);
    isMenuOpen = false;
  }

  function handleSettings() {
    console.log('Settings clicked');
    isMenuOpen = false;
  }

  async function startDragging(e: PointerEvent) {
    // Only initiate drag on left mouse button
    if (e.button !== 0) return;
    
    // Do not drag if clicking on interactive elements
    const target = e.target as HTMLElement;
    if (target.closest('button, input, textarea, .text-editor, .dropdown-item, .title-text-btn, .close-dot, .ProseMirror, .toolbar')) {
      return;
    }
    
    const appWindow = getCurrentWindow();
    await appWindow.startDragging();
  }

  function toggleMenu() {
    isMenuOpen = !isMenuOpen;
  }

  function createNewNote() {
    const newId = Math.max(0, ...mockNotes.map(n => n.id)) + 1;
    mockNotes = [...mockNotes, {
      id: newId,
      title: 'New Note',
      archived: false,
      content: '<p></p>'
    }];
    activeNoteId = newId;
    isMenuOpen = false;
    scheduleSave();
    editTitle();
  }

  function editTitle() {
    if (!activeNote) return;
    isEditingTitle = true;
    titleEditValue = activeNote.title;
    isMenuOpen = false;
  }

  function saveTitle() {
    const note = mockNotes.find(n => n.id === activeNoteId);
    if (note && titleEditValue.trim() !== '') {
      note.title = titleEditValue;
      scheduleSave();
    }
    isEditingTitle = false;
  }

  function handleTitleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      isEditingTitle = false;
    } else if (e.key === 'Enter') {
      saveTitle();
    }
  }

  function archiveNote() {
    const note = mockNotes.find(n => n.id === activeNoteId);
    if (note) {
      note.archived = true;
      scheduleSave();
      // Select next unarchived
      const nextUnarchived = mockNotes.find(n => !n.archived);
      if (nextUnarchived) {
        activeNoteId = nextUnarchived.id;
      }
    }
    isMenuOpen = false;
  }

  function archiveNoteById(e: Event, id: number) {
    e.stopPropagation();
    const note = mockNotes.find(n => n.id === id);
    if (note) {
      note.archived = true;
      scheduleSave();
    }
  }

  // -- Interaction State --
  let isCollapsed = $state(false);
  let isDropdownOpen = $state(false);

  // -- Drag to Select Tool State --
  let isDotDragging = $state(false);
  let wasDragging = false;
  let dotStartX = $state(0);
  let dotStartY = $state(0);
  let currentPointerX = $state(0);
  let currentPointerY = $state(0);
  let hoveredToolAction = $state<string | null>(null);

  function cleanupDotDragging(target: HTMLElement, pointerId: number) {
    target.removeEventListener('pointermove', onDotPointerMove);
    target.removeEventListener('pointerup', onDotPointerUp);
    target.removeEventListener('pointercancel', onDotPointerCancel);
    target.removeEventListener('lostpointercapture', onDotPointerCancel);
    try {
      target.releasePointerCapture(pointerId);
    } catch (e) {
      // ignore
    }
  }

  function onDotPointerCancel(e: PointerEvent) {
    const target = e.currentTarget as HTMLElement;
    cleanupDotDragging(target, e.pointerId);
    
    isDotDragging = false;
    hoveredToolAction = null;
    isMenuOpen = false;
  }

  let isWindowFocused = $state(true);

  function handleWindowBlur() {
    isDotDragging = false;
    hoveredToolAction = null;
    isMenuOpen = false;
    isWindowFocused = false;
  }

  function handleWindowFocus() {
    isWindowFocused = true;
  }

  function onDotPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    
    const rect = target.getBoundingClientRect();
    dotStartX = rect.left + rect.width / 2;
    dotStartY = rect.top + rect.height / 2;
    currentPointerX = e.clientX;
    currentPointerY = e.clientY;
    wasDragging = false;
    hoveredToolAction = null;
    
    target.addEventListener('pointermove', onDotPointerMove);
    target.addEventListener('pointerup', onDotPointerUp);
    target.addEventListener('pointercancel', onDotPointerCancel);
    target.addEventListener('lostpointercapture', onDotPointerCancel);
  }

  function onDotPointerMove(e: PointerEvent) {
    const dx = Math.abs(e.clientX - dotStartX);
    const dy = Math.abs(e.clientY - dotStartY);
    
    if (!isDotDragging && (dx > 5 || dy > 5)) {
      isDotDragging = true;
      wasDragging = true;
      if (!isMenuOpen) isMenuOpen = true;
    }
    
    if (isDotDragging) {
      currentPointerX = e.clientX;
      currentPointerY = e.clientY;
      
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const toolBtn = el?.closest('.tool-btn') as HTMLElement;
      if (toolBtn && toolBtn.dataset.action) {
        hoveredToolAction = toolBtn.dataset.action;
      } else {
        hoveredToolAction = null;
      }
    }
  }

  function onDotPointerUp(e: PointerEvent) {
    const target = e.currentTarget as HTMLElement;
    cleanupDotDragging(target, e.pointerId);
    
    if (isDotDragging) {
      isDotDragging = false;
      const action = hoveredToolAction;
      hoveredToolAction = null;
      
      if (action) {
        if (action === 'create') createNewNote();
        else if (action === 'edit') editTitle();
        else if (action === 'archive') archiveNote();
        else if (action === 'pin') togglePin();
        else if (action === 'settings') handleSettings();
        else if (action === 'exit') closeApp();
      }
      isMenuOpen = false;
    }
  }

  function handleDotClick() {
    if (wasDragging) {
      wasDragging = false;
      return;
    }
    toggleMenu();
  }

  let previousSize = { width: 800, height: 600 };

  // -- Notes State --
  let isLoading = $state(true);
  let mockNotes = $state<Note[]>([]);
  let activeNoteId = $state(0);
  let saveTimeout: ReturnType<typeof setTimeout>;

  function scheduleSave() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      saveNotes(mockNotes);
    }, 500);
  }

  onMount(async () => {
    const notes = await loadNotes();
    if (notes.length > 0) {
      mockNotes = notes;
      // Select the first non-archived note
      const first = mockNotes.find(n => !n.archived);
      if (first) activeNoteId = first.id;
    } else {
      mockNotes = [{
        id: 1,
        title: 'Welcome to RememberMe',
        archived: false,
        content: `<h1>Welcome to RememberMe! 🚀</h1>
<p>Here is a guide to all the syntaxes and features supported in this editor:</p>
<hr>
<h3>1. Slash Commands</h3>
<p>Type <code>/</code> on a new line to open the slash menu. You can quickly insert Headings, Lists, Tables, Code Blocks, and more.</p>
<h3>2. Text Formatting</h3>
<ul>
  <li><strong>Bold</strong>: <code>**text**</code> or <kbd>Ctrl</kbd> + <kbd>B</kbd></li>
  <li><em>Italic</em>: <code>*text*</code> or <kbd>Ctrl</kbd> + <kbd>I</kbd></li>
  <li><s>Strikethrough</s>: <code>~~text~~</code></li>
  <li><code>Inline Code</code>: <code>\`text\`</code></li>
  <li>Color Highlight: Select text and click the pink dot in the popup menu.</li>
</ul>
<h3>3. Lists & Tasks</h3>
<ul>
  <li><strong>Bullet List</strong>: Type <code>*</code> or <code>-</code> followed by a space.</li>
  <li><strong>Numbered List</strong>: Type <code>1.</code> followed by a space.</li>
  <li><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><strong>Task List</strong>: Type <code>[ ]</code> followed by a space.</li><li data-type="taskItem" data-checked="true">Checked task!</li></ul></li>
</ul>
<h3>4. Blocks</h3>
<blockquote><p><strong>Blockquote</strong>: Type <code>&gt;</code> followed by a space.</p></blockquote>
<pre><code class="language-javascript">// Code Block: Type \`\`\` (3 backticks) and press Space or Enter
function sayHi() {
  console.log("Hello!");
}</code></pre>
<h3>5. Tables</h3>
<p>Use the Slash command <code>/table</code> to insert a table. Click inside the table to reveal the popup menu to add/remove rows and columns.</p>
<h3>6. Images</h3>
<p>You can <strong>Copy &amp; Paste</strong> images directly into the editor! Click an image to resize it or float it left/right using the popup menu.</p>
<h3>7. Links & Mentions</h3>
<p>Select text and click the 🔗 icon in the popup to add a link. Type <code>@</code> to open the mention menu.</p>
<h3>8. Math Equations</h3>
<p>Type <code>$E=mc^2$</code> to write inline math, or <code>$$</code> for block equations.</p>
<h3>9. Smart Typography</h3>
<p>Special characters are automatically formatted! Try typing <code>(c)</code>, <code>(r)</code>, <code>(tm)</code>, <code>-&gt;</code>, or <code>--</code>.</p>
`
      }];
      activeNoteId = 1;
      await saveNotes(mockNotes);
    }
    isLoading = false;
  });

  let activeNote = $derived(mockNotes.find(n => n.id === activeNoteId && !n.archived) || mockNotes.find(n => !n.archived));

  function selectNote(id: number) {
    activeNoteId = id;
    isDropdownOpen = false;
  }

  // Smart Drag vs Click handling
  let dragStartX = 0;
  let dragStartY = 0;
  let isPointerDown = false;

  function onTitlePointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    isPointerDown = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
  }

  async function onTitlePointerMove(e: PointerEvent) {
    if (!isPointerDown) return;
    const dx = Math.abs(e.clientX - dragStartX);
    const dy = Math.abs(e.clientY - dragStartY);
    
    // If dragged more than 3 pixels, initiate Tauri window drag
    if (dx > 3 || dy > 3) {
      isPointerDown = false;
      const el = e.currentTarget as HTMLElement;
      el.releasePointerCapture(e.pointerId);
      
      const appWindow = getCurrentWindow();
      await appWindow.startDragging();
    }
  }

  function onTitlePointerUp(e: PointerEvent) {
    if (!isPointerDown) return;
    isPointerDown = false;
    const el = e.currentTarget as HTMLElement;
    el.releasePointerCapture(e.pointerId);
    
    // It was a click (didn't move much)
    toggleDropdown();
  }

  async function toggleCollapse() {
    const appWindow = getCurrentWindow();
    isCollapsed = !isCollapsed;
    
    if (isCollapsed) {
      const size = await appWindow.innerSize();
      const scale = await appWindow.scaleFactor();
      const w = size.width / scale;
      const h = size.height / scale;
      if (h > 60) {
        previousSize = { width: w, height: h };
      } else {
        // Even if already short, update width in case they resized horizontally
        previousSize.width = w;
      }
      
      isDropdownOpen = false; // close dropdown when collapsing
      
      // Update min size to allow shrinking (48 + 9 = 57 for height)
      await appWindow.setMinSize(new LogicalSize(356, 57));
      await appWindow.setSize(new LogicalSize(previousSize.width, 57));
      // Lock max height to 57px so Windows cannot bounce it back
      await appWindow.setMaxSize(new LogicalSize(9999, 57));
    } else {
      // Remove max height constraint by setting it to a very large value instead of null
      await appWindow.setMaxSize(new LogicalSize(9999, 9999));
      // Get the current width of the window (in case they resized it while collapsed)
      const size = await appWindow.innerSize();
      const scale = await appWindow.scaleFactor();
      const currentWidth = size.width / scale;
      
      // If the width drifted by just a few pixels, ignore the drift to prevent creeping
      const widthToRestore = Math.abs(currentWidth - previousSize.width) < 5 
        ? previousSize.width 
        : currentWidth;
        
      // Restore previous size (ensure it is at least 249px tall, 240 + 9)
      const targetHeight = Math.max(249, previousSize.height);
      await appWindow.setSize(new LogicalSize(widthToRestore, targetHeight));
      // Restore normal min size
      await appWindow.setMinSize(new LogicalSize(356, 249));
    }
  }

  function toggleDropdown() {
    if (isCollapsed) return; // Don't open dropdown if collapsed
    isDropdownOpen = !isDropdownOpen;
  }
</script>

<svelte:window onblur={handleWindowBlur} onfocus={handleWindowFocus} />

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<main class="app-container" onpointerdown={startDragging}>
  <div class="glass-widget" class:collapsed={isCollapsed} style="background: {isWindowFocused ? 'var(--bg-focused)' : 'var(--bg-unfocused)'}; transition: background-color 0.5s ease;">

    <!-- Main inner column: Title + Editor + Timer -->
    <div class="inner-column">

      <!-- Title section -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="title-section {isDropdownOpen ? 'expanded' : ''}">
        <!-- First title row (visible) -->
        <div class="title-row">
          <!-- Title text (draggable button when not editing, input when editing) -->
          {#if isEditingTitle}
            <div class="title-text-btn">
              <input 
                type="text" 
                class="title-input" 
                bind:value={titleEditValue}
                onkeydown={handleTitleKeyDown}
                onblur={saveTitle}
                use:focus
              />
            </div>
          {:else}
            <button 
              class="title-text-btn" 
              onpointerdown={onTitlePointerDown}
              onpointermove={onTitlePointerMove}
              onpointerup={onTitlePointerUp}
            >
              <span class="title-text">{activeNote?.title || 'No note selected'}</span>
            </button>
          {/if}

          <!-- Chevron icon for collapse/expand -->
          <button class="title-icon-btn" onclick={toggleCollapse} aria-label="Toggle Collapse">
            <svg class="title-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              {#if isCollapsed}
                <!-- Expand icon -->
                <path d="M15.1896 13.4125C15.4314 13.1858 15.8106 13.1981 16.0373 13.4398C16.2639 13.6816 16.2517 14.0608 16.0099 14.2875L12.0099 18.0375C11.7791 18.2538 11.4204 18.2538 11.1896 18.0375L7.18963 14.2875C6.94788 14.0608 6.93565 13.6816 7.16229 13.4398C7.38892 13.1981 7.7682 13.1858 8.00994 13.4125L11.5998 16.7777L15.1896 13.4125ZM11.2814 5.09117C11.5079 4.94917 11.808 4.97313 12.0099 5.16246L16.0099 8.91246C16.2517 9.1391 16.2639 9.51837 16.0373 9.76012C15.8106 10.0019 15.4314 10.0141 15.1896 9.78746L11.5998 6.42125L8.00994 9.78746C7.7682 10.0141 7.38892 10.0019 7.16229 9.76012C6.93565 9.51837 6.94788 9.1391 7.18963 8.91246L11.1896 5.16246L11.2814 5.09117Z" fill="currentColor"/>
              {:else}
                <!-- Collapse icon -->
                <path d="M11.2814 12.341C11.5079 12.199 11.808 12.223 12.0099 12.4123L16.0099 16.1623C16.2517 16.3889 16.2639 16.7682 16.0373 17.0099C15.8106 17.2517 15.4314 17.2639 15.1896 17.0373L11.5998 13.6711L8.00994 17.0373C7.7682 17.2639 7.38892 17.2517 7.16229 17.0099C6.93565 16.7682 6.94788 16.3889 7.18963 16.1623L11.1896 12.4123L11.2814 12.341ZM15.1896 6.16229C15.4314 5.93565 15.8106 5.94788 16.0373 6.18963C16.2639 6.43138 16.2517 6.81065 16.0099 7.03729L12.0099 10.7873C11.7791 11.0037 11.4204 11.0037 11.1896 10.7873L7.18963 7.03729C6.94788 6.81065 6.93565 6.43138 7.16229 6.18963C7.38892 5.94788 7.7682 5.93565 8.00994 6.16229L11.5998 9.52752L15.1896 6.16229Z" fill="currentColor"/>
              {/if}
            </svg>
          </button>
          
        </div>

        <!-- Dropdown Notes List -->
        {#if isDropdownOpen && !isCollapsed}
          {#each [...mockNotes].reverse() as note}
            {#if note.id !== activeNoteId && !note.archived}
              <div class="dropdown-divider"></div>
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div class="dropdown-item" onclick={() => selectNote(note.id)}>
                <button class="archive-item-btn" onclick={(e) => archiveNoteById(e, note.id)} aria-label="Archive Note">
                  <svg class="item-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12.8333 5.83301H3.16626V12.667C3.16635 12.8878 3.2543 13.0997 3.4104 13.2559C3.56668 13.4121 3.77923 13.5 4.00024 13.5H12.0002C12.2211 13.4999 12.4329 13.4121 12.5891 13.2559C12.7453 13.0997 12.8332 12.8879 12.8333 12.667V5.83301ZM9.33325 7.5C9.60939 7.5 9.83325 7.72386 9.83325 8C9.83325 8.27614 9.60939 8.5 9.33325 8.5H6.66626C6.39027 8.49982 6.16626 8.27603 6.16626 8C6.16626 7.72397 6.39027 7.50018 6.66626 7.5H9.33325ZM14.1663 2.66699C14.1663 2.57505 14.0921 2.50018 14.0002 2.5H2.00024C1.9082 2.5 1.83325 2.57494 1.83325 2.66699V4.66699C1.83343 4.75889 1.90831 4.83301 2.00024 4.83301H14.0002C14.092 4.83283 14.1661 4.75878 14.1663 4.66699V2.66699ZM15.1663 4.66699C15.1661 5.31107 14.6443 5.83283 14.0002 5.83301H13.8333V12.667C13.8332 13.1531 13.6399 13.6192 13.2961 13.9629C12.9524 14.3066 12.4864 14.4999 12.0002 14.5H4.00024C3.51401 14.5 3.04719 14.3067 2.70337 13.9629C2.35973 13.6192 2.16635 13.153 2.16626 12.667V5.83301H2.00024C1.35602 5.83301 0.833428 5.31117 0.833252 4.66699V2.66699C0.833252 2.02266 1.35591 1.5 2.00024 1.5H14.0002C14.6444 1.50018 15.1663 2.02277 15.1663 2.66699V4.66699Z" fill="currentColor"/>
                  </svg>
                </button>
                <span class="item-text">{note.title}</span>
              </div>
            {/if}
          {/each}
        {/if}
      </div>

      {#if !isCollapsed}
        <!-- Text editor area -->
        <div class="text-editor">
          {#if !isLoading && activeNote}
            <Editor 
              noteId={activeNote.id}
              content={activeNote.content}
              onUpdate={(content) => {
                if (activeNote) {
                  activeNote.content = content;
                  scheduleSave();
                }
              }} 
            />
          {/if}
        </div>

        <!-- Timer row: aligned to right -->
        <div class="timer-row">
          <button class="timer-btn" aria-label="Timer">
            <!-- lucide/timer icon -->
            <svg class="tool-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
              <path d="M12.8335 8.5332C12.8335 5.86383 10.6689 3.69922 7.99951 3.69922C5.33029 3.69939 3.1665 5.86393 3.1665 8.5332C3.16661 11.2024 5.33035 13.366 7.99951 13.3662C10.6688 13.3662 12.8334 11.2025 12.8335 8.5332ZM9.646 6.17969C9.84124 5.98445 10.1578 5.98449 10.353 6.17969C10.5483 6.37495 10.5483 6.69146 10.353 6.88672L8.35303 8.88672C8.15774 9.08172 7.84117 9.08189 7.646 8.88672C7.45089 8.69154 7.45102 8.37495 7.646 8.17969L9.646 6.17969ZM9.3335 0.833008C9.60949 0.833184 9.8335 1.05697 9.8335 1.33301C9.8335 1.60904 9.60949 1.83283 9.3335 1.83301H6.6665C6.39036 1.83301 6.1665 1.60915 6.1665 1.33301C6.1665 1.05687 6.39036 0.833008 6.6665 0.833008H9.3335ZM13.8335 8.5332C13.8334 11.7548 11.2211 14.3662 7.99951 14.3662C4.77807 14.366 2.16661 11.7547 7.99951 8.5332C2.1665 5.31165 4.778 2.69939 7.99951 2.69922C11.2212 2.69922 13.8335 5.31154 13.8335 8.5332Z" fill="currentColor"/>
            </svg>
          </button>
        </div>
      {/if}
    </div>

    <!-- Menu dot: absolute top-right -->
    <button class="close-dot {isMenuOpen ? 'active' : ''}" aria-label="Menu" onpointerdown={onDotPointerDown} onclick={handleDotClick}></button>
    
    <!-- Overlay Menu -->
    {#if isMenuOpen}
      <div class="menu-overlay" out:fade={{ duration: 150 }}>
        <!-- Close dot replica for closing menu without layout shift, though original is above it -->
        <div class="toolbar">
          <button class="tool-btn delay-5" class:drag-hover={hoveredToolAction === 'create'} data-action="create" onclick={createNewNote} aria-label="Create Note">
            <svg class="tool-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
              <path d="M7.50024 12.6665V8.50049H3.33325C3.05722 8.50049 2.83343 8.27648 2.83325 8.00049C2.83325 7.72435 3.05711 7.50049 3.33325 7.50049H7.50024V3.3335C7.50024 3.05735 7.7241 2.8335 8.00024 2.8335C8.27624 2.83367 8.50024 3.05746 8.50024 3.3335V7.50049H12.6663C12.9424 7.50049 13.1663 7.72435 13.1663 8.00049C13.1661 8.27648 12.9423 8.50049 12.6663 8.50049H8.50024V12.6665C8.50024 12.9425 8.27624 13.1663 8.00024 13.1665C7.7241 13.1665 7.50024 12.9426 7.50024 12.6665Z" fill="currentColor"/>
            </svg>
          </button>
          <button class="tool-btn delay-4" class:drag-hover={hoveredToolAction === 'edit'} data-action="edit" onclick={editTitle} aria-label="Edit Title">
            <svg class="tool-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
              <path d="M13.5002 3.69092C13.5002 3.37499 13.3749 3.07157 13.1515 2.84814C12.9281 2.62476 12.6247 2.49955 12.3087 2.49951C11.993 2.49953 11.6903 2.625 11.4669 2.84814L3.45816 10.8589C3.37707 10.9399 3.31695 11.0394 3.28336 11.1489L2.59976 13.3989L4.85269 12.7163C4.9623 12.683 5.06257 12.6234 5.14371 12.5425L13.1515 4.53369C13.3749 4.3103 13.5001 4.00686 13.5002 3.69092ZM13.4005 12.8999C13.6765 12.9001 13.9005 13.1239 13.9005 13.3999C13.9005 13.6759 13.6765 13.8997 13.4005 13.8999H8.59976C8.32381 13.8997 8.09976 13.6759 8.09976 13.3999C8.09981 13.1239 8.32384 12.9001 8.59976 12.8999H13.4005ZM14.5002 3.69092C14.5001 4.27203 14.2695 4.82983 13.8586 5.24072L5.84976 13.2505C5.70201 13.3978 5.52864 13.5169 5.33902 13.6011L5.14371 13.6733L2.5314 14.4653C2.39309 14.5069 2.2447 14.5103 2.10464 14.4751C1.9648 14.4398 1.83661 14.368 1.73453 14.2661C1.63237 14.1641 1.56002 14.0359 1.52457 13.896C1.48913 13.756 1.492 13.6086 1.53336 13.4702L1.53433 13.4683L2.3273 10.8569C2.409 10.5905 2.55475 10.3467 2.75211 10.1499L10.7589 2.14111C11.1698 1.73043 11.7278 1.49953 12.3087 1.49951C12.8898 1.49958 13.4477 1.73022 13.8586 2.14111C14.2694 2.55207 14.5002 3.10982 14.5002 3.69092Z" fill="currentColor"/>
            </svg>
          </button>
          <button class="tool-btn delay-3" class:drag-hover={hoveredToolAction === 'archive'} data-action="archive" onclick={archiveNote} aria-label="Archive Note">
            <svg class="tool-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
              <path d="M12.8333 5.83301H3.16626V12.667C3.16635 12.8878 3.2543 13.0997 3.4104 13.2559C3.56668 13.4121 3.77923 13.5 4.00024 13.5H12.0002C12.2211 13.4999 12.4329 13.4121 12.5891 13.2559C12.7453 13.0997 12.8332 12.8879 12.8333 12.667V5.83301ZM9.33325 7.5C9.60939 7.5 9.83325 7.72386 9.83325 8C9.83325 8.27614 9.60939 8.5 9.33325 8.5H6.66626C6.39027 8.49982 6.16626 8.27603 6.16626 8C6.16626 7.72397 6.39027 7.50018 6.66626 7.5H9.33325ZM14.1663 2.66699C14.1663 2.57505 14.0921 2.50018 14.0002 2.5H2.00024C1.9082 2.5 1.83325 2.57494 1.83325 2.66699V4.66699C1.83343 4.75889 1.90831 4.83301 2.00024 4.83301H14.0002C14.092 4.83283 14.1661 4.75878 14.1663 4.66699V2.66699ZM15.1663 4.66699C15.1661 5.31107 14.6443 5.83283 14.0002 5.83301H13.8333V12.667C13.8332 13.1531 13.6399 13.6192 13.2961 13.9629C12.9524 14.3066 12.4864 14.4999 12.0002 14.5H4.00024C3.51401 14.5 3.04719 14.3067 2.70337 13.9629C2.35973 13.6192 2.16635 13.153 2.16626 12.667V5.83301H2.00024C1.35602 5.83301 0.833428 5.31117 0.833252 4.66699V2.66699C0.833252 2.02266 1.35591 1.5 2.00024 1.5H14.0002C14.6444 1.50018 15.1663 2.02277 15.1663 2.66699V4.66699Z" fill="currentColor"/>
            </svg>
          </button>
          <button class="tool-btn delay-2 {isPinned ? 'active-tool' : ''}" class:drag-hover={hoveredToolAction === 'pin'} data-action="pin" onclick={togglePin} aria-label="Pin">
            {#if isPinned}
              <svg class="tool-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                <path d="M11.5005 2.66602C11.5004 2.4452 11.4124 2.23334 11.2563 2.07715C11.1001 1.92087 10.8875 1.83301 10.6665 1.83301H5.3335C5.11256 1.83301 4.90089 1.92097 4.74463 2.07715C4.58843 2.23335 4.50057 2.44512 4.50049 2.66602C4.50049 2.88703 4.58835 3.09958 4.74463 3.25586C4.90088 3.41194 5.11264 3.5 5.3335 3.5C5.64292 3.5 5.9399 3.623 6.15869 3.8418C6.3772 4.06048 6.5004 4.35687 6.50049 4.66602V7.17285C6.50031 7.51393 6.40485 7.8488 6.2251 8.13867C6.04536 8.4285 5.78831 8.66268 5.48291 8.81445L5.48193 8.81348L4.29932 9.41211L4.29639 9.41406C4.15755 9.48305 4.0402 9.58992 3.9585 9.72168C3.87695 9.85335 3.83358 10.0053 3.8335 10.1602V10.666C3.8335 10.7102 3.85107 10.7529 3.88232 10.7842C3.91358 10.8154 3.95629 10.833 4.00049 10.833H12.0005C12.0445 10.8329 12.0865 10.8153 12.1177 10.7842C12.1489 10.7529 12.1665 10.7102 12.1665 10.666V10.1602C12.1664 10.0052 12.1231 9.85338 12.0415 9.72168C11.9598 9.58998 11.8433 9.48305 11.7046 9.41406L11.7017 9.41211L10.5142 8.8125V8.81152C10.2105 8.65975 9.95487 8.42717 9.77588 8.13867C9.59613 7.8488 9.50067 7.51393 9.50049 7.17285V4.66602C9.50057 4.35671 9.62357 4.06051 9.84229 3.8418C10.061 3.62308 10.3572 3.50009 10.6665 3.5C10.8875 3.5 11.1001 3.41214 11.2563 3.25586C11.4126 3.09958 11.5005 2.88703 11.5005 2.66602ZM12.5005 2.66602C12.5005 3.15225 12.3072 3.61907 11.9634 3.96289C11.6196 4.30671 11.1527 4.5 10.6665 4.5C10.6224 4.50009 10.5805 4.51765 10.5493 4.54883C10.5181 4.58001 10.5006 4.62193 10.5005 4.66602V7.17285L10.5083 7.28809C10.5243 7.40242 10.5642 7.51249 10.6255 7.61133C10.6868 7.71018 10.7675 7.79515 10.8628 7.86035L10.9624 7.91895L10.9653 7.91992L12.1489 8.51855C12.4543 8.67032 12.7114 8.90452 12.8911 9.19434C13.0708 9.48414 13.1663 9.81818 13.1665 10.1592V10.666C13.1665 10.9754 13.0435 11.2724 12.8247 11.4912C12.606 11.7098 12.3097 11.8329 12.0005 11.833H8.50049V14.666C8.50049 14.942 8.27648 15.1658 8.00049 15.166C7.72435 15.166 7.50049 14.9422 7.50049 14.666V11.833H4.00049C3.69107 11.833 3.39409 11.71 3.17529 11.4912C2.9565 11.2724 2.8335 10.9754 2.8335 10.666V10.1592L2.83838 10.0322C2.85916 9.7357 2.95157 9.44805 3.10889 9.19434C3.26618 8.94068 3.48245 8.72953 3.73877 8.5791L3.85107 8.51855L5.03467 7.91992L5.0376 7.91895C5.17644 7.84995 5.29378 7.74309 5.37549 7.61133C5.43667 7.51258 5.47567 7.40229 5.4917 7.28809L5.50049 7.17285V4.66602C5.5004 4.62208 5.48264 4.57998 5.45166 4.54883C5.4204 4.51757 5.3777 4.5 5.3335 4.5C4.84742 4.5 4.38138 4.3065 4.0376 3.96289C3.69378 3.61907 3.50049 3.15225 3.50049 2.66602C3.50057 2.1799 3.69386 1.71386 4.0376 1.37012C4.3814 1.0264 4.84734 0.833008 5.3335 0.833008H10.6665C11.1527 0.833008 11.6196 1.0263 11.9634 1.37012C12.307 1.71384 12.5004 2.17998 12.5005 2.66602Z" fill="currentColor"/>
              </svg>
            {:else}
              <svg class="tool-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                <path d="M11.5005 2.66602C11.5004 2.4452 11.4124 2.23334 11.2563 2.07715C11.1001 1.92087 10.8875 1.83301 10.6665 1.83301H5.3335C5.11256 1.83301 4.90089 1.92097 4.74463 2.07715C4.58843 2.23335 4.50057 2.44512 4.50049 2.66602C4.50049 2.88703 4.58835 3.09958 4.74463 3.25586C4.90088 3.41194 5.11264 3.5 5.3335 3.5C5.64292 3.5 5.9399 3.623 6.15869 3.8418C6.3772 4.06048 6.5004 4.35687 6.50049 4.66602V7.17285C6.50031 7.51393 6.40485 7.8488 6.2251 8.13867C6.04536 8.4285 5.78831 8.66268 5.48291 8.81445L5.48193 8.81348L4.29932 9.41211L4.29639 9.41406C4.15755 9.48305 4.0402 9.58992 3.9585 9.72168C3.87695 9.85335 3.83358 10.0053 3.8335 10.1602V10.666C3.8335 10.7102 3.85107 10.7529 3.88232 10.7842C3.91358 10.8154 3.95629 10.833 4.00049 10.833H12.0005C12.0445 10.8329 12.0865 10.8153 12.1177 10.7842C12.1489 10.7529 12.1665 10.7102 12.1665 10.666V10.1602C12.1664 10.0052 12.1231 9.85338 12.0415 9.72168C11.9598 9.58998 11.8433 9.48305 11.7046 9.41406L11.7017 9.41211L10.5142 8.8125V8.81152C10.2105 8.65975 9.95487 8.42717 9.77588 8.13867C9.59613 7.8488 9.50067 7.51393 9.50049 7.17285V4.66602C9.50057 4.35671 9.62357 4.06051 9.84229 3.8418C10.061 3.62308 10.3572 3.50009 10.6665 3.5C10.8875 3.5 11.1001 3.41214 11.2563 3.25586C11.4126 3.09958 11.5005 2.88703 11.5005 2.66602ZM12.5005 2.66602C12.5005 3.15225 12.3072 3.61907 11.9634 3.96289C11.6196 4.30671 11.1527 4.5 10.6665 4.5C10.6224 4.50009 10.5805 4.51765 10.5493 4.54883C10.5181 4.58001 10.5006 4.62193 10.5005 4.66602V7.17285L10.5083 7.28809C10.5243 7.40242 10.5642 7.51249 10.6255 7.61133C10.6868 7.71018 10.7675 7.79515 10.8628 7.86035L10.9624 7.91895L10.9653 7.91992L12.1489 8.51855C12.4543 8.67032 12.7114 8.90452 12.8911 9.19434C13.0708 9.48414 13.1663 9.81818 13.1665 10.1592V10.666C13.1665 10.9754 13.0435 11.2724 12.8247 11.4912C12.606 11.7098 12.3097 11.8329 12.0005 11.833H8.50049V14.666C8.50049 14.942 8.27648 15.1658 8.00049 15.166C7.72435 15.166 7.50049 14.9422 7.50049 14.666V11.833H4.00049C3.69107 11.833 3.39409 11.71 3.17529 11.4912C2.9565 11.2724 2.8335 10.9754 2.8335 10.666V10.1592L2.83838 10.0322C2.85916 9.7357 2.95157 9.44805 3.10889 9.19434C3.26618 8.94068 3.48245 8.72953 3.73877 8.5791L3.85107 8.51855L5.03467 7.91992L5.0376 7.91895C5.17644 7.84995 5.29378 7.74309 5.37549 7.61133C5.43667 7.51258 5.47567 7.40229 5.4917 7.28809L5.50049 7.17285V4.66602C5.5004 4.62208 5.48264 4.57998 5.45166 4.54883C5.4204 4.51757 5.3777 4.5 5.3335 4.5C4.84742 4.5 4.38138 4.3065 4.0376 3.96289C3.69378 3.61907 3.50049 3.15225 3.50049 2.66602C3.50057 2.1799 3.69386 1.71386 4.0376 1.37012C4.3814 1.0264 4.84734 0.833008 5.3335 0.833008H10.6665C11.1527 0.833008 11.6196 1.0263 11.9634 1.37012C12.307 1.71384 12.5004 2.17998 12.5005 2.66602Z" fill="currentColor"/>
              </svg>
            {/if}
          </button>
          <button class="tool-btn delay-1" class:drag-hover={hoveredToolAction === 'settings'} data-action="settings" onclick={handleSettings} aria-label="Settings">
            <svg class="tool-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
              <path d="M2.83301 14V9.83301H2C1.72386 9.83301 1.5 9.60915 1.5 9.33301C1.50018 9.05702 1.72397 8.83301 2 8.83301H4.66699C4.94288 8.83318 5.16682 9.05712 5.16699 9.33301C5.16699 9.60904 4.94298 9.83283 4.66699 9.83301H3.83301V14C3.83301 14.2761 3.60915 14.5 3.33301 14.5C3.05702 14.4998 2.83301 14.276 2.83301 14ZM7.5 14V8C7.5 7.72386 7.72386 7.5 8 7.5C8.27614 7.5 8.5 7.72386 8.5 8V14C8.5 14.2761 8.27614 14.5 8 14.5C7.72386 14.5 7.5 14.2761 7.5 14ZM12.167 14V11.167H11.333C11.0571 11.1668 10.8332 10.9429 10.833 10.667C10.833 10.391 11.057 10.1672 11.333 10.167H14C14.2761 10.167 14.5 10.3908 14.5 10.667C14.4998 10.943 14.276 11.167 14 11.167H13.167V14C13.167 14.276 12.943 14.4998 12.667 14.5C12.3908 14.5 12.167 14.2761 12.167 14ZM12.167 8V2C12.167 1.72386 12.3908 1.5 12.667 1.5C12.943 1.50018 13.167 1.72397 13.167 2V8C13.167 8.27603 12.943 8.49982 12.667 8.5C12.3908 8.5 12.167 8.27614 12.167 8ZM2.83301 6.66699V2C2.83301 1.72397 3.05702 1.50018 3.33301 1.5C3.60915 1.5 3.83301 1.72386 3.83301 2V6.66699C3.83283 6.94298 3.60904 7.16699 3.33301 7.16699C3.05712 7.16682 2.83318 6.94288 2.83301 6.66699ZM7.5 2C7.5 1.72386 7.72386 1.5 8 1.5C8.27614 1.5 8.5 1.72386 8.5 2V4.83301H9.33301C9.60904 4.83301 9.83283 5.05702 9.83301 5.33301C9.83301 5.60915 9.60915 5.83301 9.33301 5.83301H6.66699C6.39085 5.83301 6.16699 5.60915 6.16699 5.33301C6.16717 5.05702 6.39096 4.83301 6.66699 4.83301H7.5V2Z" fill="currentColor"/>
            </svg>
          </button>
          <button class="tool-btn delay-0" class:drag-hover={hoveredToolAction === 'exit'} id="exit-btn" data-action="exit" onclick={closeApp} aria-label="Close">
            <svg class="tool-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
              <path d="M11.6464 3.64645C11.8417 3.45118 12.1582 3.45118 12.3535 3.64645C12.5487 3.84171 12.5487 4.15822 12.3535 4.35348L8.70699 7.99996L12.3535 11.6464C12.5487 11.8417 12.5487 12.1582 12.3535 12.3535C12.1582 12.5487 11.8417 12.5487 11.6464 12.3535L7.99996 8.70699L4.35348 12.3535C4.15822 12.5487 3.84171 12.5487 3.64645 12.3535C3.45118 12.1582 3.45118 11.8417 3.64645 11.6464L7.29293 7.99996L3.64645 4.35348C3.45118 4.15822 3.45118 3.84171 3.64645 3.64645C3.84171 3.45118 4.15822 3.45118 4.35348 3.64645L7.99996 7.29293L11.6464 3.64645Z" fill="currentColor"/>
            </svg>
          </button>
        </div>
      </div>
    {/if}

    {#if isDotDragging}
      <svg class="drag-overlay">
        <line x1={dotStartX} y1={dotStartY} x2={currentPointerX} y2={currentPointerY} class="drag-line" />
        <circle cx={currentPointerX} cy={currentPointerY} r="5" class="drag-pointer" />
      </svg>
    {/if}
  </div>
</main>

<Lightbox />

<style lang="scss">
  @use '../styles/variables' as *;

  .app-container {
    width: 100vw;
    height: 100vh;
    display: flex;
    padding: 0;
    background: transparent;
    overflow: hidden;
    position: relative;
  }

  .glass-widget {
    @include glass-panel;
    width: 100%;
    height: 100%;
    padding: 12px;
    position: relative;
    display: flex;
    align-items: flex-start;
    overflow: clip;
    box-sizing: border-box;
    animation: fade-in 0.3s ease-out;

    &.collapsed {
      // Padding is kept the same as expanded mode to prevent layout jump
    }
  }

  @keyframes fade-in {
    from { opacity: 0; transform: scale(0.98); }
    to { opacity: 1; transform: scale(1); }
  }

  // Inner flex column: fills the entire widget
  .inner-column {
    display: flex;
    flex-direction: column;
    flex: 1 0 0;
    height: 100%;
    gap: 12px;
    min-width: 1px;
    position: relative;
    justify-content: center;
  }

  // ── Title Section ──
  .title-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
    height: 24px;
    opacity: 0.7;
    overflow: hidden;
    flex-shrink: 0;
    width: 100%;
    cursor: default;
    user-select: none;
    transition: opacity 0.2s ease, height 0.2s ease;

    &.expanded {
      height: auto;
      opacity: 1;
    }
  }

  .title-row {
    display: flex;
    align-items: center;
    gap: 4px;
    opacity: 0.6;
    padding-left: 32px;
    padding-right: 4px;
    flex-shrink: 0;
    width: 100%;
    min-width: 0;
    overflow: hidden;
    transition: opacity 0.2s ease;

    &:hover {
      opacity: 1;
    }
  }

  .title-icon-btn {
    background: transparent;
    border: none;
    padding: 0;
    margin: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
  }

  .title-icon {
    opacity: 0.5;
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    color: $color-text;

    &:hover {
      color: $color-accent;
      opacity: 1;
    }
  }

  .title-text-btn {
    background: transparent;
    border: none;
    padding: 0;
    margin: 0;
    display: flex;
    align-items: center;
    flex: 1 1 0;
    min-width: 0;
    text-align: left;
  }

  .title-text {
    flex: 1 1 0;
    min-width: 0;
    font-family: $font-family-mono;
    font-size: 12px;
    font-weight: 400;
    line-height: 1.2;
    color: #111;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  
  .title-input {
    font-family: $font-family-mono;
    font-size: 12px;
    font-weight: 400;
    line-height: 1.2;
    color: #111;
    background: transparent;
    border: none;
    border-bottom: 1px dashed $color-accent;
    outline: none;
    width: 100%;
    padding: 4px 0 4px 0;
    margin: 0;
    
    &:focus {
      border-bottom: 1px solid $color-accent;
    }
  }

  // ── Dropdown Menu ──
  .dropdown-divider {
    height: 1px;
    background-color: rgba(0, 0, 0, 0.1);
    margin: 0;
    width: 100%;
  }

  .dropdown-item {
    background: transparent;
    border: none;
    padding-top: 2px;
    padding-bottom: 2px;
    padding-left: 6px;
    padding-right: 32px;
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    cursor: pointer;
    text-align: left;
    color: $color-text;
    opacity: 0.8;
    transition: all 0.2s ease;
    
    &:hover {
      opacity: 1;
    }
  }

  .archive-item-btn {
    background: transparent;
    border: none;
    padding: 2px;
    margin: -2px 0;
    cursor: pointer;
    color: $color-text;
    opacity: 0.5;
    transition: all 0.2s ease;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    
    &:hover {
      color: $color-accent;
      opacity: 1;
    }
  }

  .item-icon {
    flex-shrink: 0;
  }

  .item-text {
    font-family: $font-family-mono;
    font-size: 12px;
    font-weight: 400;
    line-height: 1.2;
    color: #111;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  // ── Close Dot ──
  .close-dot {
    width: 10px;
    height: 10px;
    position: absolute;
    top: 19px;
    left: 19px;
    background-color: rgba(0, 0, 0, 0.3);
    border-radius: 50%;
    border: none;
    padding: 0;
    cursor: pointer;
    transition: background 0.2s ease;
    z-index: 20; // Above overlay menu

    &:hover {
      background: $color-accent;
    }
    
    &.active {
      background: rgba(0, 0, 0, 0.3);
    }

    &:active {
      transform: scale(0.9);
    }
  }

  // ── Overlay Menu ──
  .menu-overlay {
    position: absolute;
    inset: -1px;
    z-index: 10;
    border-radius: 12px;
    background: linear-gradient(180deg, #FFFFFF 9.14%, rgba(255, 255, 255, 0) 100%);
    pointer-events: none; // let clicks pass through background
    animation: fade-in 0.2s ease-out forwards;
  }
  
  .toolbar {
    position: absolute;
    top: 9px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 240px;
    pointer-events: auto;
  }

  .tool-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0);
    border: none;
    color: $color-text;
    border-radius: 8px;
    width: 32px;
    height: 32px;
    padding: 4px;
    cursor: pointer;
    transition: all 0.2s ease;
    
    // Starting state for slide-down animation
    transform: translateY(-10px);
    opacity: 0;
    animation: slide-down-fade 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
    
    &:hover, &.drag-hover {
      background: $color-accent; 
      color: #fff;
      opacity: 1 !important;
    }
    
    &.active-tool {
      background: rgba($color-accent, 0.06); 
      color: $color-accent;
      opacity: 1 !important;
    }

    &.active-tool:hover, &.active-tool.drag-hover {
      background: $color-accent; 
      color: #fff;
      opacity: 1 !important;
    }
    
    &#exit-btn:hover, &#exit-btn.drag-hover {
      background: $color-danger !important;
      color: #fff !important;
    }
  }

  .tool-icon {
    width: 20px;
    height: 20px;
  }
  
  // Animation delays from right to left
  .delay-0 { animation-delay: 0.00s; }
  .delay-1 { animation-delay: 0.05s; }
  .delay-2 { animation-delay: 0.10s; }
  .delay-3 { animation-delay: 0.15s; }
  .delay-4 { animation-delay: 0.20s; }
  .delay-5 { animation-delay: 0.25s; }
  
  @keyframes slide-down-fade {
    to {
      transform: translateY(0);
      opacity: 0.5;
    }
  }

  // ── Text Editor ──
  .text-editor {
    display: flex;
    flex-direction: column;
    flex: 1 0 0;
    min-height: 1px;
    overflow-y: auto;
    overflow-x: hidden;
    width: 100%;
    
    // Hide scrollbar but keep scroll functionality
    -ms-overflow-style: none;  /* IE and Edge */
    scrollbar-width: none;  /* Firefox */
    &::-webkit-scrollbar {
      display: none; /* Chrome, Safari and Opera */
    }
  }

  .editor-content {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 0 8px;
    width: 100%;
    font-size: 14px;
    color: black;
    word-break: break-word;
  }

  .heading-text {
    font-family: $font-family-base;
    font-size: 14px;
    font-weight: 600;
    line-height: 1.2;
    color: black;
    margin: 0;
    min-width: 100%;
  }

  .body-text {
    font-family: $font-family-base;
    font-size: 14px;
    font-weight: 400;
    line-height: 1.2;
    color: black;
    margin: 0;
    min-width: 100%;
  }

  .list-block {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-family: $font-family-base;
    font-size: 14px;
    font-weight: 400;
    line-height: 0;

    ul {
      display: block;
      margin: 0;
      padding: 0;
      width: 100%;

      li {
        list-style: disc;
        margin-left: 21px;
        line-height: 1.2;
      }
    }
  }

  // ── Timer Row ──
  .timer-row {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-shrink: 0;
    width: 100%;
  }

  .timer-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 4px;
    border: none;
    border-radius: 9999px;
    background: transparent;
    opacity: 0.5;
    overflow: clip;
    cursor: pointer;
    color: $color-text;
    transition: opacity 0.2s ease;

    &:hover {
      opacity: 0.8;
    }

    &:active {
      opacity: 1;
    }
  }

  // ── Drag Visuals ──
  .drag-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 9999;
  }

  .drag-line {
    stroke: $figma-gray-300;
    stroke-width: 1.5px;
  }

  .drag-pointer {
    fill: $color-accent;
  }
</style>
