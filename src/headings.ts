import { parseDeck } from './deck.ts';
import { TITLE_MARKER } from './presentation-title.ts';
import { slideHeadings, headingSlots, replaceRanges, type Range } from './slide-headings.ts';
export { slideHeadings } from './slide-headings.ts';
interface Edit extends Range { text: string }

/** A separate H1 title and H2/H3 slide headings, applied as one document change. */
export function normalizeHeadings(source: string, title: string): string {
  title = title.trim();
  if (!title || /[\r\n]/.test(title)) throw new Error('A single-line presentation title is required.');
  const deck = parseDeck(source);
  const edits: Edit[] = [];
  for (const slide of deck.slides) {
    const headings = slideHeadings(slide.markdown);
    const slots = headingSlots(slide.markdown);
    const roles = new Map(slots.flatMap((slot, index) => slot.heading ? [[slot.from, index] as const] : []));
    const bodyLevels = headings.filter(heading => !roles.has(heading.from)).map(heading => heading.level);
    const shift = bodyLevels.length ? Math.max(0, 4 - Math.min(...bodyLevels)) : 0;
    headings.forEach(heading => {
      const i = roles.get(heading.from);
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
