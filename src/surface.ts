import { Component, MarkdownRenderer, type App } from 'obsidian';

export const SLIDE_WIDTH = 1600;
export const SLIDE_HEIGHT = 900;

/** Shared renderer: editor, thumbnails, and player display exactly the same layout. */
export class SlideSurface extends Component {
  readonly viewport: HTMLElement;
  private canvas: HTMLElement | null = null;
  private rendered: Component | null = null;
  private sequence = 0;
  private observer: ResizeObserver;
  private mutation: MutationObserver | null = null;
  private frame = 0;
  private win: NonNullable<Document['defaultView']>;

  constructor(private app: App, host: HTMLElement, private label: string) {
    super();
    this.viewport = host.createDiv({ cls: 'jss-viewport', attr: { 'aria-label': label } });
    this.win = host.ownerDocument.defaultView!;
    this.observer = this.observeViewport();
    this.register(() => {
      this.sequence++;
      this.observer.disconnect();
      this.mutation?.disconnect();
      this.win.cancelAnimationFrame(this.frame);
      this.viewport.remove();
    });
  }

  async render(markdown: string, path: string): Promise<void> {
    const sequence = ++this.sequence;
    const component = this.addChild(new Component());
    const next = this.viewport.createDiv({ cls: 'jss-slide markdown-rendered jss-preparing' });
    const source = next.createDiv();
    try {
      await MarkdownRenderer.render(this.app, markdown, source, path, component);
      if (sequence !== this.sequence) { this.removeChild(component); next.remove(); return; }
      // Use Obsidian's parsed callouts, so folded, nested, and lazy-continuation
      // notes disappear as a whole. Literal examples inside code remain content.
      source.querySelectorAll('.callout[data-callout="slide" i]').forEach(callout => callout.remove());
      // Heading level is deliberately irrelevant. Preserve all later headings as body content.
      const headings = [...source.children].filter(el => /^H[1-6]$/.test(el.tagName));
      const header = next.createDiv({ cls: 'jss-slide-header' });
      for (const [index, heading] of headings.slice(0, 2).entries()) {
        const region = header.createDiv({ cls: index ? 'jss-subtitle-region' : 'jss-title-region' });
        const content = region.createDiv({ cls: 'jss-fit-content' });
        heading.classList.add(index ? 'jss-subtitle' : 'jss-title');
        content.append(heading);
      }
      if (!headings.length) header.remove();
      const body = next.createDiv({ cls: 'jss-slide-body' });
      const textRegion = body.createDiv({ cls: 'jss-text-region' });
      const text = textRegion.createDiv({ cls: 'jss-fit-content jss-text' });
      const media = body.createDiv({ cls: 'jss-media' });
      for (const child of [...source.childNodes]) {
        if (child.nodeType === 1) {
          const element = child as HTMLElement;
          // Only lift standalone images. Rich mixed blocks, diagrams and embeds remain intact.
          const images = [...element.querySelectorAll('img, .image-embed')];
          if ((element.matches('img, .image-embed') || images.length) && !element.textContent?.trim()
            && !element.matches('table, ul, ol, blockquote, pre') && !element.querySelector('table, pre')) {
            // Separate each image so a paragraph containing several images forms a gallery.
            const topImages = element.matches('img, .image-embed') ? [element]
              : [...element.querySelectorAll('.image-embed, img')].filter(image => !image.parentElement?.closest('.image-embed'));
            for (const image of topImages) media.createDiv({ cls: 'jss-media-cell' }).append(image);
            continue;
          }
        }
        text.append(child);
      }
      source.remove();
      const hasText = !!text.textContent?.trim() || !!text.querySelector('svg, canvas, iframe, video, audio, .internal-embed, hr');
      const hasMedia = !!media.children.length;
      next.dataset.layout = hasMedia ? hasText ? 'split' : 'image' : hasText ? 'text' : 'title';
      if (!hasText) textRegion.remove();
      if (!hasMedia) media.remove();
      else media.style.setProperty('--jss-media-columns', String(media.children.length > 1 ? 2 : 1));
      if (!hasText && !hasMedia) body.remove();
      if (!headings.length && !hasText && !hasMedia) {
        next.createDiv({ cls: 'jss-empty-slide', text: 'Empty slide' });
      }
      next.querySelectorAll('input, button, textarea, select').forEach(el => el.setAttribute('disabled', ''));
      next.removeClass('jss-preparing');
      this.canvas?.remove();
      if (this.rendered) this.removeChild(this.rendered);
      this.rendered = component;
      this.canvas = next;
      this.mutation?.disconnect();
      // Includes delayed Markdown postprocessors, resolved local embeds, math and diagrams.
      this.mutation = new MutationObserver(() => this.scheduleFit());
      this.mutation.observe(next, { childList: true, subtree: true, characterData: true });
      component.registerDomEvent(next, 'load', () => this.scheduleFit(), true);
      component.registerDomEvent(next, 'error', () => this.scheduleFit(), true);
      this.fit();
      void next.ownerDocument.fonts.ready.then(() => this.scheduleFit());
    } catch (error) {
      this.removeChild(component);
      next.remove();
      throw error;
    }
  }

  scheduleFit(): void {
    this.fitViewport();
    this.queueFit();
  }

  private queueFit(): void {
    if (this.frame) return;
    this.frame = this.win.requestAnimationFrame(() => {
      this.frame = 0;
      this.fit();
    });
  }

  private observeViewport(): ResizeObserver {
    const observer = new this.win.ResizeObserver(() => this.fitViewport());
    observer.observe(this.viewport);
    return observer;
  }

  /** Resizing changes only the outer scale; the content always uses 1600 × 900. */
  fitViewport(): void {
    const win = this.viewport.ownerDocument.defaultView!;
    if (win !== this.win) {
      const pending = !!this.frame;
      this.win.cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.win = win;
      this.observer.disconnect();
      this.observer = this.observeViewport();
      if (pending) this.queueFit();
    }
    const canvas = this.canvas;
    const width = this.viewport.clientWidth;
    const height = this.viewport.clientHeight;
    if (!canvas || !width || !height) return;
    const scale = Math.min(width / SLIDE_WIDTH, height / SLIDE_HEIGHT);
    canvas.style.setProperty('transform', `scale(${scale})`);
    canvas.style.setProperty('left', `${(width - SLIDE_WIDTH * scale) / 2}px`);
    canvas.style.setProperty('top', `${(height - SLIDE_HEIGHT * scale) / 2}px`);
  }

  fit(): void {
    this.fitViewport();
    const canvas = this.canvas;
    if (!canvas || !this.viewport.clientWidth || !this.viewport.clientHeight) return;
    for (const [selector, maximum] of [['.jss-title-region', 172], ['.jss-subtitle-region', 108]] as const) {
      const region = canvas.querySelector<HTMLElement>(selector);
      if (!region) continue;
      const inner = region.firstElementChild as HTMLElement;
      inner.style.width = `${region.clientWidth}px`;
      const ratio = Math.min(1, maximum / Math.max(1, inner.scrollHeight), region.clientWidth / Math.max(1, inner.scrollWidth));
      inner.style.transform = `scale(${ratio})`;
      region.style.height = `${inner.scrollHeight * ratio}px`;
    }
    const region = canvas.querySelector<HTMLElement>('.jss-text-region');
    if (region) {
      const inner = region.firstElementChild as HTMLElement;
      // Reflow at a smaller font before scaling: dense slides use the full column width.
      inner.style.width = `${region.clientWidth}px`;
      let low = 10, high = 34;
      for (let i = 0; i < 9; i++) {
        const size = (low + high) / 2;
        inner.style.fontSize = `${size}px`;
        if (inner.scrollHeight <= region.clientHeight && inner.scrollWidth <= region.clientWidth + 1) low = size;
        else high = size;
      }
      inner.style.fontSize = `${low}px`;
      const ratio = Math.min(1, region.clientHeight / Math.max(1, inner.scrollHeight), region.clientWidth / Math.max(1, inner.scrollWidth));
      inner.style.transform = `scale(${ratio})`;
      inner.style.top = `${Math.max(0, (region.clientHeight - inner.scrollHeight * ratio) / 2)}px`;
      canvas.dataset.dense = String(low < 20 || ratio < 0.9);
    } else canvas.dataset.dense = 'false';
  }
}
