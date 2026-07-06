/**
 * Chuyển nội dung note (Tiptap JSON hoặc HTML string) sang Markdown dễ đọc.
 *
 * Đây là MODULE THUẦN: phần lõi (Tiptap JSON -> Markdown) không phụ thuộc
 * Svelte/Tauri/DOM, nên chạy được cả trong app lẫn trong Node script (cho agent).
 * Nhánh HTML string dùng DOMParser nếu có (trong app), fallback strip-tag thô
 * khi không có DOM.
 *
 * Triết lý (xem docs/EXPORT_AND_SNAPSHOTS.md): KHÔNG round-trip lossless.
 * Node lạ -> lấy phần chữ bên trong. Ưu tiên giữ NỘI DUNG, chấp nhận mất định dạng lạ.
 */

type AnyNode = {
  type?: string;
  attrs?: Record<string, any>;
  content?: AnyNode[];
  marks?: Array<{ type?: string; attrs?: Record<string, any> }>;
  text?: string;
};

export interface NoteLike {
  title?: string;
  tags?: string[];
  content: object | string | null;
}

// ──────────────────────────── Inline (text + marks) ────────────────────────────

function applyMarks(text: string, marks?: AnyNode['marks']): string {
  if (!marks || marks.length === 0) return text;
  const has = (t: string) => marks.some((m) => m?.type === t);
  const link = marks.find((m) => m?.type === 'link');

  let out = text;
  if (has('code')) {
    // Trong `code` không lồng cú pháp khác
    out = '`' + out + '`';
  } else {
    if (has('bold')) out = `**${out}**`;
    if (has('italic')) out = `*${out}*`;
    if (has('strike')) out = `~~${out}~~`;
    // underline, subscript, superscript, textStyle (màu), highlight -> giữ chữ trần
  }
  if (link?.attrs?.href) out = `[${out}](${link.attrs.href})`;
  return out;
}

function renderInline(nodes?: AnyNode[]): string {
  if (!nodes) return '';
  return nodes.map(renderInlineNode).join('');
}

function renderInlineNode(n: AnyNode): string {
  if (!n) return '';
  switch (n.type) {
    case 'text':
      return applyMarks(n.text ?? '', n.marks);
    case 'hardBreak':
      return '  \n';
    case 'inlineMath': {
      const latex = n.attrs?.latex ?? '';
      return n.attrs?.display ? `$$${latex}$$` : `$${latex}$`;
    }
    case 'mention':
      return `@${n.attrs?.label ?? n.attrs?.id ?? ''}`;
    case 'emoji':
      return n.attrs?.name ? `:${n.attrs.name}:` : '';
    case 'image':
      return renderImage(n);
    default:
      if (n.content) return renderInline(n.content);
      if (typeof n.text === 'string') return applyMarks(n.text, n.marks);
      return '';
  }
}

function renderImage(n: AnyNode): string {
  const alt = n.attrs?.alt ?? '';
  // `title` giữ đường dẫn file thật (xem ImagePasteExtension); ưu tiên nó.
  const src = n.attrs?.title || n.attrs?.src || '';
  return `![${alt}](${src})`;
}

// ──────────────────────────── Block ────────────────────────────

const BLOCK_TYPES = new Set([
  'paragraph', 'heading', 'bulletList', 'orderedList', 'taskList', 'listItem',
  'taskItem', 'blockquote', 'codeBlock', 'horizontalRule', 'table', 'tableRow',
  'details', 'detailsSummary', 'detailsContent', 'doc',
]);

function looksBlock(nodes?: AnyNode[]): boolean {
  return !!nodes && nodes.some((c) => c.type != null && BLOCK_TYPES.has(c.type));
}

function renderBlocks(nodes?: AnyNode[], depth = 0): string {
  if (!nodes) return '';
  return nodes
    .map((n) => renderBlock(n, depth))
    .filter((s) => s != null && s.length > 0)
    .join('\n\n');
}

function renderBlock(n: AnyNode, depth: number): string {
  switch (n.type) {
    case 'paragraph':
      return renderInline(n.content);
    case 'heading': {
      const level = Math.min(Math.max(n.attrs?.level ?? 1, 1), 6);
      return `${'#'.repeat(level)} ${renderInline(n.content)}`;
    }
    case 'bulletList':
      return renderList(n, depth, false);
    case 'orderedList':
      return renderList(n, depth, true);
    case 'taskList':
      return renderTaskList(n, depth);
    case 'blockquote': {
      const inner = renderBlocks(n.content, depth);
      return inner.split('\n').map((l) => (l.length ? `> ${l}` : '>')).join('\n');
    }
    case 'codeBlock': {
      const lang = n.attrs?.language ?? '';
      const code = (n.content ?? []).map((c) => c.text ?? '').join('');
      return '```' + lang + '\n' + code + '\n```';
    }
    case 'horizontalRule':
      return '---';
    case 'image':
      return renderImage(n);
    case 'table':
      return renderTable(n);
    case 'details':
      return renderDetails(n, depth);
    default:
      // Node lạ: nếu bọc block thì đệ quy, không thì lấy chữ inline bên trong
      if (looksBlock(n.content)) return renderBlocks(n.content, depth);
      return renderInline(n.content);
  }
}

function renderList(n: AnyNode, depth: number, ordered: boolean): string {
  const items = n.content ?? [];
  return items
    .map((item, i) => renderListItem(item, depth, ordered ? `${i + 1}.` : '-'))
    .join('\n');
}

function renderListItem(item: AnyNode, depth: number, marker: string): string {
  const indent = '  '.repeat(depth);
  const extra: string[] = [];
  let firstLine = '';
  let firstDone = false;

  for (const child of item.content ?? []) {
    if (!firstDone && (child.type === 'paragraph' || child.type === 'heading')) {
      firstLine = renderInline(child.content);
      firstDone = true;
    } else if (child.type === 'bulletList') {
      extra.push(renderList(child, depth + 1, false));
    } else if (child.type === 'orderedList') {
      extra.push(renderList(child, depth + 1, true));
    } else if (child.type === 'taskList') {
      extra.push(renderTaskList(child, depth + 1));
    } else {
      const s = renderBlock(child, depth + 1);
      if (s) extra.push(s.split('\n').map((l) => '  '.repeat(depth + 1) + l).join('\n'));
    }
  }

  let out = `${indent}${marker} ${firstLine}`;
  if (extra.length) out += '\n' + extra.join('\n');
  return out;
}

function renderTaskList(n: AnyNode, depth: number): string {
  const items = n.content ?? [];
  return items
    .map((item) => {
      const indent = '  '.repeat(depth);
      const box = item.attrs?.checked ? 'x' : ' ';
      const extra: string[] = [];
      let firstLine = '';
      let firstDone = false;

      for (const child of item.content ?? []) {
        if (!firstDone && (child.type === 'paragraph' || child.type === 'heading')) {
          firstLine = renderInline(child.content);
          firstDone = true;
        } else if (child.type === 'bulletList') {
          extra.push(renderList(child, depth + 1, false));
        } else if (child.type === 'orderedList') {
          extra.push(renderList(child, depth + 1, true));
        } else if (child.type === 'taskList') {
          extra.push(renderTaskList(child, depth + 1));
        } else {
          const s = renderBlock(child, depth + 1);
          if (s) extra.push(s);
        }
      }

      let out = `${indent}- [${box}] ${firstLine}`;
      if (extra.length) out += '\n' + extra.join('\n');
      return out;
    })
    .join('\n');
}

function renderTable(n: AnyNode): string {
  const rows = (n.content ?? []).filter((r) => r.type === 'tableRow');
  if (rows.length === 0) return '';

  const cellText = (cell: AnyNode) =>
    renderBlocks(cell.content).replace(/\n+/g, ' ').replace(/\|/g, '\\|').trim();

  const matrix = rows.map((r) => (r.content ?? []).map(cellText));
  const cols = Math.max(...matrix.map((r) => r.length));
  const pad = (r: string[]) => {
    const copy = r.slice();
    while (copy.length < cols) copy.push('');
    return copy;
  };
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`;

  const header = line(pad(matrix[0]));
  const sep = line(new Array(cols).fill('---'));
  const body = matrix.slice(1).map((r) => line(pad(r)));
  return [header, sep, ...body].join('\n');
}

function renderDetails(n: AnyNode, depth: number): string {
  const children = n.content ?? [];
  const summaryNode = children.find((c) => c.type === 'detailsSummary');
  const contentNode = children.find((c) => c.type === 'detailsContent');
  const summary = summaryNode ? renderInline(summaryNode.content) : '';
  const body = contentNode ? renderBlocks(contentNode.content, depth) : '';
  const head = summary ? `**${summary}**` : '**Details**';
  return body ? `${head}\n\n${body}` : head;
}

// ──────────────────────────── HTML string (legacy) ────────────────────────────

/** Chuyển HTML string (note cũ) sang Markdown. Best-effort. */
export function htmlToMarkdown(html: string): string {
  if (!html) return '';
  if (typeof DOMParser === 'undefined') {
    // Không có DOM (Node): strip thô, giữ nội dung
    return html
      .replace(/<br\s*\/?>(?!\n)/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return domBlocks(doc.body).trim();
}

function domInline(node: Node): string {
  let out = '';
  node.childNodes.forEach((child) => {
    if (child.nodeType === 3) {
      out += child.textContent ?? '';
    } else if (child.nodeType === 1) {
      const el = child as HTMLElement;
      const tag = el.tagName.toLowerCase();
      const inner = domInline(el);
      switch (tag) {
        case 'strong': case 'b': out += `**${inner}**`; break;
        case 'em': case 'i': out += `*${inner}*`; break;
        case 's': case 'del': case 'strike': out += `~~${inner}~~`; break;
        case 'code': out += `\`${inner}\``; break;
        case 'a': out += `[${inner}](${el.getAttribute('href') ?? ''})`; break;
        case 'br': out += '  \n'; break;
        case 'img':
          out += `![${el.getAttribute('alt') ?? ''}](${el.getAttribute('title') || el.getAttribute('src') || ''})`;
          break;
        default: out += inner;
      }
    }
  });
  return out;
}

function domList(el: HTMLElement, ordered: boolean, depth: number): string {
  const items = Array.from(el.children).filter((c) => c.tagName.toLowerCase() === 'li') as HTMLElement[];
  const lines: string[] = [];
  items.forEach((li, i) => {
    const indent = '  '.repeat(depth);
    const marker = ordered ? `${i + 1}.` : '-';
    const clone = li.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(':scope > ul, :scope > ol').forEach((n) => n.remove());
    lines.push(`${indent}${marker} ${domInline(clone).trim()}`);
    li.querySelectorAll(':scope > ul').forEach((u) => lines.push(domList(u as HTMLElement, false, depth + 1)));
    li.querySelectorAll(':scope > ol').forEach((u) => lines.push(domList(u as HTMLElement, true, depth + 1)));
  });
  return lines.join('\n');
}

function domTable(el: HTMLElement): string {
  const rows = Array.from(el.querySelectorAll('tr'));
  if (rows.length === 0) return '';
  const matrix = rows.map((r) =>
    Array.from(r.querySelectorAll('th,td')).map((c) => domInline(c).replace(/\|/g, '\\|').trim()),
  );
  const cols = Math.max(...matrix.map((r) => r.length));
  const pad = (r: string[]) => { const c = r.slice(); while (c.length < cols) c.push(''); return c; };
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
  return [line(pad(matrix[0])), line(new Array(cols).fill('---')), ...matrix.slice(1).map((r) => line(pad(r)))].join('\n');
}

function domBlocks(node: Node): string {
  const parts: string[] = [];
  node.childNodes.forEach((child) => {
    if (child.nodeType === 3) {
      const t = (child.textContent ?? '').trim();
      if (t) parts.push(t);
      return;
    }
    if (child.nodeType !== 1) return;
    const el = child as HTMLElement;
    const tag = el.tagName.toLowerCase();
    switch (tag) {
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
        parts.push('#'.repeat(Number(tag[1])) + ' ' + domInline(el)); break;
      case 'p': parts.push(domInline(el)); break;
      case 'ul': parts.push(domList(el, false, 0)); break;
      case 'ol': parts.push(domList(el, true, 0)); break;
      case 'blockquote':
        parts.push(domBlocks(el).split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n')); break;
      case 'pre': {
        const codeEl = el.querySelector('code');
        const lang = codeEl?.className.match(/language-([\w-]+)/)?.[1] ?? '';
        parts.push('```' + lang + '\n' + (el.textContent ?? '') + '\n```'); break;
      }
      case 'hr': parts.push('---'); break;
      case 'img':
        parts.push(`![${el.getAttribute('alt') ?? ''}](${el.getAttribute('title') || el.getAttribute('src') || ''})`); break;
      case 'table': parts.push(domTable(el)); break;
      case 'details': {
        const summary = el.querySelector('summary');
        const summaryText = summary ? domInline(summary) : 'Details';
        const clone = el.cloneNode(true) as HTMLElement;
        clone.querySelector('summary')?.remove();
        parts.push(`**${summaryText}**\n\n${domBlocks(clone)}`); break;
      }
      case 'div': case 'section': case 'article':
        parts.push(domBlocks(el)); break;
      default: {
        const inner = domInline(el).trim();
        if (inner) parts.push(inner);
      }
    }
  });
  return parts.filter((p) => p.length).join('\n\n');
}

// ──────────────────────────── Public API ────────────────────────────

/** Chuyển content của một note (JSON hoặc HTML string) sang Markdown body. */
export function noteContentToMarkdown(content: object | string | null): string {
  if (content == null) return '';
  if (typeof content === 'string') {
    // Có tag HTML -> parse như HTML; ngược lại coi là text thô
    return /<[a-z][\s\S]*>/i.test(content) ? htmlToMarkdown(content) : content.trim();
  }
  const doc = content as AnyNode;
  const nodes = Array.isArray(content) ? (content as AnyNode[]) : doc.content;
  return renderBlocks(nodes).trim();
}

/** Một note đầy đủ: tiêu đề (# H1) + dòng tag + body. */
export function noteToMarkdown(
  note: NoteLike,
  opts: { heading?: boolean; tags?: boolean } = {},
): string {
  const { heading = true, tags = true } = opts;
  const head: string[] = [];
  if (heading && note.title) head.push(`# ${note.title}`);
  if (tags && note.tags && note.tags.length) head.push(`*Tags: ${note.tags.join(', ')}*`);
  const body = noteContentToMarkdown(note.content);
  const prefix = head.join('\n\n');
  return (prefix ? prefix + '\n\n' : '') + body;
}

/** Nhiều note gộp thành một file, ngăn cách bằng `---`. */
export function notesToMarkdown(notes: NoteLike[]): string {
  return notes.map((n) => noteToMarkdown(n)).join('\n\n---\n\n').trimEnd() + '\n';
}
