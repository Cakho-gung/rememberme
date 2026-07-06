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

/**
 * Schema v2: mỗi note là MỘT file tự chứa `notes/{uuid}.json` gồm toàn bộ
 * metadata + content. `index.json` chỉ là cache tra cứu nhanh — nếu mất/hỏng
 * sẽ được dựng lại bằng cách scan thư mục notes (không bao giờ mất dữ liệu).
 */
export const SCHEMA_VERSION = 2;

export interface NoteMeta {
  id: string;
  title: string;
  tags: string[];
  /** Vị trí sắp xếp (số thực — reorder chỉ cần ghi lại 1 file) */
  order: number;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  archivedAt?: number; // Unix timestamp (ms) when the note was archived
}

export interface Note extends NoteMeta {
  /** Tiptap JSON document hoặc HTML string. Có thể null nếu chưa được load */
  content: object | string | null;
}

/** Shape của file notes/{uuid}.json trên đĩa */
interface NoteFileV2 extends NoteMeta {
  version: number;
  content: object | string | null;
}

const NOTES_DIR = 'RememberMe/notes';
const INDEX_FILE = 'RememberMe/index.json';
const TAGS_FILE = 'RememberMe/tags.json';
const LEGACY_NOTES_FILE = 'RememberMe/notes.json';

let initialized = false;

export function generateNoteId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback cho WebView cũ không có randomUUID
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function ensureDir(): Promise<void> {
  if (initialized) return;
  const dirExists = await exists(NOTES_DIR, { baseDir: BaseDirectory.Document });
  if (!dirExists) {
    await mkdir(NOTES_DIR, { baseDir: BaseDirectory.Document, recursive: true });
  }
  initialized = true;
}

function toMeta(n: NoteMeta): NoteMeta {
  return {
    id: n.id,
    title: n.title,
    tags: n.tags ?? [],
    order: n.order ?? 0,
    createdAt: n.createdAt ?? 0,
    updatedAt: n.updatedAt ?? 0,
    archived: n.archived ?? false,
    ...(n.archivedAt ? { archivedAt: n.archivedAt } : {}),
  };
}

function sortByOrder<T extends NoteMeta>(notes: T[]): T[] {
  return notes.sort((a, b) => a.order - b.order);
}

/**
 * Load notes (metadata only, content lazy-load sau).
 * Tự xử lý: index hỏng/mất → rebuild từ files; dữ liệu format cũ → migrate.
 */
export async function loadNotes(): Promise<Note[]> {
  try {
    await ensureDir();

    const indexExists = await exists(INDEX_FILE, { baseDir: BaseDirectory.Document });
    if (indexExists) {
      try {
        const raw = await readTextFile(INDEX_FILE, { baseDir: BaseDirectory.Document });
        const parsed = JSON.parse(raw);

        if (parsed && parsed.version === SCHEMA_VERSION && Array.isArray(parsed.notes)) {
          const metas = sortByOrder((parsed.notes as NoteMeta[]).map(toMeta));
          return metas.map((m) => ({ ...m, content: null }));
        }

        // index là mảng phẳng với id số → format v1, cần migrate
        if (Array.isArray(parsed)) {
          return await migrateV1(parsed);
        }
      } catch (err) {
        console.error('[db] Index corrupt, rebuilding from note files:', err);
      }
      // Index không đọc được / format lạ → dựng lại từ chính các file note
      return await rebuildIndex();
    }

    // Không có index: thử legacy notes.json (v0), rồi thử rebuild, rồi mới coi là trống
    const legacyExists = await exists(LEGACY_NOTES_FILE, { baseDir: BaseDirectory.Document });
    if (legacyExists) {
      const raw = await readTextFile(LEGACY_NOTES_FILE, { baseDir: BaseDirectory.Document });
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return await migrateV1(parsed, /* contentInline */ true);
      }
    }

    const rebuilt = await rebuildIndex();
    return rebuilt;
  } catch (err) {
    console.error('[db] Failed to load notes:', err);
    return [];
  }
}

/**
 * Migrate dữ liệu format cũ (id số, meta tách khỏi content) sang v2.
 * - contentInline=true: nguồn là notes.json cổ (content nằm ngay trong mảng).
 * - Giữ nguyên thứ tự cũ; map lastActiveNoteId trong localStorage sang uuid mới.
 */
async function migrateV1(oldNotes: any[], contentInline = false): Promise<Note[]> {
  console.log(`[db] Migrating ${oldNotes.length} notes to schema v2...`);
  const now = Date.now();
  const savedActiveId = typeof localStorage !== 'undefined'
    ? localStorage.getItem('lastActiveNoteId')
    : null;

  const migrated: Note[] = [];
  for (let i = 0; i < oldNotes.length; i++) {
    const old = oldNotes[i];
    if (old == null || old.id == null) continue;

    let content: object | string | null = null;
    if (contentInline) {
      content = old.content ?? '<p></p>';
    } else {
      const oldPath = `${NOTES_DIR}/${old.id}.json`;
      try {
        if (await exists(oldPath, { baseDir: BaseDirectory.Document })) {
          content = JSON.parse(await readTextFile(oldPath, { baseDir: BaseDirectory.Document }));
        }
      } catch (err) {
        console.error(`[db] Migration: failed to read content of note ${old.id}:`, err);
      }
      if (content === null) content = '<p></p>';
    }

    const note: Note = {
      id: generateNoteId(),
      title: old.title ?? 'Untitled Note',
      tags: [],
      order: i,
      createdAt: now,
      updatedAt: now,
      archived: old.archived ?? false,
      ...(old.archivedAt ? { archivedAt: old.archivedAt } : {}),
      content,
    };

    await writeNoteFile(note, content);

    // Giữ note đang active qua migration
    if (savedActiveId !== null && String(old.id) === savedActiveId) {
      localStorage.setItem('lastActiveNoteId', note.id);
    }

    // Xóa file content cũ (đã có file v2 thay thế)
    if (!contentInline) {
      try {
        await remove(`${NOTES_DIR}/${old.id}.json`, { baseDir: BaseDirectory.Document });
      } catch {}
    }

    migrated.push(note);
  }

  await saveIndexCache(migrated);
  console.log('[db] Migration to v2 complete.');
  return migrated; // content đã load sẵn trong lần migrate này
}

/**
 * Dựng lại index từ các file note (nguồn sự thật).
 */
async function rebuildIndex(): Promise<Note[]> {
  const metas: NoteMeta[] = [];
  try {
    const entries = await readDir(NOTES_DIR, { baseDir: BaseDirectory.Document });
    for (const entry of entries) {
      if (!entry.name || !entry.name.endsWith('.json')) continue;
      try {
        const raw = await readTextFile(`${NOTES_DIR}/${entry.name}`, { baseDir: BaseDirectory.Document });
        const parsed = JSON.parse(raw);
        if (parsed && parsed.version === SCHEMA_VERSION && typeof parsed.id === 'string') {
          metas.push(toMeta(parsed));
        }
      } catch (err) {
        console.error(`[db] Rebuild: skipping unreadable file ${entry.name}:`, err);
      }
    }
  } catch (err) {
    console.error('[db] Failed to rebuild index:', err);
    return [];
  }

  sortByOrder(metas);
  if (metas.length > 0) {
    await saveIndexCache(metas);
    console.log(`[db] Index rebuilt from ${metas.length} note files.`);
  }
  return metas.map((m) => ({ ...m, content: null }));
}

/**
 * Lazy load nội dung một note từ file tự chứa.
 */
export async function loadNoteContent(id: string): Promise<object | string | null> {
  try {
    await ensureDir();
    const filePath = `${NOTES_DIR}/${id}.json`;
    const fileExists = await exists(filePath, { baseDir: BaseDirectory.Document });
    if (!fileExists) return null;

    const raw = await readTextFile(filePath, { baseDir: BaseDirectory.Document });
    const parsed = JSON.parse(raw);
    // v2: content nằm trong field `content`; file lạ thì trả nguyên (an toàn)
    return parsed && parsed.version === SCHEMA_VERSION ? (parsed.content ?? null) : parsed;
  } catch (err) {
    console.error(`[db] Failed to load content for note ${id}:`, err);
    return null;
  }
}

async function writeNoteFile(meta: NoteMeta, content: object | string | null): Promise<void> {
  const file: NoteFileV2 = { version: SCHEMA_VERSION, ...toMeta(meta), content };
  await writeTextFile(`${NOTES_DIR}/${meta.id}.json`, JSON.stringify(file, null, 2), {
    baseDir: BaseDirectory.Document,
  });
}

/**
 * Ghi một note (meta + content) xuống đĩa.
 * Nếu content chưa được load (null) thì đọc content hiện có trên đĩa để
 * tránh ghi đè mất nội dung khi chỉ đổi metadata (rename, archive, tag...).
 */
export async function saveNote(note: Note): Promise<void> {
  try {
    await ensureDir();
    let content = note.content;
    if (content === null) {
      content = await loadNoteContent(note.id);
    }
    await writeNoteFile(note, content);
  } catch (err) {
    console.error(`[db] Failed to save note ${note.id}:`, err);
  }
}

/**
 * Ghi index cache (chỉ metadata). Mất file này không mất dữ liệu.
 */
export async function saveIndexCache(notes: NoteMeta[]): Promise<void> {
  try {
    await ensureDir();
    const payload = { version: SCHEMA_VERSION, notes: notes.map(toMeta) };
    await writeTextFile(INDEX_FILE, JSON.stringify(payload, null, 2), {
      baseDir: BaseDirectory.Document,
    });
  } catch (err) {
    console.error('[db] Failed to save index cache:', err);
  }
}

/**
 * Delete a note's file
 */
export async function deleteNoteData(id: string): Promise<void> {
  try {
    await ensureDir();
    const filePath = `${NOTES_DIR}/${id}.json`;
    const fileExists = await exists(filePath, { baseDir: BaseDirectory.Document });
    if (fileExists) {
      await remove(filePath, { baseDir: BaseDirectory.Document });
    }
  } catch (err) {
    console.error(`[db] Failed to delete note ${id}:`, err);
  }
}

// ── Tag colors ──
// tags.json là file CẤU HÌNH (name → hex màu user tự chọn), không phải index:
// mất file này thì tag vẫn còn nguyên trong note, chỉ màu quay về mặc định.

export async function loadTagColors(): Promise<Record<string, string>> {
  try {
    await ensureDir();
    const fileExists = await exists(TAGS_FILE, { baseDir: BaseDirectory.Document });
    if (!fileExists) return {};
    const raw = await readTextFile(TAGS_FILE, { baseDir: BaseDirectory.Document });
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    console.error('[db] Failed to load tag colors:', err);
    return {};
  }
}

export async function saveTagColors(colors: Record<string, string>): Promise<void> {
  try {
    await ensureDir();
    await writeTextFile(TAGS_FILE, JSON.stringify(colors, null, 2), {
      baseDir: BaseDirectory.Document,
    });
  } catch (err) {
    console.error('[db] Failed to save tag colors:', err);
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
          const parsed = JSON.parse(raw);
          // v2: content nằm trong field `content`; file cũ: cả file là content
          const noteContent = parsed && parsed.version === SCHEMA_VERSION ? parsed.content : parsed;
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
