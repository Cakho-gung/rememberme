/**
 * Tag helpers: chuẩn hóa tên tag và gán màu.
 *
 * Màu tag hoạt động 2 tầng:
 * 1. Mặc định: hash tên tag → chọn màu trong palette (deterministic —
 *    cùng tên luôn cùng màu, kể cả khi index bị rebuild).
 * 2. Override: user tự chọn màu trong popover → lưu vào tags.json (db.ts).
 */

/** Palette 12 màu, đủ tương phản trên cả theme sáng và tối */
export const TAG_PALETTE = [
  '#e5484d', // red
  '#e54666', // crimson
  '#e93d82', // pink
  '#8e4ec6', // purple
  '#6e56cf', // violet
  '#3e63dd', // blue
  '#0091ff', // sky
  '#12a594', // teal
  '#30a46c', // green
  '#a18072', // bronze
  '#f76b15', // orange
  '#ffb224', // amber
] as const;

/** Chuẩn hóa tên tag làm định danh: trim + lowercase */
export function normalizeTag(name: string): string {
  return name.trim().toLowerCase();
}

/** Hash tên tag ra một màu cố định trong palette */
export function defaultTagColor(name: string): string {
  const norm = normalizeTag(name);
  let hash = 0;
  for (let i = 0; i < norm.length; i++) {
    hash = (hash * 31 + norm.charCodeAt(i)) | 0;
  }
  return TAG_PALETTE[Math.abs(hash) % TAG_PALETTE.length];
}

/** Màu hiển thị của tag: override từ tags.json nếu có, không thì hash */
export function getTagColor(name: string, overrides: Record<string, string>): string {
  return overrides[normalizeTag(name)] ?? defaultTagColor(name);
}

/** Gom danh sách tag duy nhất (đã chuẩn hóa) từ các note, giữ thứ tự gặp đầu tiên */
export function collectTags(notes: { tags: string[]; archived: boolean }[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const note of notes) {
    if (note.archived) continue;
    for (const tag of note.tags ?? []) {
      const norm = normalizeTag(tag);
      if (norm && !seen.has(norm)) {
        seen.add(norm);
        result.push(norm);
      }
    }
  }
  return result;
}
