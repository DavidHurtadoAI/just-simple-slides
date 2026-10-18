export interface SlideArea {
  /** Optional selector label. It has no meaning to the slide renderer. */
  name: string;
  content: string;
  start: number;
  headerEnd: number;
  end: number;
  prefix: string;
}

interface Line { text: string; prefix: string; start: number; end: number }
const quote = /^( {0,3}>[ \t]?)(.*)$/;
const fenceMarker = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const interruptsParagraph = /^ {0,3}(?:#{1,6}(?:\s|$)|`{3,}|~{3,}|(?:[-*_][ \t]*){3,}$|[-+*][ \t]|1[.)][ \t]|<|=+[ \t]*$)/;

/** Read every private callout, without changing names or interpreting its contents. */
export function readSlideAreas(markdown: string): SlideArea[] {
  const lines: Line[] = [...markdown.matchAll(/[^\r\n]*(?:\r\n|\n|\r|$)/g)]
    .filter(line => line[0].length)
    .map(line => ({ text: line[0].replace(/[\r\n]+$/, ''), prefix: '', start: line.index, end: line.index + line[0].length }));
  const areas: SlideArea[] = [];
  const scan = (lines: Line[]) => {
    let fence = '';
    let comment = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const marker = !comment && line.text.match(fenceMarker);
      if (marker) {
        if (!fence) fence = marker[1]!;
        else if (marker[1]![0] === fence[0] && marker[1]!.length >= fence.length && !marker[2]!.trim()) fence = '';
        continue;
      }
      if (fence) continue;
      const first = !comment && line.text.match(quote);
      if (first) {
        // Parse one native blockquote, including lazy paragraph continuations.
        // Recursion also finds private callouts nested in ordinary callouts.
        const block: Line[] = [];
        let lazy = false;
        let innerFence = '';
        let last = i;
        for (let j = i; j < lines.length; j++) {
          const current = lines[j]!;
          const quoted = current.text.match(quote);
          if (quoted) {
            const content = quoted[2]!;
            const marker = content.match(fenceMarker);
            if (marker) {
              if (!innerFence) innerFence = marker[1]!;
              else if (marker[1]![0] === innerFence[0] && marker[1]!.length >= innerFence.length && !marker[2]!.trim()) innerFence = '';
              lazy = false;
            } else lazy = !innerFence && !!content.trim() && !interruptsParagraph.test(content);
            block.push({ ...current, text: content, prefix: current.prefix + quoted[1]! });
          } else {
            if (!lazy || !current.text.trim() || interruptsParagraph.test(current.text)) break;
            block.push(current);
          }
          last = j;
        }
        const header = block[0]!.text.match(/^\[!slide\][+-]?[ \t]*(.*)$/i);
        if (header) areas.push({
          name: header[1]!.trim(), content: block.slice(1).map(line => line.text).join('\n'),
          start: line.start, headerEnd: line.end, end: block[block.length - 1]!.end, prefix: block[0]!.prefix,
        });
        scan(block);
        i = last;
        continue;
      }
      for (const token of line.text.matchAll(/<!--|-->/g)) comment = token[0] === '<!--';
    }
  };
  scan(lines);
  return areas;
}

/** Edit only this area's body. Preserve its header and every byte outside it. */
export function updateSlideArea(markdown: string, index: number, content: string, eol = '\n'): string {
  const area = readSlideAreas(markdown)[index];
  if (!area) return markdown;
  const header = markdown.slice(area.start, area.headerEnd);
  const prefix = area.prefix.replace(/[ \t]*$/, '');
  const body = content ? content.split(/\r\n|\n|\r/).map(line => prefix + (line ? ` ${line}` : '')).join(eol) : '';
  const trailing = /[\r\n]$/.test(markdown.slice(area.start, area.end)) || area.end < markdown.length;
  const callout = body ? header + (/[\r\n]$/.test(header) ? '' : eol) + body + (trailing ? eol : '') : header;
  return markdown.slice(0, area.start) + callout + markdown.slice(area.end);
}

export function slideCallout(name = '', content = '', eol = '\n'): string {
  const header = `> [!slide]${name ? ` ${name}` : ''}`;
  return content ? header + eol + content.split(/\r\n|\n|\r/).map(line => line ? `> ${line}` : '>').join(eol) : header;
}

/** Append an empty private notes area, keeping existing Markdown untouched. */
export function appendSlideNotes(markdown: string, eol = '\n'): string {
  if (readSlideAreas(markdown).length) return markdown;
  const gap = markdown ? (/[\r\n]$/.test(markdown) ? eol : eol + eol) : '';
  return markdown + gap + slideCallout('Slide notes', '', eol) + eol + '>' + eol + eol;
}
