/**
 * Tiny framework-free DOM helpers shared by every panel in src/ui.
 */

type Child = Node | string | null | undefined | false;

type Attrs = Record<string, unknown> & {
  className?: string;
  style?: Partial<CSSStyleDeclaration>;
  onClick?: (e: MouseEvent) => void;
  onInput?: (e: Event) => void;
  onChange?: (e: Event) => void;
};

/** `document.createElement` + attribute/child assignment in one call. No JSX, no VDOM. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'className') {
      node.className = String(value);
    } else if (key === 'style') {
      Object.assign(node.style, value as Partial<CSSStyleDeclaration>);
    } else if (key === 'onClick') {
      node.addEventListener('click', value as (e: MouseEvent) => void);
    } else if (key === 'onInput') {
      node.addEventListener('input', value as (e: Event) => void);
    } else if (key === 'onChange') {
      node.addEventListener('change', value as (e: Event) => void);
    } else if (key.startsWith('data-')) {
      node.setAttribute(key, String(value));
    } else if (key in node) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (node as any)[key] = value;
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    appendChild(node, child);
  }
  return node;
}

export function appendChild(node: HTMLElement, child: Child): void {
  if (child === null || child === undefined || child === false) return;
  if (typeof child === 'string') {
    node.appendChild(document.createTextNode(child));
  } else {
    node.appendChild(child);
  }
}

export function text(value: string): Text {
  return document.createTextNode(value);
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function setChildren(node: HTMLElement, children: Child[]): void {
  clear(node);
  for (const child of children) appendChild(node, child);
}

/** A horizontal meter/bar used throughout the inspector and metrics panels. */
export function meter(fraction: number, colorVar = '--accent'): HTMLDivElement {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
  return el('div', { className: 'meter' }, [
    el('div', {
      className: 'meter-fill',
      style: { width: `${(clamped * 100).toFixed(1)}%`, background: `var(${colorVar})` } as Partial<CSSStyleDeclaration>,
    }),
  ]);
}

/** Triggers a browser "Save As" download for in-memory text content. */
export function downloadText(filename: string, content: string, mime = 'application/octet-stream'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on a timeout so the download has time to start in every browser.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
