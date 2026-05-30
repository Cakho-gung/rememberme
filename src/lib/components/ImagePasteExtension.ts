/**
 * ImagePasteExtension.ts
 *
 * Tiptap extension tự viết để xử lý:
 * 1. Paste ảnh từ clipboard (Ctrl+V)
 * 2. Drop file ảnh vào editor
 * 3. Click ảnh để mở bằng OS image viewer (Windows Photos, macOS Preview...)
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { openPath } from '@tauri-apps/plugin-opener';

const ImagePasteKey = new PluginKey('imagePaste');

async function uploadImageBlob(blob: Blob): Promise<{ src: string; path: string }> {
  const ext = blob.type === 'image/png' ? 'png'
    : blob.type === 'image/jpeg' ? 'jpg'
    : blob.type === 'image/gif' ? 'gif'
    : blob.type === 'image/webp' ? 'webp'
    : 'png';

  const arrayBuffer = await blob.arrayBuffer();
  const bytes = Array.from(new Uint8Array(arrayBuffer));

  const filePath = await invoke<string>('save_image', {
    imageData: bytes,
    ext,
  });

  const src = convertFileSrc(filePath);
  return { src, path: filePath };
}

async function insertImages(
  files: File[],
  view: any,
  pos?: number
) {
  const imageFiles = files.filter(f => f.type.startsWith('image/'));
  if (imageFiles.length === 0) return false;

  for (const file of imageFiles) {
    try {
      const { src, path } = await uploadImageBlob(file);
      const { schema } = view.state;
      // Store the original file path in `title` attribute (used for opening with OS)
      const node = schema.nodes.image.create({ src, title: path });
      const insertPos = pos ?? view.state.selection.from;
      const tr = view.state.tr.insert(insertPos, node);
      view.dispatch(tr);
    } catch (err) {
      console.error('[ImagePaste] Failed to save image:', err);
    }
  }

  return true;
}

export const ImagePasteExtension = Extension.create({
  name: 'imagePaste',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: ImagePasteKey,
        props: {
          // Handle double click on image nodes — open lightbox
          handleDoubleClickOn(view, pos, node, nodePos, event, direct) {
            if (node.type.name !== 'image') return false;

            const imgSrc = node.attrs.src;
            if (!imgSrc) return false;

            // Phát sự kiện mở lightbox thay vì gọi OS
            window.dispatchEvent(new CustomEvent('open-lightbox', { detail: imgSrc }));

            // Return true để ngăn chặn các hành vi mặc định khác (nếu có)
            return true;
          },

          // Handle paste from clipboard
          handlePaste(view, event) {
            const items = event.clipboardData?.items;
            if (!items) return false;

            const imageFiles: File[] = [];
            for (const item of Array.from(items)) {
              if (item.type.startsWith('image/')) {
                const file = item.getAsFile();
                if (file) imageFiles.push(file);
              }
            }

            if (imageFiles.length === 0) return false;

            event.preventDefault();
            insertImages(imageFiles, view);
            return true;
          },

          // Handle drag & drop of image files
          handleDrop(view, event) {
            const files = event.dataTransfer?.files;
            if (!files || files.length === 0) return false;

            const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
            if (imageFiles.length === 0) return false;

            event.preventDefault();

            // Find the drop position in the document
            const coordinates = view.posAtCoords({
              left: event.clientX,
              top: event.clientY,
            });
            const pos = coordinates?.pos;

            insertImages(imageFiles, view, pos);
            return true;
          },
        },
      }),
    ];
  },
});
