/**
 * Snapshot theo ngày (Nhóm 2 — xem docs/EXPORT_AND_SNAPSHOTS.md).
 *
 * Mỗi khi một note được lưu, ghi một bản chụp Markdown vào
 *   RememberMe/history/{YYYY-MM-DD}/{id}.md
 * GHI ĐÈ file của HÔM NAY mỗi lần gọi -> cuối ngày là trạng thái cuối cùng.
 * Sang ngày mới, file ngày cũ tự đóng băng (không bị ghi đè nữa).
 *
 * App KHÔNG tự diff: agent đọc các snapshot rồi tự đối chiếu để nhận biết
 * thay đổi / dựng timeline. Snapshot là Markdown (lossy) -> để đọc, không
 * dùng để restore chính xác.
 */
import { writeTextFile, mkdir, exists, BaseDirectory } from '@tauri-apps/plugin-fs';
import { noteContentToMarkdown } from './markdown/toMarkdown';

const HISTORY_DIR = 'RememberMe/history';

export interface SnapshotNote {
  id: string;
  title?: string;
  tags?: string[];
  updatedAt?: number;
  content: object | string | null;
}

/** Ngày local dạng YYYY-MM-DD (dùng làm tên thư mục). */
function todayStamp(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Bọc chuỗi cho an toàn trong YAML front-matter. */
function yaml(s: string): string {
  return `"${(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function buildSnapshot(note: SnapshotNote): string {
  const updated = new Date(note.updatedAt ?? Date.now()).toISOString();
  const frontMatter = [
    '---',
    `id: ${note.id}`,
    `title: ${yaml(note.title ?? '')}`,
    `tags: [${(note.tags ?? []).map(yaml).join(', ')}]`,
    `updatedAt: ${updated}`,
    `snapshotDate: ${todayStamp()}`,
    '---',
    '',
    '',
  ].join('\n');
  return frontMatter + noteContentToMarkdown(note.content) + '\n';
}

/**
 * Ghi bản chụp của một note cho hôm nay.
 * Bỏ qua khi content chưa load (null) để không ghi đè bằng nội dung rỗng.
 * Tự nuốt lỗi — snapshot là phụ, không được làm hỏng luồng lưu chính.
 */
export async function writeDailySnapshot(note: SnapshotNote): Promise<void> {
  if (note.content == null) return;
  try {
    const dir = `${HISTORY_DIR}/${todayStamp()}`;
    if (!(await exists(dir, { baseDir: BaseDirectory.Document }))) {
      await mkdir(dir, { baseDir: BaseDirectory.Document, recursive: true });
    }
    await writeTextFile(`${dir}/${note.id}.md`, buildSnapshot(note), {
      baseDir: BaseDirectory.Document,
    });
  } catch (err) {
    console.error('[snapshot] failed to write daily snapshot:', err);
  }
}
