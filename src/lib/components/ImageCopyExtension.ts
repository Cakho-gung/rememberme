import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { NodeSelection } from '@tiptap/pm/state';
import { readFile } from '@tauri-apps/plugin-fs';

export const ImageCopyExtension = Extension.create({
  name: 'imageCopy',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('imageCopy'),
        props: {
          handleDOMEvents: {
            copy: (view, event) => {
              const state = view.state;
              const selection = state.selection;
              
              if (selection instanceof NodeSelection && selection.node.type.name === 'image') {
                const nativeSelection = window.getSelection();
                const nativeText = nativeSelection?.toString().trim();
                
                // 1. Live Text issue: If user selected Live Text inside the image,
                // let the native browser copy event handle it.
                // In macOS Live Text, the user selects text inside the image.
                if (nativeText && nativeText.length > 0) {
                  // Return true to tell ProseMirror we handled it, 
                  // but we DON'T preventDefault so the browser natively copies the text!
                  return true; 
                }
                
                // 2. Image copy issue: Copy the image as a Blob so it can be pasted into Google Docs
                const src = selection.node.attrs.src;
                const path = selection.node.attrs.title; // In ImagePasteExtension, we saved the real path in `title`
                
                if (path && (path.endsWith('.png') || path.endsWith('.jpg') || path.endsWith('.jpeg') || path.endsWith('.webp') || path.endsWith('.gif') || path.endsWith('.svg'))) {
                  event.preventDefault(); // Prevent Prosemirror from writing default HTML
                  
                  const pngPromise = (async () => {
                    const fileData = await readFile(path);
                    let mimeType = 'image/png';
                    if (path.toLowerCase().endsWith('.jpg') || path.toLowerCase().endsWith('.jpeg')) mimeType = 'image/jpeg';
                    else if (path.toLowerCase().endsWith('.webp')) mimeType = 'image/webp';
                    else if (path.toLowerCase().endsWith('.gif')) mimeType = 'image/gif';
                    else if (path.toLowerCase().endsWith('.svg')) mimeType = 'image/svg+xml';

                    const blob = new Blob([fileData], { type: mimeType });
                    const objectUrl = URL.createObjectURL(blob);
                    
                    const img = new Image();
                    img.src = objectUrl;
                    await new Promise((resolve, reject) => {
                      img.onload = resolve;
                      img.onerror = reject;
                    });
                    
                    const canvas = document.createElement("canvas");
                    canvas.width = img.naturalWidth;
                    canvas.height = img.naturalHeight;
                    const ctx = canvas.getContext("2d");
                    if (!ctx) throw new Error("No canvas context");
                    
                    ctx.drawImage(img, 0, 0);
                    const pngBlob = await new Promise<Blob>((resolve, reject) => {
                      canvas.toBlob((b) => {
                        if (b) resolve(b);
                        else reject(new Error("Failed to create PNG blob"));
                      }, "image/png");
                    });
                    
                    URL.revokeObjectURL(objectUrl);
                    return pngBlob;
                  })();

                  const htmlPromise = Promise.resolve(new Blob([`<img src="${src}">`], { type: 'text/html' }));

                  // Write to clipboard natively. Using promises allows bypassing the gesture expiration.
                  navigator.clipboard.write([
                    new ClipboardItem({
                      'image/png': pngPromise,
                      'text/html': htmlPromise
                    })
                  ]).then(async () => {
                    const { showToast } = await import('$lib/toastStore');
                    showToast('Copied image to clipboard');
                  }).catch(err => {
                    console.error('Failed to copy image to clipboard:', err);
                  });
                  
                  return true;
                }
              }
              
              return false;
            }
          }
        }
      })
    ];
  }
});
