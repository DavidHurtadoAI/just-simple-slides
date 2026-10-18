import { parser, GFM } from '@lezer/markdown';
import { parseDeck } from './deck.ts';
import { TITLE_MARKER } from './presentation-title.ts';

const markdownParser = parser.configure(GFM);
interface Range { from: number; to: number }
interface Edit extends Range { text: string }
interface Heading extends Range { level: number; markerEnd: number; setext: boolean; text: string }

function replaceRanges(source: string, edits: Edit[]): string {
  for (const edit of edits.sort((a, b) => b.from - a.from)) source = source.slice(0, edit.from) + edit.text + source.slice(edit.to);
  return source;
}

/** Top-level Markdown headings only: quotes, lists, HTML and code stay content. */
export function slideHeadings(markdown: string): Heading[] {
  // Lezer expects a space after ATX markers; Obsidian also accepts a tab.
  // Substitute just that delimiter for parsing, keeping every source offset intact.
  const tree = markdownParser.parse(markdown.replace(/^( {0,3}#{1,6})\t/gm, '$1 '));
  const code: Range[] = [];
  tree.iterate({ enter(node) {
    if (['FencedCode', 'CodeBlock', 'InlineCode', 'HTMLBlock', 'CommentBlock'].includes(node.name)) {
      code.push({ from: node.from, to: node.to });
      return false;
    }
    return true;
  } });
  const protectedAt = (at: number) => code.some(range => at >= range.from && at < range.to);
  const hidden: Range[] = [];
  let comment = -1;
  let math = -1;
  // Obsidian's comments and display math are not ordinary CommonMark blocks.
  for (const line of markdown.matchAll(/[^\r\n]*(?:\r\n|\n|\r|$)/g)) {
    if (!line[0] || protectedAt(line.index)) continue;
    const text = line[0].replace(/[\r\n]+$/, '');
    if (math >= 0) {
      if (/\$\$[ \t]*$/.test(text)) { hidden.push({ from: math, to: line.index + line[0].length }); math = -1; }
      continue;
    }
    if (comment < 0 && /^ {0,3}\$\$(?!.*\$\$)/.test(text)) { math = line.index; continue; }
    for (const token of text.matchAll(/%%/g)) {
      const at = line.index + token.index;
      if (protectedAt(at)) continue;
      if (comment < 0) comment = at;
      else { hidden.push({ from: comment, to: at + 2 }); comment = -1; }
    }
  }
  if (comment >= 0) hidden.push({ from: comment, to: markdown.length });
  if (math >= 0) hidden.push({ from: math, to: markdown.length });
  const headings: Heading[] = [];
  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    const match = node.name.match(/^(ATX|Setext)Heading([1-6])$/);
    if (!match || hidden.some(range => node.from >= range.from && node.from < range.to)) continue;
    const setext = match[1] === 'Setext';
    const mark = setext ? node.lastChild! : node.firstChild!;
    let text = '';
    if (setext) {
      const body = markdown.slice(node.from, mark.from);
      const breaks = node.getChildren('HardBreak').filter(br => br.to - node.from <= body.length)
        .map(br => ({ from: br.from - node.from, to: br.to - node.from, text: '<br>' }));
      text = replaceRanges(body, breaks).replace(/[\r\n]+$/, '').replace(/\r\n|\n|\r/g, ' ').trim();
    }
    headings.push({ from: node.from, to: node.to, level: Number(match[2]), markerEnd: mark.to, setext, text });
  }
  return headings;
}

/** A separate H1 title and H2/H3 slide headings, applied as one document change. */
export function normalizeHeadings(source: string, title: string): string {
  title = title.trim();
  if (!title || /[\r\n]/.test(title)) throw new Error('A single-line presentation title is required.');
  const deck = parseDeck(source);
  const edits: Edit[] = [];
  for (const slide of deck.slides) {
    const headings = slideHeadings(slide.markdown);
    const bodyLevels = headings.slice(2).map(heading => heading.level);
    const shift = bodyLevels.length ? Math.max(0, 4 - Math.min(...bodyLevels)) : 0;
    headings.forEach((heading, i) => {
      const level = i === 0 ? 2 : i === 1 ? 3 : Math.min(6, heading.level + shift);
      const from = slide.start + heading.from;
      edits.push({ from, to: slide.start + (heading.setext ? heading.to : heading.markerEnd),
        text: '#'.repeat(level) + (heading.setext ? ' ' + heading.text : '') });
    });
  }
  if (deck.presentation) {
    edits.push({ from: deck.presentation.headingStart, to: deck.presentation.headingEnd, text: '# ' + title });
  } else {
    const prefix = source.slice(0, deck.prefixEnd);
    const space = prefix && prefix !== '\uFEFF' ? (/[\r\n]$/.test(prefix) ? deck.eol : deck.eol + deck.eol) : '';
    edits.push({ from: deck.prefixEnd, to: deck.prefixEnd, text: space + TITLE_MARKER + deck.eol + '# ' + title + deck.eol + deck.eol });
  }
  return replaceRanges(source, edits.filter(edit => source.slice(edit.from, edit.to) !== edit.text));
}
