import { parser, GFM } from '@lezer/markdown';

const markdownParser = parser.configure(GFM);
// Lezer expects LF. Replace bare CR with an equal-length newline so offsets
// still address the original Markdown, including legacy CR-only files.
const parseMarkdown = (source: string) => markdownParser.parse(source.replace(/\r(?!\n)/g, '\n'));
export interface SourceRange { from: number; to: number }

/** Source offsets, not rendered DOM. Include Obsidian's %% comments. */
export function protectedMarkdown(source: string): SourceRange[] {
  const ranges: SourceRange[] = [], code: SourceRange[] = [];
  parseMarkdown(source).iterate({ enter(node) {
    if (['FencedCode', 'CodeBlock', 'InlineCode'].includes(node.name)) {
      const range = { from: node.from, to: node.to };
      ranges.push(range); code.push(range); return false;
    }
    if (['HTMLBlock', 'CommentBlock'].includes(node.name)) {
      ranges.push({ from: node.from, to: node.to }); return false;
    }
    return true;
  } });
  let start = -1, kind = '';
  for (const token of source.matchAll(/<!--|-->|%%/g)) {
    if (start >= 0) {
      if (token[0] === (kind === '<!--' ? '-->' : '%%')) {
        ranges.push({ from: start, to: token.index + token[0].length }); start = -1;
      }
    } else if (!code.some(range => token.index >= range.from && token.index < range.to) && token[0] !== '-->') {
      start = token.index; kind = token[0];
    }
  }
  if (start >= 0) ranges.push({ from: start, to: source.length });
  return ranges;
}

export interface MermaidBlock { key: string; source: string }

/** Replace genuine Mermaid fences before Obsidian can run its own processor.
 * Markers belong to us; no dependency on Obsidian's Mermaid DOM or timing.
 * CodeText spans omit quote/list prefixes and retain diagram-internal YAML.
 */
export function prepareDiagrams(markdown: string, token: string): { markdown: string; diagrams: MermaidBlock[] } {
  if (!/^[a-zA-Z0-9_-]+$/.test(token)) throw Error('Invalid diagram marker.');
  if (!/\bmermaid\b/i.test(markdown)) return { markdown, diagrams: [] };
  const diagrams: MermaidBlock[] = [];
  const eol = markdown.match(/\r\n|\n|\r/)?.[0] ?? '\n';
  const comments = protectedMarkdown(markdown);
  const replacements: (SourceRange & { text: string })[] = [];
  parseMarkdown(markdown).iterate({ enter(node) {
    if (node.name !== 'FencedCode') return !['CodeBlock', 'InlineCode', 'HTMLBlock', 'CommentBlock'].includes(node.name);
    const info = node.node.getChild('CodeInfo');
    if (!info || !/^mermaid(?:\s|$)/i.test(markdown.slice(info.from, info.to).trim())) return false;
    // A fence is itself protected; an enclosing comment starts before it.
    if (comments.some(range => range.from < node.from && range.to > node.from)) return false;
    const key = `${token}-${diagrams.length}`;
    const source = node.node.getChildren('CodeText').map(text => markdown.slice(text.from, text.to)).join('').replace(/\r$/, '');
    diagrams.push({ key, source });
    const to = node.to - (markdown[node.to - 1] === '\r' && markdown[node.to] === '\n' ? 1 : 0);
    const lineStart = Math.max(markdown.lastIndexOf('\n', node.from - 1), markdown.lastIndexOf('\r', node.from - 1)) + 1;
    const continuation = markdown.slice(lineStart, node.from).replace(/(?:[-+*]|\d+[.)])[ \t]+/g, marker => ' '.repeat(marker.length));
    // HTML blocks need a blank line before following Markdown. Keep that blank
    // line inside the original quote/list so private callouts cannot be split.
    replacements.push({ from: node.from, to, text: `<div class="jss-diagram-slot" data-jss-diagram="${key}"></div>${eol}${continuation}` });
    return false;
  } });
  for (const edit of replacements.reverse()) markdown = markdown.slice(0, edit.from) + edit.text + markdown.slice(edit.to);
  return { markdown, diagrams };
}
