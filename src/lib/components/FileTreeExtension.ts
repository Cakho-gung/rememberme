import { Node, textblockTypeInputRule } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fileTree: {
      setFileTree: () => ReturnType;
      toggleFileTree: () => ReturnType;
    };
  }
}

export interface TreeLineItem {
  depth: number;
  content: string;
  isBranch?: boolean;
}

/**
 * Tính số cấp thụt lề (depth) từ chuỗi ancestor/leading prefix
 * Mỗi cột cấp chiếm 4 ký tự ("│   " hoặc "    ")
 */
export function getDepthFromAncestor(ancestorStr: string): number {
  if (!ancestorStr) return 0;
  const str = ancestorStr.replace(/\t/g, '    ');
  let count = 0;
  let i = 0;
  while (i < str.length) {
    const ch = str[i];
    if (ch === '│' || ch === '|') {
      count++;
      i++;
      // Bỏ qua tối đa 3 khoảng trắng đi kèm thanh dọc của cột này
      let skipped = 0;
      while (i < str.length && str[i] === ' ' && skipped < 3) {
        i++;
        skipped++;
      }
    } else if (ch === ' ') {
      let spaces = 0;
      while (i < str.length && str[i] === ' ' && spaces < 4) {
        i++;
        spaces++;
      }
      if (spaces >= 2) {
        count++;
      }
    } else {
      i++;
    }
  }
  return count;
}

/**
 * Phân tích text hiện tại thành danh sách các dòng kèm cấp độ depth và trạng thái nhánh
 */
export function parseTreeLines(rawText: string): TreeLineItem[] {
  const lines = rawText.split('\n');
  const items: TreeLineItem[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 1. Kiểm tra tiền tố nhánh ASCII (├──, └──, +--, `--, etc.)
    const branchMatch = line.match(/^([│\|\s]*)([├└\+\`][─\-]+\s*)(.*)$/);
    if (branchMatch) {
      const ancestorPart = branchMatch[1]; // e.g. "│   │   "
      const depth = getDepthFromAncestor(ancestorPart) + 1;
      const content = branchMatch[3];
      items.push({ depth, content, isBranch: true });
      continue;
    }

    // 2. Dòng chỉ gồm đường dọc / khoảng trắng (spacer line không có nhánh)
    if (/^[│\|\s]*$/.test(line)) {
      const depth = getDepthFromAncestor(line);
      items.push({ depth: Math.max(0, depth), content: '', isBranch: false });
      continue;
    }

    // 3. Dòng có đường dọc nhưng chưa có nhánh (ví dụ user mới gõ ký tự sau thanh dọc)
    const barTextMatch = line.match(/^([│\|\s]*[│\|])\s*(.*)$/);
    if (barTextMatch) {
      const barPart = barTextMatch[1];
      const depth = getDepthFromAncestor(barPart);
      items.push({ depth: Math.max(1, depth), content: barTextMatch[2], isBranch: true });
      continue;
    }

    // 4. Dòng không có nhánh (root hoặc thụt lề thông thường)
    const plainMatch = line.match(/^(\s*)(.*)$/);
    const leading = plainMatch ? plainMatch[1] : '';
    const content = plainMatch ? plainMatch[2] : line;
    const depth = getDepthFromAncestor(leading);
    items.push({ depth, content, isBranch: depth > 0 && content.trim().length > 0 });
  }

  return items;
}

/**
 * Dựng lại cây ASCII hoàn chỉnh và tính toán chính xác offset của từng dòng
 * - Dòng nhánh (isBranch): render đúng ├── hoặc └── dựa vào các sibling bên dưới
 * - Dòng khoảng cách (spacer): render thanh dọc │
 */
export function buildAsciiTree(items: TreeLineItem[]): {
  text: string;
  lines: string[];
  lineOffsets: number[];
  prefixLengths: number[];
} {
  const resultLines: string[] = [];
  const prefixLengths: number[] = [];
  const lineOffsets: number[] = [];
  let currentOffset = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const { depth, content, isBranch = content.trim().length > 0 } = item;

    let prefix = '';
    if (depth > 0) {
      // 1. Xây dựng đường gióng dọc của các cấp cha ancestor [1 .. depth-1]
      for (let d = 1; d < depth; d++) {
        let hasSiblingAfter = false;
        for (let k = i + 1; k < items.length; k++) {
          if (items[k].depth < d) break;
          if (items[k].depth === d) {
            hasSiblingAfter = true;
            break;
          }
        }
        prefix += hasSiblingAfter ? '│   ' : '    ';
      }

      // 2. Xây dựng nhánh của cấp hiện tại (depth)
      let hasSiblingBelow = false;
      for (let k = i + 1; k < items.length; k++) {
        if (items[k].depth < depth) break;
        if (items[k].depth === depth) {
          hasSiblingBelow = true;
          break;
        }
      }

      if (isBranch || content.trim().length > 0) {
        // Dòng là nhánh: render nhánh T (├── ) hoặc nhánh góc (└── ) chính xác
        const isLastSibling = !hasSiblingBelow;
        prefix += isLastSibling ? '└── ' : '├── ';
      } else {
        // Dòng khoảng cách dọc (spacer line): render thanh dọc │
        prefix += '│';
      }
    }

    const fullLine = prefix + content;
    resultLines.push(fullLine);
    prefixLengths.push(prefix.length);
    lineOffsets.push(currentOffset);
    currentOffset += fullLine.length + 1; // +1 cho ký tự '\n'
  }

  return {
    text: resultLines.join('\n'),
    lines: resultLines,
    lineOffsets,
    prefixLengths
  };
}

/**
 * Xác định vị trí dòng và offset tương đối của con trỏ trong node
 */
function getLineInfoFromPos(rawText: string, offsetInNode: number) {
  const lines = rawText.split('\n');
  let currentPos = 0;
  let lineIdx = 0;
  let lineStartOffset = 0;

  for (let i = 0; i < lines.length; i++) {
    const len = lines[i].length;
    const lineEnd = currentPos + len;
    if (offsetInNode >= currentPos && (offsetInNode <= lineEnd || i === lines.length - 1)) {
      lineIdx = i;
      lineStartOffset = currentPos;
      break;
    }
    currentPos = lineEnd + 1;
  }

  const offsetInLine = offsetInNode - lineStartOffset;
  return { lineIdx, offsetInLine, lines };
}

export const FileTreeExtension = Node.create({
  name: 'fileTree',
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,
  isolating: true,

  parseHTML() {
    return [
      { tag: 'pre[data-type="file-tree"]' },
      { tag: 'div[data-type="file-tree"] pre' },
      { tag: 'pre.file-tree-wrapper' }
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'pre',
      { 'data-type': 'file-tree', class: 'file-tree-wrapper', ...HTMLAttributes },
      ['code', { class: 'file-tree-code' }, 0]
    ];
  },

  addCommands() {
    return {
      setFileTree:
        () =>
        ({ commands }: any) => {
          return commands.setNode(this.name);
        },
      toggleFileTree:
        () =>
        ({ commands }: any) => {
          return commands.toggleNode(this.name, 'paragraph');
        }
    };
  },

  addInputRules() {
    return [
      textblockTypeInputRule({
        find: /^```(tree|dirtree|filetree)\s$/,
        type: this.type
      }),
      textblockTypeInputRule({
        find: /^:::(tree|dirtree|filetree)\s$/,
        type: this.type
      })
    ];
  },

  addKeyboardShortcuts() {
    return {
      // --- TAB: Thụt vào 1 cấp & Tự động cập nhật toàn bộ ký tự cây ---
      'Tab': ({ editor }) => {
        const { state, view } = editor;
        const { selection } = state;
        const { $from, $to } = selection;

        if ($from.parent.type.name !== this.name) return false;

        const nodeStart = $from.start();
        const rawText = $from.parent.textContent;
        const fromOffset = $from.pos - nodeStart;
        const toOffset = $to.pos - nodeStart;

        const { lineIdx: fromLineIdx } = getLineInfoFromPos(rawText, fromOffset);
        const { lineIdx: toLineIdx } = getLineInfoFromPos(rawText, toOffset);

        const items = parseTreeLines(rawText);
        if (items.length === 0) return true;

        const currentLineInfo = getLineInfoFromPos(rawText, fromOffset);
        const oldPrefixMatch = currentLineInfo.lines[fromLineIdx].match(/^([│\|\s]*[├└\+\`][─\-]+\s*|[│\|\s]*)/);
        const oldPrefixLen = oldPrefixMatch ? oldPrefixMatch[0].length : 0;
        const contentCursorOffset = Math.max(0, currentLineInfo.offsetInLine - oldPrefixLen);

        // Tăng depth cho các dòng được chọn
        for (let i = fromLineIdx; i <= toLineIdx; i++) {
          if (i < items.length) {
            items[i].depth += 1;
          }
        }

        const { text: newText, lineOffsets, prefixLengths } = buildAsciiTree(items);
        const tr = state.tr;
        const nodeEnd = nodeStart + $from.parent.nodeSize - 2;

        tr.replaceWith(nodeStart, nodeEnd, newText ? state.schema.text(newText) : []);

        const targetPos = Math.min(
          nodeStart + lineOffsets[fromLineIdx] + prefixLengths[fromLineIdx] + contentCursorOffset,
          nodeStart + newText.length
        );
        tr.setSelection(TextSelection.create(tr.doc, targetPos));
        view.dispatch(tr);
        return true;
      },

      // --- SHIFT-TAB: Lùi ra 1 cấp & Tự động cập nhật toàn bộ ký tự cây ---
      'Shift-Tab': ({ editor }) => {
        const { state, view } = editor;
        const { selection } = state;
        const { $from, $to } = selection;

        if ($from.parent.type.name !== this.name) return false;

        const nodeStart = $from.start();
        const rawText = $from.parent.textContent;
        const fromOffset = $from.pos - nodeStart;
        const toOffset = $to.pos - nodeStart;

        const { lineIdx: fromLineIdx } = getLineInfoFromPos(rawText, fromOffset);
        const { lineIdx: toLineIdx } = getLineInfoFromPos(rawText, toOffset);

        const items = parseTreeLines(rawText);
        if (items.length === 0) return true;

        const currentLineInfo = getLineInfoFromPos(rawText, fromOffset);
        const oldPrefixMatch = currentLineInfo.lines[fromLineIdx].match(/^([│\|\s]*[├└\+\`][─\-]+\s*|[│\|\s]*)/);
        const oldPrefixLen = oldPrefixMatch ? oldPrefixMatch[0].length : 0;
        const contentCursorOffset = Math.max(0, currentLineInfo.offsetInLine - oldPrefixLen);

        // Giảm depth cho các dòng được chọn
        for (let i = fromLineIdx; i <= toLineIdx; i++) {
          if (i < items.length) {
            items[i].depth = Math.max(0, items[i].depth - 1);
          }
        }

        const { text: newText, lineOffsets, prefixLengths } = buildAsciiTree(items);
        const tr = state.tr;
        const nodeEnd = nodeStart + $from.parent.nodeSize - 2;

        tr.replaceWith(nodeStart, nodeEnd, newText ? state.schema.text(newText) : []);

        const targetPos = Math.min(
          nodeStart + lineOffsets[fromLineIdx] + prefixLengths[fromLineIdx] + contentCursorOffset,
          nodeStart + newText.length
        );
        tr.setSelection(TextSelection.create(tr.doc, targetPos));
        view.dispatch(tr);
        return true;
      },

      // --- ENTER: Xuống dòng & Tự động tạo nhánh mới hoặc chuyển thành spacer nếu nhấn Enter 2 lần ---
      'Enter': ({ editor }) => {
        const { state, view } = editor;
        const { selection } = state;
        const { $from, empty } = selection;

        if ($from.parent.type.name !== this.name || !empty) return false;

        const nodeStart = $from.start();
        const rawText = $from.parent.textContent;
        const offset = $from.pos - nodeStart;

        const items = parseTreeLines(rawText);
        const { lineIdx, offsetInLine, lines } = getLineInfoFromPos(rawText, offset);

        const currentItem = items[lineIdx] || { depth: 0, content: '', isBranch: false };
        const oldPrefixMatch = lines[lineIdx]?.match(/^([│\|\s]*[├└\+\`][─\-]+\s*|[│\|\s]*)/);
        const oldPrefixLen = oldPrefixMatch ? oldPrefixMatch[0].length : 0;
        const contentOffset = Math.max(0, offsetInLine - oldPrefixLen);

        // Tách nội dung tại vị trí con trỏ
        const leftContent = currentItem.content.slice(0, contentOffset);
        const rightContent = currentItem.content.slice(contentOffset);

        // Nếu dòng hiện tại là một nhánh rỗng (người dùng nhấn Enter liên tiếp để tạo khoảng cách):
        // Chuyển dòng hiện tại thành dòng khoảng cách dọc (isBranch = false -> │)
        if (currentItem.depth > 0 && currentItem.isBranch && currentItem.content.trim() === '') {
          currentItem.isBranch = false;
        } else {
          currentItem.content = leftContent;
        }

        // Nếu dòng hiện tại là root (depth === 0) hoặc kết thúc bằng '/' -> tự động thụt vào 1 cấp con
        let nextDepth = currentItem.depth === 0 ? 1 : currentItem.depth;
        if (leftContent.trim().endsWith('/') && leftContent.trim().length > 1) {
          nextDepth = currentItem.depth + 1;
        }

        // Chèn dòng mới vào danh sách dạng nhánh (isBranch: true)
        items.splice(lineIdx + 1, 0, {
          depth: nextDepth,
          content: rightContent,
          isBranch: true
        });

        const { text: newText, lineOffsets, prefixLengths } = buildAsciiTree(items);
        const tr = state.tr;
        const nodeEnd = nodeStart + $from.parent.nodeSize - 2;

        tr.replaceWith(nodeStart, nodeEnd, newText ? state.schema.text(newText) : []);

        const nextLineIdx = lineIdx + 1;
        const targetPos = Math.min(
          nodeStart + lineOffsets[nextLineIdx] + prefixLengths[nextLineIdx],
          nodeStart + newText.length
        );
        tr.setSelection(TextSelection.create(tr.doc, targetPos));
        view.dispatch(tr);
        return true;
      },

      // --- BACKSPACE: Outdent hoặc xoá dòng thông minh ---
      'Backspace': ({ editor }) => {
        const { state, view } = editor;
        const { selection } = state;
        const { $from, empty } = selection;

        if ($from.parent.type.name !== this.name || !empty) return false;

        const nodeStart = $from.start();
        const rawText = $from.parent.textContent;
        const offset = $from.pos - nodeStart;

        const items = parseTreeLines(rawText);
        if (items.length === 0) {
          editor.commands.setNode('paragraph');
          return true;
        }

        const { lineIdx, offsetInLine, lines } = getLineInfoFromPos(rawText, offset);
        const oldPrefixMatch = lines[lineIdx]?.match(/^([│\|\s]*[├└\+\`][─\-]+\s*|[│\|\s]*)/);
        const oldPrefixLen = oldPrefixMatch ? oldPrefixMatch[0].length : 0;

        // Nếu con trỏ ở đầu nội dung (ngay sau tiền tố nhánh / thanh dọc):
        if (offsetInLine <= oldPrefixLen) {
          const currentItem = items[lineIdx];

          // Nếu là nhánh rỗng (ví dụ └──  hoặc ├── ) -> biến thành thanh dọc │ (isBranch = false)
          if (currentItem.depth > 0 && currentItem.isBranch && currentItem.content === '') {
            currentItem.isBranch = false;
            const { text: newText, lineOffsets, prefixLengths } = buildAsciiTree(items);
            const tr = state.tr;
            const nodeEnd = nodeStart + $from.parent.nodeSize - 2;
            tr.replaceWith(nodeStart, nodeEnd, newText ? state.schema.text(newText) : []);
            const targetPos = nodeStart + lineOffsets[lineIdx] + prefixLengths[lineIdx];
            tr.setSelection(TextSelection.create(tr.doc, targetPos));
            view.dispatch(tr);
            return true;
          }

          // Nếu là dòng khoảng cách rỗng (│) và có nhiều hơn 1 dòng -> Xoá dòng này
          if (currentItem.content === '' && items.length > 1) {
            items.splice(lineIdx, 1);
            const { text: newText, lineOffsets, lines: resLines } = buildAsciiTree(items);
            const tr = state.tr;
            const nodeEnd = nodeStart + $from.parent.nodeSize - 2;
            tr.replaceWith(nodeStart, nodeEnd, newText ? state.schema.text(newText) : []);
            const prevLineIdx = Math.max(0, lineIdx - 1);
            const targetPos = nodeStart + lineOffsets[prevLineIdx] + resLines[prevLineIdx].length;
            tr.setSelection(TextSelection.create(tr.doc, targetPos));
            view.dispatch(tr);
            return true;
          }

          // Nếu depth > 0 và có nội dung -> Outdent ra 1 cấp
          if (currentItem.depth > 0) {
            currentItem.depth -= 1;
            const { text: newText, lineOffsets, prefixLengths } = buildAsciiTree(items);
            const tr = state.tr;
            const nodeEnd = nodeStart + $from.parent.nodeSize - 2;
            tr.replaceWith(nodeStart, nodeEnd, newText ? state.schema.text(newText) : []);
            const targetPos = nodeStart + lineOffsets[lineIdx] + prefixLengths[lineIdx];
            tr.setSelection(TextSelection.create(tr.doc, targetPos));
            view.dispatch(tr);
            return true;
          }

          // Nếu chỉ còn 1 dòng duy nhất và rỗng -> Thoát ra paragraph
          if (items.length === 1 && currentItem.content === '') {
            editor.commands.setNode('paragraph');
            return true;
          }
        }

        return false;
      }
    };
  },

  addNodeView() {
    return () => {
      const dom = document.createElement('pre');
      dom.classList.add('file-tree-wrapper');
      dom.dataset.type = 'file-tree';

      const code = document.createElement('code');
      code.classList.add('file-tree-code');
      dom.append(code);

      return {
        dom,
        contentDOM: code,
        update: (updatedNode) => {
          if (updatedNode.type.name !== 'fileTree') return false;
          return true;
        }
      };
    };
  }
});
