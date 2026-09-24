import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import History from '@tiptap/extension-history';

const editor = new Editor({
  extensions: [StarterKit],
});

editor.commands.setContent('<p>Hello World</p>');
editor.commands.setContent('<p>Second note</p>', false, { preserveWhitespace: 'full' });

console.log(editor.can().undo());
