import {
  readTextFile,
  writeTextFile,
  exists,
  mkdir,
  BaseDirectory,
  readDir,
  remove,
} from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';

export interface NoteMeta {
  id: number;
  title: string;
  archived: boolean;
}

export interface Note extends NoteMeta {
  /** Tiptap JSON document hoặc HTML string. Có thể null nếu chưa được load */
  content: object | string | null;
}

const DATA_SUBDIR = 'RememberMe';
const NOTES_DIR = 'RememberMe/notes';
const INDEX_FILE = 'RememberMe/index.json';

let initialized = false;

async function ensureDir(): Promise<void> {
  if (initialized) return;
  const dirExists = await exists(NOTES_DIR, { baseDir: BaseDirectory.Document });
  if (!dirExists) {
    await mkdir(NOTES_DIR, { baseDir: BaseDirectory.Document, recursive: true });
  }
  initialized = true;
}

/**
 * Load notes index from disk.
 * Migrates old notes.json to new architecture if needed.
 */
export async function loadNotes(): Promise<Note[]> {
  try {
    await ensureDir();
    const fileExists = await exists(INDEX_FILE, { baseDir: BaseDirectory.Document });
    if (!fileExists) {
      // Migrate old notes.json if exists
      const oldExists = await exists('RememberMe/notes.json', { baseDir: BaseDirectory.Document });
      if (oldExists) {
        const raw = await readTextFile('RememberMe/notes.json', { baseDir: BaseDirectory.Document });
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const notes = parsed as Note[];
          // Save metas and contents separately
          await saveIndex(notes);
          for (const note of notes) {
            await saveNoteContent(note.id, note.content);
          }
          return notes; // Return them fully loaded this one time
        }
      }
      return [];
    }

    const raw = await readTextFile(INDEX_FILE, { baseDir: BaseDirectory.Document });
    const parsed = JSON.parse(raw);
    const metas: NoteMeta[] = Array.isArray(parsed) ? parsed : [];
    
    // Convert to Note array with null content to be lazily loaded
    return metas.map(m => ({ ...m, content: null }));
  } catch (err) {
    console.error('[db] Failed to load notes index:', err);
    return [];
  }
}

/**
 * Lazy load note content
 */
export async function loadNoteContent(id: number): Promise<object | string | null> {
  try {
    await ensureDir();
    const filePath = `${NOTES_DIR}/${id}.json`;
    const fileExists = await exists(filePath, { baseDir: BaseDirectory.Document });
    if (!fileExists) return null;

    const raw = await readTextFile(filePath, { baseDir: BaseDirectory.Document });
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[db] Failed to load content for note ${id}:`, err);
    return null;
  }
}

/**
 * Save notes metadata to index
 */
export async function saveIndex(notes: NoteMeta[]): Promise<void> {
  try {
    await ensureDir();
    const metas = notes.map(n => ({ id: n.id, title: n.title, archived: n.archived }));
    await writeTextFile(INDEX_FILE, JSON.stringify(metas, null, 2), {
      baseDir: BaseDirectory.Document,
    });
  } catch (err) {
    console.error('[db] Failed to save index:', err);
  }
}

/**
 * Save note content to separate file
 */
export async function saveNoteContent(id: number, content: any): Promise<void> {
  try {
    await ensureDir();
    const filePath = `${NOTES_DIR}/${id}.json`;
    await writeTextFile(filePath, JSON.stringify(content, null, 2), {
      baseDir: BaseDirectory.Document,
    });
  } catch (err) {
    console.error(`[db] Failed to save content for note ${id}:`, err);
  }
}

/**
 * Delete a note's content file
 */
export async function deleteNoteData(id: number): Promise<void> {
  try {
    await ensureDir();
    const filePath = `${NOTES_DIR}/${id}.json`;
    const fileExists = await exists(filePath, { baseDir: BaseDirectory.Document });
    if (fileExists) {
      await remove(filePath, { baseDir: BaseDirectory.Document });
    }
  } catch (err) {
    console.error(`[db] Failed to delete content for note ${id}:`, err);
  }
}

/**
 * Extract absolute image paths from Tiptap JSON content
 */
export function extractImagePaths(content: any): string[] {
  if (!content || typeof content !== 'object') return [];
  
  const paths: string[] = [];
  
  function traverse(node: any) {
    if (!node || typeof node !== 'object') return;
    
    if (node.type === 'image' && node.attrs && node.attrs.title) {
      // The `title` attribute stores the absolute file path, as set in ImagePasteExtension
      paths.push(node.attrs.title);
    }
    
    if (Array.isArray(node.content)) {
      node.content.forEach(traverse);
    }
  }
  
  traverse(content);
  return paths;
}

/**
 * Garbage Collection: Delete all image files that are not referenced in ANY note.
 */
export async function cleanupOrphanedImages(): Promise<void> {
  const inUsePaths = new Set<string>();

  try {
    // 1. Scan all notes to find all used image filenames
    const entries = await readDir(NOTES_DIR, { baseDir: BaseDirectory.Document });
    for (const entry of entries) {
      if (entry.name && entry.name.endsWith('.json') && entry.name !== 'index.json') {
        try {
          const raw = await readTextFile(`${NOTES_DIR}/${entry.name}`, { baseDir: BaseDirectory.Document });
          const noteContent = JSON.parse(raw);
          const used = extractImagePaths(noteContent);
          
          // Store only the filename to match with `readDir`
          used.forEach(p => {
            const filename = p.split(/[/\\]/).pop();
            if (filename) inUsePaths.add(filename);
          });
        } catch (e) {
          console.error(`[db] Failed to parse note ${entry.name} when checking images`, e);
        }
      }
    }

    // 2. Scan the images directory
    const IMAGES_DIR = 'RememberMe/images';
    const imageExists = await exists(IMAGES_DIR, { baseDir: BaseDirectory.Document });
    if (!imageExists) return;

    const imageFiles = await readDir(IMAGES_DIR, { baseDir: BaseDirectory.Document });
    
    // 3. For each file in images dir, check if it's in inUsePaths
    for (const file of imageFiles) {
      if (file.name && file.isFile) {
        if (!inUsePaths.has(file.name)) {
          // It's an orphan! Delete it.
          try {
            await invoke('delete_image_by_name', { name: file.name });
            console.log(`[db] GC: Deleted orphaned image: ${file.name}`);
          } catch (err) {
            console.error(`[db] GC: Failed to delete orphaned image ${file.name}:`, err);
          }
        }
      }
    }
  } catch (err) {
    console.error('[db] Failed to run image Garbage Collection:', err);
  }
}
