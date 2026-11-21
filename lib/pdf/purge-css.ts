/**
 * B9a: the PDF page used to carry the whole app's Tailwind stylesheet (~255 KB) to the HTML-to-PDF renderer, although
 * one invoice uses a few hundred classes. This keeps only the rules that can match the document:
 *
 * - A style rule is kept when at least one of its selectors needs only classes the document actually has (class
 *   tokens inside functional pseudo-classes such as :not()/:where() and inside [attribute] brackets are ignored, which
 *   only ever keeps MORE). Selectors without classes (html, body, *, ::before, :root) are always kept.
 * - @media / @supports / @layer / @container blocks are filtered recursively and dropped when empty.
 * - Every other at-rule (@property, @keyframes, @font-face, @import, @charset) is kept unchanged.
 *
 * A rule that needs a class the document does not have cannot match any element, so dropping it never changes the
 * rendered page. The stylesheet is parsed once and cached; filtering per document is a quick walk.
 */

type CssNode =
  | { kind: 'rule'; selector: string; body: string; required: readonly (readonly string[])[] }
  | { kind: 'block'; prelude: string; children: CssNode[] }
  | { kind: 'raw'; text: string };

const RECURSE_AT_RULES = /^@(media|supports|layer|container)\b/i;

// HTML class separators and CSS whitespace are only tab, LF, FF, CR and space. JavaScript's \s and trim() also match
// U+00A0 and other Unicode spaces, which are valid inside class names.
const ASCII_WS = /[\t\n\f\r ]/;
const ASCII_WS_RUN = /[\t\n\f\r ]+/;

function trimAscii(value: string): string {
  return value.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '');
}

/** Index of the matching closing brace for the "{" at `open`, skipping strings and comments. */
function matchBrace(css: string, open: number): number {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    const ch = css[i];
    if (ch === '"' || ch === "'") {
      i = skipString(css, i);
      continue;
    }
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end === -1 ? css.length : end + 1;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return css.length - 1;
}

function skipString(css: string, start: number): number {
  const quote = css[start];
  for (let i = start + 1; i < css.length; i++) {
    if (css[i] === '\\') i++;
    else if (css[i] === quote) return i;
  }
  return css.length - 1;
}

/** Splits on top-level commas (not inside parentheses, brackets or strings). */
function splitSelectorList(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      i = skipString(selector, i);
      continue;
    }
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(selector.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(selector.slice(start));
  return parts.map(trimAscii).filter(Boolean);
}

/** Reads one CSS identifier with escapes from `start`, returning the unescaped name and the end index. */
function readIdent(sel: string, start: number): { name: string; end: number } {
  let name = '';
  let i = start;
  while (i < sel.length) {
    const ch = sel[i];
    if (ch === '\\') {
      const hex = /^[0-9a-fA-F]{1,6}/.exec(sel.slice(i + 1));
      if (hex) {
        name += String.fromCodePoint(parseInt(hex[0], 16));
        i += 1 + hex[0].length;
        if (sel[i] === ' ') i++;
      } else {
        name += sel[i + 1] ?? '';
        i += 2;
      }
      continue;
    }
    if (/[A-Za-z0-9_\-]/.test(ch) || ch.charCodeAt(0) > 127) {
      name += ch;
      i++;
      continue;
    }
    break;
  }
  return { name, end: i };
}

/** PURE: classes a single selector needs, ignoring those inside (...) and [...]. Exported for tests. */
export function requiredClasses(selector: string): string[] {
  const out: string[] = [];
  let depth = 0;
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      i = skipString(selector, i);
      continue;
    }
    if (ch === '(' || ch === '[') {
      depth++;
      continue;
    }
    if (ch === ')' || ch === ']') {
      depth--;
      continue;
    }
    if (ch === '.' && depth === 0) {
      const { name, end } = readIdent(selector, i + 1);
      if (name) out.push(name);
      i = end - 1;
    }
  }
  return out;
}

function parse(css: string): CssNode[] {
  const nodes: CssNode[] = [];
  let i = 0;
  while (i < css.length) {
    while (i < css.length && ASCII_WS.test(css[i])) i++;
    if (i >= css.length) break;
    if (css.startsWith('/*', i)) {
      const end = css.indexOf('*/', i + 2);
      const stop = end === -1 ? css.length : end + 2;
      nodes.push({ kind: 'raw', text: css.slice(i, stop) });
      i = stop;
      continue;
    }
    // Find the end of the prelude: "{" (block) or ";" (statement at-rule), skipping strings.
    let j = i;
    while (j < css.length && css[j] !== '{' && css[j] !== ';' && css[j] !== '}') {
      if (css[j] === '"' || css[j] === "'") j = skipString(css, j);
      j++;
    }
    if (j >= css.length || css[j] === '}') {
      nodes.push({ kind: 'raw', text: css.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    if (css[j] === ';') {
      nodes.push({ kind: 'raw', text: css.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    const prelude = trimAscii(css.slice(i, j));
    const close = matchBrace(css, j);
    const inner = css.slice(j + 1, close);
    if (prelude.startsWith('@')) {
      if (RECURSE_AT_RULES.test(prelude)) nodes.push({ kind: 'block', prelude, children: parse(inner) });
      else nodes.push({ kind: 'raw', text: css.slice(i, close + 1) });
    } else {
      nodes.push({
        kind: 'rule',
        selector: prelude,
        body: inner,
        required: splitSelectorList(prelude).map(requiredClasses),
      });
    }
    i = close + 1;
  }
  return nodes;
}

function emit(nodes: readonly CssNode[], has: (cls: string) => boolean): string {
  let out = '';
  for (const node of nodes) {
    if (node.kind === 'raw') {
      if (!node.text.startsWith('/*')) out += node.text;
    } else if (node.kind === 'rule') {
      if (node.required.some((classes) => classes.every(has))) out += `${node.selector}{${node.body}}`;
    } else {
      const inner = emit(node.children, has);
      // An empty "@layer a,b;" style statement is raw; an empty @layer block with a name still declares order.
      if (inner) out += `${node.prelude}{${inner}}`;
      else if (/^@layer\b/i.test(node.prelude)) out += `${node.prelude}{}`;
    }
  }
  return out;
}

const HTML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", '#x27': "'" };

/** PURE: every class name used in an HTML string (class="..." attributes, entities decoded). Exported for tests. */
export function collectHtmlClasses(html: string): Set<string> {
  const classes = new Set<string>();
  const attr = /\bclass\s*=\s*("([^"]*)"|'([^']*)')/gi;
  let m: RegExpExecArray | null;
  while ((m = attr.exec(html)) !== null) {
    const value = (m[2] ?? m[3] ?? '').replace(/&(#x27|#39|amp|lt|gt|quot|apos);/g, (_, e: string) => HTML_ENTITIES[e]);
    for (const c of value.split(ASCII_WS_RUN)) if (c) classes.add(c);
  }
  return classes;
}

const parsedCache = new Map<string, CssNode[]>();

/** PURE (cached parse): the stylesheet reduced to what `html` can use. */
export function purgeCssForHtml(css: string, html: string): string {
  let nodes = parsedCache.get(css);
  if (!nodes) {
    nodes = parse(css);
    parsedCache.set(css, nodes);
  }
  const classes = collectHtmlClasses(html);
  return emit(nodes, (cls) => classes.has(cls));
}
