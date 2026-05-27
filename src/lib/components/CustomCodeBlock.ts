import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';

const COMMON_LANGUAGES = [
  { value: 'text', label: 'Plain Text' },
  { value: 'c', label: 'C' },
  { value: 'cpp', label: 'C++' },
  { value: 'csharp', label: 'C#' },
  { value: 'css', label: 'CSS' },
  { value: 'xml', label: 'HTML/XML' },
  { value: 'java', label: 'Java' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'json', label: 'JSON' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'python', label: 'Python' },
  { value: 'rust', label: 'Rust' },
  { value: 'sql', label: 'SQL' },
  { value: 'typescript', label: 'TypeScript' }
];

export const CustomCodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('div');
      dom.classList.add('code-block-wrapper');

      const actionsContainer = document.createElement('div');
      actionsContainer.classList.add('code-block-actions');
      actionsContainer.contentEditable = 'false';

      // --- Language Dropdown ---
      const langSelect = document.createElement('select');
      langSelect.classList.add('code-lang-select');
      
      COMMON_LANGUAGES.forEach(lang => {
        const option = document.createElement('option');
        option.value = lang.value;
        option.innerText = lang.label;
        langSelect.appendChild(option);
      });

      // Update select value when node changes
      const updateLanguage = (currentNode: typeof node) => {
        const lang = currentNode.attrs.language || 'text';
        langSelect.value = lang;
        // Update the code class for highlight.js themes
        code.className = `hljs language-${lang}`;
      };

      langSelect.addEventListener('change', (e) => {
        const target = e.target as HTMLSelectElement;
        const newLang = target.value;
        if (typeof getPos === 'function') {
          const pos = getPos();
          if (typeof pos === 'number') {
            editor.view.dispatch(
              editor.state.tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                language: newLang !== 'text' ? newLang : null
              })
            );
          }
        }
      });

      // --- Copy Button ---
      const button = document.createElement('button');
      button.classList.add('copy-code-btn');
      button.title = "Copy Code";
      button.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
      `;
      
      let copyTimeout: ReturnType<typeof setTimeout>;
      button.addEventListener('click', () => {
        const codeText = node.textContent;
        navigator.clipboard.writeText(codeText);
        
        button.classList.add('copied');
        button.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        `;
        
        clearTimeout(copyTimeout);
        copyTimeout = setTimeout(() => {
          button.classList.remove('copied');
          button.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          `;
        }, 2000);
      });

      actionsContainer.append(langSelect, button);

      const pre = document.createElement('pre');
      const code = document.createElement('code');
      // Set initial classes
      code.classList.add('hljs');
      
      // Let tiptap manage the inner content
      pre.append(code);

      dom.append(actionsContainer, pre);

      // Call updateLanguage after code is created to set initial language class
      updateLanguage(node);

      return {
        dom,
        contentDOM: code,
        update: (updatedNode) => {
          if (updatedNode.type !== node.type) return false;
          updateLanguage(updatedNode);
          return true;
        },
      };
    };
  },
});
