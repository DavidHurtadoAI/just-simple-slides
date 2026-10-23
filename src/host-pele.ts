import { loadMermaid } from 'obsidian';
import { optionalPele, type PeleEngine } from './diagram-renderer';

let loading: Promise<PeleEngine | null> | undefined;

/** loadMermaid is the public loader. Obsidian 1.15 also exposes its Pele
 * runtime on the application's window after loading. That global is optional:
 * older hosts, failed loads, or changed APIs retain native Markdown rendering.
 * Use the application's window, not a popout's separate JavaScript global.
 */
export function loadHostPele(): Promise<PeleEngine | null> {
  return loading ??= optionalPele(() => loadMermaid(), () => (window as Window & { pele?: unknown }).pele);
}
