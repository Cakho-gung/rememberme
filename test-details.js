const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.navigator = { userAgent: 'node.js' };

const { Editor } = require('@tiptap/core');
const Details = require('@tiptap/extension-details').default;
const DetailsSummary = require('@tiptap/extension-details-summary').default;
const DetailsContent = require('@tiptap/extension-details-content').default;

const editor = new Editor({
  extensions: [Details, DetailsSummary, DetailsContent]
});
editor.commands.setDetails();
console.log(editor.getHTML());
