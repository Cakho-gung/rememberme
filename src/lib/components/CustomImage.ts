import Image from '@tiptap/extension-image';

export const CustomImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: '50%',
        parseHTML: element => {
          const rawWidth = element.style.width || element.getAttribute('width') || '50%';
          const match = rawWidth.match(/(\d+(?:\.\d+)?%)/);
          return match ? match[1] : '50%';
        },
        renderHTML: attributes => {
          return {
            'data-width': attributes.width
          };
        }
      },
      float: {
        default: 'none',
        parseHTML: element => element.style.float || 'none',
        renderHTML: attributes => {
          return {
            'data-float': attributes.float
          };
        }
      }
    };
  },
  
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('span');
      dom.classList.add('image-resizer-wrapper');
      
      const img = document.createElement('img');
      img.src = node.attrs.src;
      img.alt = node.attrs.alt || '';
      if (node.attrs.title) {
        img.title = node.attrs.title;
      }
      
      // Resizer handles
      const resizerRight = document.createElement('span');
      resizerRight.classList.add('image-resizer-handle', 'right');
      
      const resizerLeft = document.createElement('span');
      resizerLeft.classList.add('image-resizer-handle', 'left');

      dom.append(img, resizerLeft, resizerRight);

      // Helper to apply styles
      const applyStyles = (width: string, float: string) => {
        // Trừ đi 12px gap và 6px (khoảng trắng inline-block) để 2 ảnh 50% có thể nằm cùng 1 dòng
        dom.style.width = `calc(${width} - 12px - 6px)`;
        
        if (float && float !== 'none') {
          dom.style.float = float;
          dom.style.margin = float === 'left' ? '0.5em 1.5em 0.5em 0' : '0.5em 0 0.5em 1.5em';
        } else {
          dom.style.float = 'none';
          dom.style.marginTop = '1em';
          dom.style.marginRight = '12px';
          dom.style.marginBottom = '12px';
          dom.style.marginLeft = '0';
        }
      };

      applyStyles(node.attrs.width, node.attrs.float);

      // Select logic for Prosemirror
      img.addEventListener('click', () => {
        if (typeof getPos === 'function') {
          const pos = getPos();
          if (typeof pos === 'number') {
            editor.commands.setNodeSelection(pos);
          }
        }
      });

      // Resize logic
      let isResizing = false;
      let startX = 0;
      let startWidth = 0;
      let parentWidth = 0;
      let isLeftHandle = false;

      const onMouseMove = (e: MouseEvent) => {
        if (!isResizing) return;
        e.preventDefault();
        
        const dx = e.clientX - startX;
        const delta = isLeftHandle ? -dx : dx;
        
        const targetWidthInPixels = startWidth + delta;
        // applyStyles sets width to calc(percent - 18px), so we add 18px back to find the actual percentage
        let newWidthPercent = ((targetWidthInPixels + 18) / parentWidth) * 100;
        
        // Constraint percentage
        if (newWidthPercent < 10) newWidthPercent = 10;
        if (newWidthPercent > 100) newWidthPercent = 100;
        
        applyStyles(`${newWidthPercent}%`, node.attrs.float);
      };

      const onMouseUp = (e: MouseEvent) => {
        if (!isResizing) return;
        isResizing = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        dom.classList.remove('is-resizing');
        
        let currentWidthRaw = dom.style.width;
        let finalWidth = node.attrs.width;
        const match = currentWidthRaw.match(/(\d+(?:\.\d+)?%)/);
        if (match) {
          finalWidth = match[1];
        }
        
        if (typeof getPos === 'function') {
          const pos = getPos();
          if (typeof pos === 'number') {
            editor.view.dispatch(
              editor.state.tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                width: finalWidth
              })
            );
          }
        }
      };

      const onMouseDown = (e: MouseEvent, isLeft: boolean) => {
        e.preventDefault();
        e.stopPropagation();
        
        isResizing = true;
        isLeftHandle = isLeft;
        startX = e.clientX;
        startWidth = dom.getBoundingClientRect().width;
        
        const parentElement = dom.parentElement;
        parentWidth = parentElement ? parentElement.getBoundingClientRect().width : startWidth;
        
        dom.classList.add('is-resizing');
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      };

      resizerRight.addEventListener('mousedown', (e) => onMouseDown(e, false));
      resizerLeft.addEventListener('mousedown', (e) => onMouseDown(e, true));

      return {
        dom,
        update: (updatedNode) => {
          if (updatedNode.type !== node.type) return false;
          
          if (updatedNode.attrs.src !== img.src) {
            img.src = updatedNode.attrs.src;
          }
          
          applyStyles(updatedNode.attrs.width, updatedNode.attrs.float);
          
          return true;
        },
        selectNode: () => {
          dom.classList.add('ProseMirror-selectednode');
        },
        deselectNode: () => {
          dom.classList.remove('ProseMirror-selectednode');
        },
        stopEvent: (event: Event) => {
          if (isResizing) return true;
          if (event.target === resizerRight || event.target === resizerLeft) {
            return true;
          }
          return false;
        },
        ignoreMutation: () => true
      };
    };
  }
});
