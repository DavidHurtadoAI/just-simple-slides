import { parser, GFM } from '@lezer/markdown';

const markdownParser = parser.configure(GFM);
export interface Range { from: number; to: number }
interface Edit extends Range { text: string }
export interface Heading extends Range { level: number; markerStart: number; markerEnd: number; setext: boolean; text: string }
export type HeadingRole = 'title' | 'subtitle';
export interface HeadingSlot extends Range { heading: Heading | null }
// A removed heading keeps its place so a subtitle/body heading cannot be promoted.
export const EMPTY_HEADING = '<!-- just-simple-slides:empty-heading -->';

export function replaceRanges(source: string, edits: Edit[]): string {
  for (const edit of edits.sort((a, b) => b.from - a.from)) source = source.slice(0, edit.from) + edit.text + source.slice(edit.to);
  return source;
}

/** Top-level Markdown headings only: quotes, lists, HTML and code stay content. */
function scanHeadings(markdown: string): { headings: Heading[]; empty: Range[] } {
  // Lezer expects a space after ATX markers; Obsidian also accepts a tab.
  // Substitute just that delimiter for parsing, keeping every source offset intact.
  const tree = markdownParser.parse(markdown.replace(/\r(?!\n)/g, '\n').replace(/^( {0,3}#{1,6})\t/gm, '$1 '));
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
  const headings: Heading[] = [], empty: Range[] = [];
  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    if (hidden.some(range => node.from >= range.from && node.from < range.to)) continue;
    let to = node.to;
    while (to > node.from && /[\r\n]/.test(markdown[to - 1]!)) to--;
    if (['HTMLBlock', 'CommentBlock'].includes(node.name) && markdown.slice(node.from, to).trim() === EMPTY_HEADING) empty.push({ from: node.from, to });
    const match = node.name.match(/^(ATX|Setext)Heading([1-6])$/);
    if (!match) continue;
    const setext = match[1] === 'Setext';
    const mark = setext ? node.lastChild! : node.firstChild!;
    let text = '';
    if (setext) {
      const body = markdown.slice(node.from, mark.from);
      const breaks = node.getChildren('HardBreak').filter(br => br.to - node.from <= body.length)
        .map(br => ({ from: br.from - node.from, to: br.to - node.from, text: '<br>' }));
      text = replaceRanges(body, breaks).replace(/[\r\n]+$/, '').replace(/\r\n|\n|\r/g, ' ').trim();
    }
    headings.push({ from: node.from, to, level: Number(match[2]), markerStart: mark.from, markerEnd: mark.to, setext, text });
  }
  return { headings, empty };
}

export function slideHeadings(markdown: string): Heading[] { return scanHeadings(markdown).headings; }

export function headingSlots(markdown: string): HeadingSlot[] {
  const { headings, empty } = scanHeadings(markdown);
  return [...headings.map(heading => ({ from: heading.from, to: heading.to, heading })),
    ...empty.map(range => ({ ...range, heading: null }))].sort((a, b) => a.from - b.from).slice(0, 2);
}

export function headingValue(markdown: string, role: HeadingRole): string {
  const heading = headingSlots(markdown)[role === 'title' ? 0 : 1]?.heading;
  return !heading ? '' : heading.setext ? heading.text
    : markdown.slice(heading.markerEnd, heading.to).replace(/[ \t]+#+[ \t]*$/, '').trim();
}

/** One targeted source edit; no rewrite of body, notes, media or other slides. */
export function changeHeading(markdown: string, role: HeadingRole, value: string): string {
  if (/[\r\n]/.test(value)) throw Error('A single-line heading is required.');
  value = value.trim();
  const index = role === 'title' ? 0 : 1, slots = headingSlots(markdown), slot = slots[index];
  if (value === headingValue(markdown, role) && (value || !slot?.heading)) return markdown;
  const eol = markdown.match(/\r\n|\n|\r/)?.[0] ?? '\n';
  let text = EMPTY_HEADING;
  if (value) {
    const heading = slot?.heading;
    if (heading?.setext) text = value + eol + markdown.slice(heading.markerStart, heading.to);
    else if (heading) {
      const raw = markdown.slice(heading.from, heading.to), prefix = raw.match(/^ {0,3}#{1,6}[ \t]*/)![0];
      text = prefix + (/\s$/.test(prefix) ? '' : ' ') + value + (raw.match(/[ \t]+#+[ \t]*$/)?.[0] ?? '');
    } else text = `${index ? '###' : '##'} ${value}`;
  }
  if (slot) return replaceRanges(markdown, [{ ...slot, text }]);
  if (!value) return markdown;
  const first = slots[0];
  if (index && first) {
    const after = markdown.slice(first.to);
    return markdown.slice(0, first.to) + eol + eol + text + (after.startsWith(eol + eol) ? '' : eol) + after;
  }
  return (index ? EMPTY_HEADING + eol + eol : '') + text + eol + eol + markdown;
}

/** Own inline markers identify source headings before native Markdown processing. */
export function prepareSlideHeadings(markdown: string, token: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(token)) throw Error('Invalid heading marker.');
  const edits: Edit[] = [];
  headingSlots(markdown).forEach((slot, index) => {
    const heading = slot.heading;
    if (!heading) return;
    let at = heading.setext ? heading.from : heading.markerEnd;
    const space = heading.setext ? '' : markdown.slice(at).match(/^[ \t]+/)?.[0] ?? '';
    at += space.length;
    edits.push({ from: at, to: at, text: `${!heading.setext && !space ? ' ' : ''}<span data-jss-header="${token}-${index}"></span>` });
  });
  return replaceRanges(markdown, edits);
}
