import { Extension } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';

export const SmartSelectAll = Extension.create({
  name: 'smartSelectAll',
  addKeyboardShortcuts() {
    return {
      'Mod-a': ({ editor }) => {
        const { state, dispatch } = editor.view;
        const { selection } = state;
        const { $from, $to } = selection;
        
        // If selection crosses multiple blocks, let default handle it (select all)
        if ($from.depth !== $to.depth || $from.start($from.depth) !== $to.start($to.depth)) {
          return false;
        }

        if ($from.depth === 0) {
          return false;
        }

        const blockStart = $from.start($from.depth);
        const blockNode = $from.node($from.depth);
        const blockEnd = blockStart + blockNode.content.size;

        // If the block is already fully selected, let the default select-all take over
        if (selection.from === blockStart && selection.to === blockEnd) {
          return false;
        }

        // Otherwise, select just the current block
        if (dispatch) {
          const newSelection = TextSelection.create(state.doc, blockStart, blockEnd);
          dispatch(state.tr.setSelection(newSelection));
        }
        
        return true;
      }
    };
  }
});
