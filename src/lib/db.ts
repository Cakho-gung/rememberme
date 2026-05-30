/**
 * db.ts — Persistence layer for RememberMe notes.
 *
 * Lưu data vào: {Documents}/RememberMe/notes.json
 * Trên Windows: %USERPROFILE%\Documents\RememberMe\notes.json
 * Trên macOS:   ~/Documents/RememberMe/notes.json
 */

import {
  readTextFile,
  writeTextFile,
  exists,
  mkdir,
  BaseDirectory,
} from '@tauri-apps/plugin-fs';

export interface Note {
  id: number;
  title: string;
  archived: boolean;
  /** Tiptap JSON document hoặc HTML string */
  content: object | string | null;
}

const DATA_SUBDIR = 'RememberMe';
const NOTES_FILE = 'RememberMe/notes.json';

let initialized = false;

async function ensureDir(): Promise<void> {
  if (initialized) return;
  const dirExists = await exists(DATA_SUBDIR, { baseDir: BaseDirectory.Document });
  if (!dirExists) {
    await mkdir(DATA_SUBDIR, { baseDir: BaseDirectory.Document, recursive: true });
  }
  initialized = true;
}

/**
 * Load notes from disk.
 * Returns empty array if file doesn't exist yet.
 */
export async function loadNotes(): Promise<Note[]> {
  try {
    await ensureDir();
    const fileExists = await exists(NOTES_FILE, { baseDir: BaseDirectory.Document });
    if (!fileExists) return [];

    const raw = await readTextFile(NOTES_FILE, { baseDir: BaseDirectory.Document });
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('[db] Failed to load notes:', err);
    return [];
  }
}

/**
 * Save notes to disk (debounced by caller).
 */
export async function saveNotes(notes: Note[]): Promise<void> {
  try {
    await ensureDir();
    await writeTextFile(NOTES_FILE, JSON.stringify(notes, null, 2), {
      baseDir: BaseDirectory.Document,
    });
  } catch (err) {
    console.error('[db] Failed to save notes:', err);
  }
}
