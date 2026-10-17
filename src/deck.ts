import { readSlideAreas, slideCallout, type SlideArea } from './details.ts';

export interface Slide {
  start: number;
  end: number;
  markdown: string;
  title: string;
  areas: SlideArea[];
}
export interface Deck { slides: Slide[]; eol: string; prefixEnd: number }

/** Offsets always refer to the original string, including its original newlines. */
export function parseDeck(source: string): Deck {
  const lines = [...source.matchAll(/[^\r\n]*(?:\r\n|\n|\r|$)/g)].filter(m => m[0].length);
  const eol = source.match(/\r\n|\n|\r/)?.[0] ?? '\n';
  let prefixEnd = 0;
  if (lines[0]?.[0].replace(/[\r\n]+$/, '').replace(/^\uFEFF/, '').trim() === '---') {
    for (let i = 1; i < lines.length; i++) {
      if (/^(---|\.\.\.)\s*$/.test(lines[i]![0].replace(/[\r\n]+$/, ''))) {
        prefixEnd = lines[i]!.index + lines[i]![0].length;
        break;
      }
    }
  }
  const slides: Slide[] = [];
  let start = prefixEnd;
  let fence = '';
  let fenceSize = 0;
  let inComment = false;
  for (const match of lines) {
    const offset = match.index;
    if (offset < prefixEnd) continue;
    const line = match[0].replace(/[\r\n]+$/, '');
    const marker = !inComment && line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (marker) {
      if (!fence) { fence = marker[1]![0]!; fenceSize = marker[1]!.length; }
      else if (marker[1]![0] === fence && marker[1]!.length >= fenceSize && !marker[2]!.trim()) fence = '';
      continue;
    }
    if (fence) continue;
    if (!inComment && /^ {0,3}---[ \t]*$/.test(line)) {
      slides.push(makeSlide(source, start, offset, slides.length));
      start = offset + match[0].length;
    }
    // Separators in multiline HTML comments belong to that comment.
    for (const token of line.matchAll(/<!--|-->/g)) inComment = token[0] === '<!--';
  }
  slides.push(makeSlide(source, start, source.length, slides.length));
  return { slides, eol, prefixEnd };
}

function makeSlide(source: string, start: number, end: number, index: number): Slide {
  const markdown = source.slice(start, end);
  let fence = '';
  let title = '';
  let previous = '';
  let comment = false;
  for (const line of markdown.split(/\r\n|\n|\r/)) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (marker) { fence = fence ? (marker[1]![0] === fence[0] && marker[1]!.length >= fence.length ? '' : fence) : marker[1]!; continue; }
    if (fence) continue;
    if (comment || line.includes('<!--')) { comment = !line.includes('-->'); continue; }
    const heading = line.match(/^ {0,3}#{1,6}(?:[ \t]+|$)(.*?)(?:[ \t]+#+[ \t]*)?$/);
    if (heading) { title = heading[1]!.trim(); break; }
    if (/^ {0,3}=+[ \t]*$/.test(line) && previous.trim()) { title = previous.trim(); break; }
    previous = line;
  }
  return { start, end, markdown, title: title || `Slide ${index + 1}`, areas: readSlideAreas(markdown) };
}

export function slideAt(deck: Deck, offset: number): number {
  for (let i = deck.slides.length - 1; i >= 0; i--) if (offset >= deck.slides[i]!.start) return i;
  return 0;
}

export function replaceSlide(source: string, slide: Slide, markdown: string): string {
  // A following separator must remain on its own line when the last newline is deleted.
  const eol = source.match(/\r\n|\n|\r/)?.[0] ?? '\n';
  const suffix = source.slice(slide.end);
  const content = suffix && markdown && !/[\r\n]$/.test(markdown) ? markdown + eol : markdown;
  return source.slice(0, slide.start) + content + suffix;
}

export function addSlide(source: string, deck: Deck, index: number, duplicate = false): { source: string; index: number } {
  const slide = deck.slides[index]!;
  const e = deck.eol;
  const markdown = duplicate ? slide.markdown.trim() : slideCallout('Notes', 'Type: content' + e + e + 'Presenter notes go here.', e) + e + e + '## New slide' + e + e + 'Start writing here.';
  const before = source.slice(0, slide.end).replace(/(?:\r\n|\n|\r)*$/, '');
  const after = source.slice(slide.end);
  return { source: before + e + e + '---' + e + e + markdown + e + e + after, index: index + 1 };
}

export function deleteSlide(source: string, deck: Deck, index: number): { source: string; index: number } {
  const current = deck.slides[index]!;
  if (deck.slides.length === 1) return { source: source.slice(0, deck.prefixEnd), index: 0 };
  const start = index ? deck.slides[index - 1]!.end : current.start;
  const end = index ? current.end : deck.slides[1]!.start;
  return { source: source.slice(0, start) + source.slice(end), index: Math.min(index, deck.slides.length - 2) };
}

export function moveSlide(source: string, deck: Deck, index: number, direction: -1 | 1): { source: string; index: number } {
  return moveSlideTo(source, deck, index, index + direction);
}

/** Move a whole slide to its final zero-based index, including its private notes. */
export function moveSlideTo(source: string, deck: Deck, index: number, target: number): { source: string; index: number } {
  if (!Number.isInteger(index) || !Number.isInteger(target) || !deck.slides[index]
    || target < 0 || target >= deck.slides.length || index === target) return { source, index };
  const order = [...deck.slides];
  const [slide] = order.splice(index, 1);
  order.splice(target, 0, slide!);
  const separators = deck.slides.slice(0, -1).map((slide, i) => source.slice(slide.end, deck.slides[i + 1]!.start));
  const content = order.map((slide, i) => {
    const body = i < order.length - 1 && slide.markdown && !/[\r\n]$/.test(slide.markdown)
      ? slide.markdown + deck.eol : slide.markdown;
    return body + (separators[i] ?? '');
  }).join('');
  return { source: source.slice(0, deck.prefixEnd) + content, index: target };
}

export interface Snapshot { source: string; index: number; anchor: number; head: number; mode?: 'markdown' | 'area'; areaIndex?: number }
/** Document-wide undo, including edits before switching slides and slide operations. */
export class DeckHistory {
  private past: Snapshot[] = [];
  private future: Snapshot[] = [];
  private lastTime = 0;
  private lastIndex = -1;
  record(before: Snapshot, typing = false, now = Date.now()): void {
    if (!typing || before.index !== this.lastIndex || now - this.lastTime > 600) {
      this.past.push(before);
      if (this.past.length > 100) this.past.shift();
    }
    this.lastTime = typing ? now : 0;
    this.lastIndex = before.index;
    this.future = [];
  }
  breakGroup(): void { this.lastTime = 0; }
  undo(current: Snapshot): Snapshot | undefined {
    const value = this.past.pop();
    if (value) this.future.push(current);
    this.breakGroup();
    return value;
  }
  redo(current: Snapshot): Snapshot | undefined {
    const value = this.future.pop();
    if (value) this.past.push(current);
    this.breakGroup();
    return value;
  }
}
