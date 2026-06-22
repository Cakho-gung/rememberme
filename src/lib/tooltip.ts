export type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipOptions {
  text?: string;
  position?: TooltipPosition;
  delay?: number;
}

type NormalizedOpts = Required<Omit<TooltipOptions, 'text'>> & { text?: string };

function normalize(o: TooltipOptions | string): NormalizedOpts {
  const raw = typeof o === 'string' ? { text: o } : o;
  return {
    text: raw.text,
    position: raw.position ?? 'bottom',
    delay: raw.delay ?? 450,
  };
}

export function tooltip(
  node: HTMLElement,
  options: TooltipOptions | string = {}
) {
  let opts = normalize(options);
  let el: HTMLElement | null = null;
  let showTimer: ReturnType<typeof setTimeout>;
  let hideTimer: ReturnType<typeof setTimeout>;

  function getText(): string {
    return opts.text ?? node.getAttribute('aria-label') ?? '';
  }

  function show() {
    const text = getText();
    if (!text) return;
    clearTimeout(hideTimer);
    showTimer = setTimeout(() => {
      if (el) return;
      el = document.createElement('div');
      el.className = 'app-tooltip';
      el.textContent = text;
      document.body.appendChild(el);
      reposition();
      void el.offsetWidth;
      el.classList.add('visible');
    }, opts.delay);
  }

  function hide() {
    clearTimeout(showTimer);
    if (!el) return;
    const toRemove = el;
    el = null;
    toRemove.classList.remove('visible');
    hideTimer = setTimeout(() => toRemove.remove(), 130);
  }

  function reposition() {
    if (!el) return;
    const rect = node.getBoundingClientRect();
    const gap = 7;

    el.style.left = '0px';
    el.style.top = '0px';
    const tipW = el.offsetWidth;
    const tipH = el.offsetHeight;

    let top: number, left: number;
    switch (opts.position) {
      case 'top':
        top = rect.top - tipH - gap;
        left = rect.left + rect.width / 2 - tipW / 2;
        break;
      case 'left':
        top = rect.top + rect.height / 2 - tipH / 2;
        left = rect.left - tipW - gap;
        break;
      case 'right':
        top = rect.top + rect.height / 2 - tipH / 2;
        left = rect.right + gap;
        break;
      default: // bottom
        top = rect.bottom + gap;
        left = rect.left + rect.width / 2 - tipW / 2;
    }

    left = Math.max(4, Math.min(window.innerWidth - tipW - 4, left));
    top = Math.max(4, Math.min(window.innerHeight - tipH - 4, top));

    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  const onEnter = () => show();
  const onLeave = () => hide();
  const onClick = () => hide();

  node.addEventListener('mouseenter', onEnter);
  node.addEventListener('mouseleave', onLeave);
  node.addEventListener('click', onClick);

  return {
    update(newOptions: TooltipOptions | string) {
      opts = normalize(newOptions);
    },
    destroy() {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      hide();
      node.removeEventListener('mouseenter', onEnter);
      node.removeEventListener('mouseleave', onLeave);
      node.removeEventListener('click', onClick);
    },
  };
}
