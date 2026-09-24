import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import History from '@tiptap/extension-history';

const editor = new Editor({
  extensions: [
    StarterKit,
    History
  ]
});

console.log('Commands:', Object.keys(editor.commands));
console.log('clearHistory exists:', !!editor.commands.clearHistory);
