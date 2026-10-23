export const DIAGRAM_FONT_SIZE = 32;

export interface TextMeasurer { width(text: string, size: number, flags: number): number }
export interface DiagramResult { svg: string; width: number; height: number; type: string }
export interface PeleEngine {
  render(source: string, options: Record<string, unknown>): unknown;
  parse: (...args: never[]) => unknown;
  supports: (...args: never[]) => unknown;
  PeleError: new (...args: never[]) => Error & { line: number; column: number };
}

/** Probe the host's capabilities, never infer availability from its version. */
export function readPele(value: unknown): PeleEngine | null {
  if (!value || typeof value !== 'object') return null;
  const api = value as Partial<PeleEngine>;
  return ['render', 'parse', 'supports', 'PeleError'].every(key => typeof api[key as keyof PeleEngine] === 'function') ? api as PeleEngine : null;
}

export async function optionalPele(load: () => Promise<unknown>, read: () => unknown): Promise<PeleEngine | null> {
  try { await load(); return readPele(read()); }
  catch { return null; }
}

export interface DiagramMetrics {
  width: number;
  fontFamily: string;
  fontFamilyMono: string;
  idPrefix: string;
  measurer?: TextMeasurer;
}

/** Use only the host engine. Logical width never follows the thumbnail. */
export function renderDiagram(engine: PeleEngine, source: string, metrics: DiagramMetrics): DiagramResult {
  const result = engine.render(source, {
    maxWidth: metrics.width, fontFamily: metrics.fontFamily, fontFamilyMono: metrics.fontFamilyMono,
    fontSize: DIAGRAM_FONT_SIZE, idPrefix: metrics.idPrefix, measurer: metrics.measurer,
    autoDirection: false, responsive: false, links: false, images: false,
  });
  if (!result || typeof result !== 'object') throw Error('Unsupported diagram result.');
  const diagram = result as Partial<DiagramResult>;
  if (typeof diagram.svg !== 'string' || typeof diagram.type !== 'string'
    || typeof diagram.width !== 'number' || !Number.isFinite(diagram.width) || diagram.width <= 0
    || typeof diagram.height !== 'number' || !Number.isFinite(diagram.height) || diagram.height <= 0) throw Error('Unsupported diagram result.');
  return diagram as DiagramResult;
}

export function diagramError(error: unknown, engine: PeleEngine): string {
  if (error instanceof engine.PeleError) {
    const position = error.line > 0 ? ` (line ${error.line}, column ${error.column})` : '';
    return `Could not render Mermaid diagram${position}.\n${error.message}`;
  }
  return 'Could not render Mermaid diagram. Check its syntax and try again.';
}

type RGB = [number, number, number];
function rgb(color: string): RGB | null {
  const hex = color.trim().match(/^#([a-f\d]{3}|[a-f\d]{6})$/i)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map(c => c + c).join('') : hex;
    return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16)) as RGB;
  }
  const match = color.trim().match(/^rgba?\(\s*(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)/i);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}
function luminance(color: RGB): number {
  const channels = color.map(n => { const s = n / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}
export function contrastRatio(first: string, second: string): number {
  const a = luminance(rgb(first) ?? [0, 0, 0]), b = luminance(rgb(second) ?? [255, 255, 255]);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
/** Pele uses the background color as text on colored series. Keep that readable. */
export function seriesColor(color: string, background: string, foreground: string): string {
  const base = rgb(color) ?? [76, 120, 168];
  const bg = rgb(background) ?? [255, 255, 255];
  const css = (values: RGB) => `rgb(${values.map(Math.round).join(', ')})`;
  let ink = rgb(foreground) ?? [0, 0, 0];
  if (contrastRatio(css(ink), css(bg)) < 4.5) ink = luminance(bg) > 0.179 ? [0, 0, 0] : [255, 255, 255];
  if (contrastRatio(css(base), css(bg)) >= 4.5) return css(base);
  let low = 0, high = 1;
  for (let i = 0; i < 12; i++) {
    const mix = (low + high) / 2;
    const candidate = base.map((n, i) => n + (ink[i]! - n) * mix) as RGB;
    if (contrastRatio(css(candidate), css(bg)) >= 4.5) high = mix; else low = mix;
  }
  return css(base.map((n, i) => n + (ink[i]! - n) * high) as RGB);
}
