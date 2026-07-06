import {
  readTextFile,
  writeTextFile,
  exists,
  mkdir,
  BaseDirectory,
  readDir,
  remove,
  rename,
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
/** Nơi cất file dữ liệu format cũ sau khi đã adapt xong — ẩn khỏi app nhưng không xóa */
const BACKUP_DIR = 'RememberMe/backup-v1';

let initialized = false;

// ── Migration progress (để UI hiện popup tiến trình) ──
export interface MigrationProgress {
  done: number;
  total: number;
}

let migrationProgressCb: ((p: MigrationProgress) => void) | null = null;

export function setMigrationProgressListener(
  cb: ((p: MigrationProgress) => void) | null,
): void {
  migrationProgressCb = cb;
}

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
 * Cuối cùng LUÔN chạy salvage pass: gắn lại file v2 mồ côi (index bị app cũ
 * ghi đè) và adapt file số v1 còn sót thành note v2 — không note nào bị bỏ rơi.
 */
export async function loadNotes(): Promise<Note[]> {
  try {
    await ensureDir();
    const notes = await loadNotesFromIndex();
    return await salvageOrphans(notes);
  } catch (err) {
    console.error('[db] Failed to load notes:', err);
    return [];
  }
}

async function loadNotesFromIndex(): Promise<Note[]> {
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

  // Không có index: ưu tiên dựng lại từ file v2 sẵn có; chỉ khi trắng tay
  // mới đụng tới legacy notes.json (tránh import trùng nếu cả hai tồn tại)
  const rebuilt = await rebuildIndex();
  if (rebuilt.length > 0) return rebuilt;

  const legacyExists = await exists(LEGACY_NOTES_FILE, { baseDir: BaseDirectory.Document });
  if (legacyExists) {
    const raw = await readTextFile(LEGACY_NOTES_FILE, { baseDir: BaseDirectory.Document });
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return await migrateV1(parsed, /* contentInline */ true);
    }
  }

  return [];
}

async function backupOldFile(relPath: string, name: string): Promise<void> {
  try {
    const backupExists = await exists(BACKUP_DIR, { baseDir: BaseDirectory.Document });
    if (!backupExists) {
      await mkdir(BACKUP_DIR, { baseDir: BaseDirectory.Document, recursive: true });
    }
    await rename(relPath, `${BACKUP_DIR}/${name}`, {
      oldPathBaseDir: BaseDirectory.Document,
      newPathBaseDir: BaseDirectory.Document,
    });
  } catch (err) {
    console.error(`[db] Failed to move ${relPath} to backup:`, err);
  }
}

/**
 * Salvage pass — chạy sau mỗi lần load:
 * 1. File v2 (uuid) có trên đĩa nhưng không có trong index (index bị app bản cũ
 *    ghi đè, hoặc bị mất entry) → gắn lại vào index (không mất dữ liệu v2 thật).
 * 2. File số kiểu v1 (`4.json`) còn sót nhưng KHÔNG có trong index v1 → theo
 *    semantics V1 (index là nguồn sự thật), đây là note user đã XOÁ ở bản cũ
 *    (delete cũ chỉ gỡ entry, để lại file). Tôn trọng ý định user: XOÁ HẲN file,
 *    không hồi sinh. File v1 của note thật đã được migrateV1 cất vào backup-v1/.
 */
async function salvageOrphans(notes: Note[]): Promise<Note[]> {
  let changed = false;
  const knownIds = new Set(notes.map((n) => n.id));
  let maxOrder = notes.reduce((mx, n) => Math.max(mx, n.order), -1);

  let entries;
  try {
    entries = await readDir(NOTES_DIR, { baseDir: BaseDirectory.Document });
  } catch (err) {
    console.error('[db] Salvage: cannot read notes dir:', err);
    return notes;
  }

  // Xử lý file số theo thứ tự tăng dần để giữ thứ tự tương đối cũ
  const jsonNames = entries
    .filter((e) => e.name && e.name.endsWith('.json'))
    .map((e) => e.name as string)
    .sort((a, b) => {
      const na = parseInt(a), nb = parseInt(b);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return a.localeCompare(b);
    });

  for (const name of jsonNames) {
    const base = name.slice(0, -5);
    if (knownIds.has(base)) continue;

    try {
      const raw = await readTextFile(`${NOTES_DIR}/${name}`, { baseDir: BaseDirectory.Document });
      const parsed = JSON.parse(raw);

      if (parsed && parsed.version === SCHEMA_VERSION && typeof parsed.id === 'string') {
        // File v2 mồ côi → gắn lại
        if (!knownIds.has(parsed.id)) {
          const meta = toMeta(parsed);
          meta.order = ++maxOrder;
          notes.push({ ...meta, content: null });
          knownIds.add(meta.id);
          changed = true;
          console.log(`[db] Salvage: re-attached orphaned note "${meta.title}"`);
        }
      } else if (/^\d+$/.test(base)) {
        // File số kiểu v1 không có trong index v1 = note user đã XOÁ ở bản cũ.
        // Nội dung của note thật đã được migrateV1 chép sang v2 + cất bản gốc
        // vào backup-v1/, nên file số còn sót ở đây chỉ có thể là note đã xoá.
        // → Xoá hẳn, tôn trọng trạng thái đã-xoá, không hồi sinh.
        await remove(`${NOTES_DIR}/${name}`, { baseDir: BaseDirectory.Document });
        console.log(`[db] Salvage: removed deleted-note leftover ${name}`);
      }
    } catch (err) {
      console.error(`[db] Salvage: cannot process ${name}:`, err);
    }
  }

  if (changed) {
    sortByOrder(notes);
    await saveIndexCache(notes);
  }
  return notes;
}

/**
 * Đọc content của một note v1: ưu tiên notes/, fallback backup-v1/
 * (trường hợp lần migrate trước bị ngắt sau khi đã move file).
 */
async function readV1Content(oldId: string | number): Promise<object | string | null> {
  for (const dir of [NOTES_DIR, BACKUP_DIR]) {
    const path = `${dir}/${oldId}.json`;
    try {
      if (await exists(path, { baseDir: BaseDirectory.Document })) {
        return JSON.parse(await readTextFile(path, { baseDir: BaseDirectory.Document }));
      }
    } catch (err) {
      console.error(`[db] Failed to read v1 content at ${path}:`, err);
    }
  }
  return null;
}

/**
 * Chọn id v2 cho một note v1. Mặc định deterministic (`v1-{oldId}`) để
 * migration chạy lại bao nhiêu lần cũng idempotent — không sinh bản trùng.
 * Nếu file `v1-{oldId}.json` đã tồn tại với NỘI DUNG KHÁC (app bản cũ đã
 * tái sử dụng id số đó cho một note khác) → cấp id ngẫu nhiên, không ghi đè.
 */
async function chooseV2Id(oldId: string | number, content: object | string | null): Promise<string> {
  const detId = `v1-${oldId}`;
  const targetPath = `${NOTES_DIR}/${detId}.json`;
  try {
    if (await exists(targetPath, { baseDir: BaseDirectory.Document })) {
      const existing = JSON.parse(await readTextFile(targetPath, { baseDir: BaseDirectory.Document }));
      if (JSON.stringify(existing.content) !== JSON.stringify(content)) {
        return generateNoteId();
      }
    }
  } catch {
    return generateNoteId();
  }
  return detId;
}

/**
 * Migrate dữ liệu format cũ (id số, meta tách khỏi content) sang v2.
 * User thấy đúng y như cũ: giữ nguyên title, thứ tự, trạng thái archive,
 * và note đang mở (map lastActiveNoteId). Chạy theo 3 pha để an toàn khi
 * bị ngắt giữa chừng:
 *   1. Ghi toàn bộ file v2 (id deterministic → chạy lại không tạo trùng)
 *   2. Commit index (điểm chuyển đổi duy nhất)
 *   3. Cất file cũ vào backup-v1/ (fail cũng vô hại)
 * - contentInline=true: nguồn là notes.json cổ (content nằm ngay trong mảng).
 */
async function migrateV1(oldNotes: any[], contentInline = false): Promise<Note[]> {
  const valid = oldNotes.filter((o) => o != null && o.id != null);
  console.log(`[db] Migrating ${valid.length} notes to schema v2...`);
  const now = Date.now();
  const savedActiveId = typeof localStorage !== 'undefined'
    ? localStorage.getItem('lastActiveNoteId')
    : null;

  // Pha 1: ghi file v2
  const migrated: Note[] = [];
  for (let i = 0; i < valid.length; i++) {
    const old = valid[i];

    let content: object | string | null;
    if (contentInline) {
      content = old.content ?? '<p></p>';
    } else {
      content = (await readV1Content(old.id)) ?? '<p></p>';
    }

    const note: Note = {
      id: await chooseV2Id(old.id, content),
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

    migrated.push(note);
    migrationProgressCb?.({ done: i + 1, total: valid.length });
  }

  // Pha 2: commit index — từ đây app đọc hoàn toàn theo v2
  await saveIndexCache(migrated);

  // Pha 3: cất file cũ vào backup (không xóa gì)
  if (contentInline) {
    await backupOldFile(LEGACY_NOTES_FILE, 'notes.json');
  } else {
    for (const old of valid) {
      const oldPath = `${NOTES_DIR}/${old.id}.json`;
      if (await exists(oldPath, { baseDir: BaseDirectory.Document })) {
        await backupOldFile(oldPath, `${old.id}.json`);
      }
    }
  }

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
