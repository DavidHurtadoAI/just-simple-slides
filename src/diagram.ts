import { Component, sanitizeHTMLToDom } from 'obsidian';
import { DIAGRAM_FONT_SIZE, diagramError, renderDiagram, seriesColor, type PeleEngine } from './diagram-renderer';

/** The parent slide owns observation and scheduling. No per-diagram observers,
 * automatic direction changes, network resources, or zoom keyboard handlers.
 */
export class PeleDiagram extends Component {
  private signature = '';
  private document: Document | null = null;
  dense = false;

  constructor(readonly host: HTMLElement, private source: string, private idPrefix: string, private engine: PeleEngine) {
    super();
    host.addClass('jss-diagram');
    host.dataset.diagramEngine = 'obsidian-pele';
    host.setAttribute('aria-label', 'Mermaid diagram');
  }

  invalidate(): void { this.signature = ''; }

  fit(): void {
    const host = this.host, document = host.ownerDocument;
    const width = host.clientWidth, height = host.clientHeight;
    if (!width || !height) return;
    const style = document.defaultView!.getComputedStyle(host);
    const fontFamily = style.fontFamily, fontFamilyMono = style.getPropertyValue('--font-monospace').trim() || 'monospace';
    const background = style.getPropertyValue('--background-primary').trim();
    for (const [i, color] of ['blue', 'orange', 'green', 'red', 'purple', 'cyan', 'yellow', 'pink'].entries()) {
      host.style.setProperty(`--pele-series-${i + 1}`, seriesColor(style.getPropertyValue(`--color-${color}`), background, style.color));
    }
    const signature = JSON.stringify([width, fontFamily, fontFamilyMono]);
    if (this.signature === signature && this.document === document) {
      this.updateDensity(width, height); return;
    }
    this.signature = signature; this.document = document;
    // Never leave the previous successful diagram under a new error.
    host.empty(); this.dense = false;
    try {
      const context = document.adoptNode(createEl('canvas')).getContext('2d');
      if (!context) throw Error('Text measurement is unavailable.');
      const result = renderDiagram(this.engine, this.source, { width, fontFamily, fontFamilyMono, idPrefix: this.idPrefix,
        measurer: { width(text, size, flags) {
          context.font = `${flags & 2 ? 'italic ' : ''}${flags & 1 ? '700' : '400'} ${size}px ${flags & 4 ? fontFamilyMono : fontFamily}`;
          return context.measureText(text).width;
        } },
      });
      host.append(document.importNode(sanitizeHTMLToDom(result.svg), true));
      const svg = host.querySelector('svg');
      if (!svg) throw Error('The SVG could not be displayed.');
      svg.style.setProperty('--pele-font', fontFamily);
      svg.style.setProperty('--pele-font-mono', fontFamilyMono);
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      host.dataset.diagramType = result.type;
      host.dataset.diagramWidth = String(result.width); host.dataset.diagramHeight = String(result.height);
      host.removeClass('jss-diagram-error');
      this.updateDensity(width, height);
    } catch (error) {
      host.empty(); host.addClass('jss-diagram-error');
      delete host.dataset.diagramType; delete host.dataset.diagramWidth; delete host.dataset.diagramHeight;
      host.createEl('pre', { text: diagramError(error, this.engine), attr: { role: 'status' } });
    }
  }

  private updateDensity(width: number, height: number): void {
    const naturalWidth = Number(this.host.dataset.diagramWidth), naturalHeight = Number(this.host.dataset.diagramHeight);
    this.dense = naturalWidth > 0 && naturalHeight > 0
      && DIAGRAM_FONT_SIZE * Math.min(width / naturalWidth, height / naturalHeight) < 20;
  }
}
