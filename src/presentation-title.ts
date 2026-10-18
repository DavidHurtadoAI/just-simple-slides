export const TITLE_MARKER = '<!-- just-simple-slides:title -->';
export interface PresentationTitle { title: string; headingStart: number; headingEnd: number; end: number }

/** An explicit marker keeps existing title-only cover slides as slides. */
export function readPresentationTitle(source: string, from: number): PresentationTitle | undefined {
  const match = source.slice(from).match(/^((?:[ \t]*(?:\r\n|\n|\r))*<!-- just-simple-slides:title -->[ \t]*(?:\r\n|\n|\r)(?:[ \t]*(?:\r\n|\n|\r))*)( {0,3}#{1,6}(?:[ \t]+[^\r\n]*|(?=\r|\n|$)))(?:\r\n|\n|\r|$)/);
  if (!match) return;
  const headingStart = from + match[1]!.length;
  return {
    title: match[2]!.replace(/^ {0,3}#{1,6}[ \t]*/, '').replace(/[ \t]+#+[ \t]*$/, '').trim(),
    headingStart, headingEnd: headingStart + match[2]!.length, end: from + match[0].length,
  };
}
