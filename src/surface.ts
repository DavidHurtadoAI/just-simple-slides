import { Component, MarkdownRenderer, type App } from 'obsidian';
import { prepareDiagrams } from './markdown-blocks';
import { PeleDiagram } from './diagram';
import { loadHostPele } from './host-pele';
import { headingSlots, prepareSlideHeadings } from './slide-headings';

export const SLIDE_WIDTH = 1600;
export const SLIDE_HEIGHT = 900;

/** Shared renderer: editor, thumbnails, and player display exactly the same layout. */
export class SlideSurface extends Component {
  readonly viewport: HTMLElement;
  private canvas: HTMLElement | null = null;
  private rendered: Component | null = null;
  private outgoing: HTMLElement | null = null;
  private finishTransition: (() => void) | null = null;
  private sequence = 0;
  private observer: ResizeObserver;
  private mutation: MutationObserver | null = null;
  private frame = 0;
  private win: NonNullable<Document['defaultView']>;
  private diagrams: PeleDiagram[] = [];
  private fitted = false;
  private disposed = false;
  private fontDocument: Document;
  private fontsChanged = (): void => {
    for (const diagram of this.diagrams) diagram.invalidate();
    this.scheduleFit();
  };

  get headingsEditable(): boolean {
    return this.canvas?.dataset.headingEditing === 'true' && !this.viewport.querySelector('.jss-preparing');
  }

  constructor(private app: App, host: HTMLElement, private label: string) {
    super();
    this.viewport = host.createDiv({ cls: 'jss-viewport', attr: { 'aria-label': label } });
    this.win = host.ownerDocument.defaultView!;
    this.fontDocument = host.ownerDocument;
    this.fontDocument.fonts.addEventListener('loadingdone', this.fontsChanged);
    this.observer = this.observeViewport();
    this.register(() => {
      this.sequence++;
      this.disposed = true;
      this.diagrams = [];
      this.finishTransition?.();
      this.observer.disconnect();
      this.mutation?.disconnect();
      this.win.cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.fontDocument.fonts.removeEventListener('loadingdone', this.fontsChanged);
      this.viewport.remove();
    });
  }

  async render(markdown: string, path: string, transition: 'none' | 'fade' = 'none'): Promise<void> {
    if (this.disposed) return;
    const sequence = ++this.sequence;
    const component = this.addChild(new Component());
    const next = this.viewport.createDiv({ cls: 'jss-slide markdown-rendered jss-preparing' });
    const source = next.createDiv();
    try {
      const token = `jss-${this.win.crypto.randomUUID()}`;
      const withHeadings = prepareSlideHeadings(markdown, token);
      const prepared = prepareDiagrams(withHeadings, token);
      const pele = prepared.diagrams.length ? await loadHostPele() : null;
      if (sequence !== this.sequence) { this.removeChild(component); next.remove(); return; }
      await MarkdownRenderer.render(this.app, pele ? prepared.markdown : withHeadings, source, path, component);
      if (sequence !== this.sequence) { this.removeChild(component); next.remove(); return; }
      // Use Obsidian's parsed callouts, so folded, nested, and lazy-continuation
      // notes disappear as a whole. Literal examples inside code remain content.
      source.querySelectorAll('.callout[data-callout="slide" i]').forEach(callout => callout.remove());
      const diagrams: PeleDiagram[] = [];
      for (const host of source.querySelectorAll<HTMLElement>('.jss-diagram-slot[data-jss-diagram]')) {
        const block = prepared.diagrams.find(block => block.key === host.dataset.jssDiagram);
        if (block && pele) diagrams.push(component.addChild(new PeleDiagram(host, block.source, block.key, pele)));
      }
      const marked = [0, 1].map(index => {
        const marker = source.querySelector(`[data-jss-header="${token}-${index}"]`);
        const heading = marker?.closest('h1, h2, h3, h4, h5, h6') ?? null;
        // Native heading metadata may retain inline HTML. Remove our own
        // temporary marker there too, preserving ordinary heading links.
        if (heading) for (const attribute of [...heading.attributes]) {
          const clean = attribute.value.replace(`<span data-jss-header="${token}-${index}"></span>`, '');
          if (clean !== attribute.value) heading.setAttribute(attribute.name, clean);
        }
        marker?.remove();
        return heading;
      });
      const legacy = [...source.children].filter(el => /^H[1-6]$/.test(el.tagName)).slice(0, 2);
      const reserved = headingSlots(markdown).some(slot => !slot.heading);
      // Preserve existing HTML/postprocessor headers but edit only mapped Markdown.
      const editable = reserved || [0, 1].every(index => (legacy[index] ?? null) === marked[index]);
      next.dataset.headingEditing = String(editable);
      const headings: Element[] = [];
      const header = next.createDiv({ cls: 'jss-slide-header' });
      for (const index of [0, 1]) {
        const heading = editable ? marked[index] : legacy[index];
        if (!heading) continue;
        headings.push(heading);
        const region = header.createDiv({ cls: index ? 'jss-subtitle-region' : 'jss-title-region' });
        const content = region.createDiv({ cls: 'jss-fit-content' });
        heading.classList.add(index ? 'jss-subtitle' : 'jss-title');
        if (editable) heading.setAttribute('data-jss-heading-role', index ? 'subtitle' : 'title');
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
          if (element.matches('.jss-diagram')) {
            media.createDiv({ cls: 'jss-media-cell' }).append(element);
            continue;
          }
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
      const hasText = !!text.textContent?.trim() || !!text.querySelector('svg, canvas, iframe, video, audio, .internal-embed, hr, .jss-diagram');
      const hasMedia = !!media.children.length;
      next.dataset.layout = hasMedia ? hasText ? 'split' : 'image' : hasText ? 'text' : 'title';
      if (!hasText) textRegion.remove();
      if (!hasMedia) media.remove();
      else {
        // A diagram beside text needs the full visual column for its labels.
        const columns = hasText && media.querySelector('.jss-diagram') ? 1 : media.children.length > 1 ? 2 : 1;
        media.style.setProperty('--jss-media-columns', String(columns));
      }
      if (!hasText && !hasMedia) body.remove();
      if (!headings.length && !hasText && !hasMedia) {
        next.createDiv({ cls: 'jss-empty-slide', text: 'Empty slide' });
      }
      next.querySelectorAll('input, button, textarea, select').forEach(el => el.setAttribute('disabled', ''));
      // Finish an interrupted fade only once its replacement is ready. Keep at
      // most two live slides, even when the user holds a navigation key down.
      this.finishTransition?.();
      const previous = this.canvas;
      const previousComponent = this.rendered;
      this.rendered = component;
      this.canvas = next;
      this.diagrams = diagrams;
      this.fitted = false;
      this.mutation?.disconnect();
      // Includes delayed Markdown postprocessors, resolved local embeds, math and diagrams.
      this.mutation = new MutationObserver(() => this.scheduleFit());
      this.mutation.observe(next, { childList: true, subtree: true, characterData: true });
      component.registerDomEvent(next, 'load', () => this.scheduleFit(), true);
      component.registerDomEvent(next, 'error', () => this.scheduleFit(), true);
      this.fit();
      next.removeClass('jss-preparing');
      if (previous && previousComponent && transition === 'fade'
        && !this.win.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        this.outgoing = previous;
        previous.setAttribute('inert', '');
        previous.setAttribute('aria-hidden', 'true');
        // The opaque theme background dissolves over the previous slide,
        // without fading the whole stage through an empty or black frame.
        const animation = next.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 700, easing: 'ease-in-out' });
        const finish = (): void => {
          animation.onfinish = null;
          animation.oncancel = null;
          animation.cancel();
          previous.remove();
          this.removeChild(previousComponent);
          this.outgoing = null;
          this.finishTransition = null;
        };
        this.finishTransition = finish;
        animation.onfinish = finish;
        animation.oncancel = finish;
      } else {
        previous?.remove();
        if (previousComponent) this.removeChild(previousComponent);
      }
      void next.ownerDocument.fonts.ready.then(() => {
        if (sequence === this.sequence && !this.disposed) this.fontsChanged();
      });
    } catch (error) {
      this.removeChild(component);
      next.remove();
      throw error;
    }
  }

  scheduleFit(): void {
    if (this.disposed) return;
    this.fitted = false;
    this.fitViewport();
    this.queueFit();
  }

  private queueFit(): void {
    if (this.frame || this.disposed) return;
    this.frame = this.win.requestAnimationFrame(() => {
      this.frame = 0;
      this.fit();
    });
  }

  private observeViewport(): ResizeObserver {
    const observer = new this.win.ResizeObserver(() => {
      this.fitViewport();
      // Initially hidden slides have never had their content fitted.
      if (!this.fitted) this.queueFit();
    });
    observer.observe(this.viewport);
    return observer;
  }

  /** Resizing changes only the outer scale; the content always uses 1600 × 900. */
  fitViewport(): void {
    if (this.disposed) return;
    const win = this.viewport.ownerDocument.defaultView!;
    if (win !== this.win) {
      const pending = !!this.frame;
      this.win.cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.win = win;
      this.fontDocument.fonts.removeEventListener('loadingdone', this.fontsChanged);
      this.fontDocument = this.viewport.ownerDocument;
      this.fontDocument.fonts.addEventListener('loadingdone', this.fontsChanged);
      for (const diagram of this.diagrams) diagram.invalidate();
      this.fitted = false;
      this.observer.disconnect();
      this.observer = this.observeViewport();
      if (pending || this.canvas) this.queueFit();
    }
    const canvas = this.canvas;
    const width = this.viewport.clientWidth;
    const height = this.viewport.clientHeight;
    if (!canvas || !width || !height) return;
    const scale = Math.min(width / SLIDE_WIDTH, height / SLIDE_HEIGHT);
    for (const slide of [canvas, this.outgoing]) {
      if (!slide) continue;
      slide.style.setProperty('transform', `scale(${scale})`);
      slide.style.setProperty('left', `${(width - SLIDE_WIDTH * scale) / 2}px`);
      slide.style.setProperty('top', `${(height - SLIDE_HEIGHT * scale) / 2}px`);
    }
  }

  fit(): void {
    if (this.disposed) return;
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
    for (const diagram of this.diagrams) {
      diagram.fit();
      if (diagram.dense) canvas.dataset.dense = 'true';
    }
    this.fitted = true;
  }
}
