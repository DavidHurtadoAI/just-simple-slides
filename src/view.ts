import { Component, MarkdownView, Notice, Scope, setIcon, TextFileView, type WorkspaceLeaf } from 'obsidian';
import { EditorState, Text } from '@codemirror/state';
import { drawSelection, EditorView, keymap, lineNumbers, placeholder } from '@codemirror/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { search, searchKeymap } from '@codemirror/search';
import type JustSimpleSlides from './main';
import { addSlide, DeckHistory, deleteSlide, moveSlide, moveSlideTo, parseDeck, replaceSlide, slideAt, type Deck, type Snapshot } from './deck';
import { SlideSurface } from './surface';
import { appendSlideNotes, readSlideAreas, updateSlideArea } from './details';
import { clampSize, DEFAULT_LAYOUT, sidebarBounds, sourceBounds } from './layout';
import { PLUGIN_ICON } from './icon';
import { thumbnailBoundary, thumbnailColumns } from './sorter';
import { normalizeHeadings } from './headings';
import { HeadingModal } from './heading-modal';

export const VIEW_TYPE = 'just-simple-slides';
interface Thumbnail { button: HTMLButtonElement; caption: HTMLElement; surface: SlideSurface | null; markdown?: string; visible: boolean }

export class SlidesView extends TextFileView {
  private root!: HTMLElement;
  private rail!: HTMLElement;
  private stage!: HTMLElement;
  private sourceHost!: HTMLElement;
  private sourceLabel!: HTMLElement;
  private workspace!: HTMLElement;
  private sidebar!: HTMLElement;
  private main!: HTMLElement;
  private sourcePanel!: HTMLElement;
  private editorTabs!: HTMLElement;
  private emptyAreas!: HTMLElement;
  private tabsSignature = '';
  private modeTabs: HTMLButtonElement[] = [];
  private areaIndex: number;
  private sidebarWidth: number;
  private sourceRatio: number;
  private verticalDivider!: HTMLElement;
  private horizontalDivider!: HTMLElement;
  private panelObserver: ResizeObserver | null = null;
  private counter!: HTMLElement;
  private filename!: HTMLElement;
  private density!: HTMLElement;
  private sorter = false;
  private sorterButton!: HTMLButtonElement;
  private editor: EditorView | null = null;
  private surface!: SlideSurface;
  private deck: Deck = parseDeck('');
  private index = 0;
  private history = new DeckHistory();
  private thumbnails: Thumbnail[] = [];
  private thumbOwner: Component | null = null;
  private thumbObserver: IntersectionObserver | null = null;
  private timer = 0;
  private closed = false;
  private player: Presentation | null = null;
  private renderId = 0;
  private currentPreview = '';
  private draggedIndex: number | null = null;
  private dragSource: string | null = null;
  private dropBoundary: number | null = null;
  private dragY: number | null = null;
  private dragX: number | null = null;
  private dragFrame = 0;
  private dragWindow: Window | null = null;
  // TextFileView.data belongs to Obsidian's saved-file lifecycle. Keep the editable
  // buffer separate: core assigns data before calling setViewData on external reloads.
  private source = '';

  constructor(leaf: WorkspaceLeaf, private plugin: JustSimpleSlides) {
    super(leaf);
    this.areaIndex = plugin.layout.areaIndex;
    this.sidebarWidth = plugin.layout.sidebarWidth;
    this.sourceRatio = plugin.layout.sourceRatio;
    this.navigation = true;
    this.scope = new Scope(this.app.scope);
    this.scope.register(['Mod'], 's', () => { void this.save(); return false; });
    this.scope.register(['Mod'], 'z', () => { this.undo(false); return false; });
    this.scope.register(['Mod', 'Shift'], 'z', () => { this.undo(true); return false; });
    this.scope.register(['Mod'], 'y', () => { this.undo(true); return false; });
    this.scope.register([], 'F5', () => { void this.present(); return false; });
  }
  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return this.file?.basename ?? 'Just Simple Slides'; }
  getIcon(): string { return PLUGIN_ICON; }
  getViewData(): string { return this.source ?? ''; }

  async save(clear = false): Promise<void> {
    if (!this.file) return;
    const writer = this.savingView(clear);
    if (writer !== this) {
      // One open buffer owns saving. A closing slide tab hands off to a surviving
      // editor so its pending save cannot later restore stale notes.
      if (writer instanceof SlidesView) await writer.saveBuffer();
      else await writer.save();
      if (clear) this.clear();
    } else await this.saveBuffer(clear);
  }

  private saveBuffer(clear = false): Promise<void> { return super.save(clear); }

  private savingView(closing = false): MarkdownView | SlidesView {
    if (!this.file) return this;
    for (const { view } of this.app.workspace.getLeavesOfType('markdown')) {
      if (view instanceof MarkdownView && view.file === this.file) return view;
    }
    for (const { view } of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (view instanceof SlidesView && view.file === this.file && (!closing || view !== this)) return view;
    }
    return this;
  }

  setViewData(data: string, clear: boolean): void {
    if (!clear && this.file) {
      const writer = this.savingView();
      // A previous autosave can finish after a newer edit or undo. Other views
      // follow the save owner's live buffer, rather than that obsolete disk echo.
      if (writer !== this && writer.getViewData().replace(/\r\n|\r/g, '\n') !== data.replace(/\r\n|\r/g, '\n')) return;
    }
    if (clear || data !== this.source) {
      this.history = new DeckHistory();
      this.source = data;
      this.deck = parseDeck(data);
      this.index = clear ? 0 : Math.min(this.index, this.deck.slides.length - 1);
      if (this.root) { this.loadEditor(); this.refresh(true); }
      // With no native editor, the first slide tab also distributes real disk
      // reloads to followers that may have received the file event before it.
      if (!clear && this.file && this.savingView() === this) this.plugin.syncDocument(this.file, data, this);
    }
  }
  clear(): void {
    this.source = '';
    this.index = 0;
    this.deck = parseDeck('');
    this.history = new DeckHistory();
    if (this.root) { this.loadEditor(); this.refresh(true); }
  }

  async onOpen(): Promise<void> {
    this.closed = false;
    this.contentEl.addClass('jss-view');
    this.contentEl.empty();
    this.root = this.contentEl.createDiv({ cls: 'jss-app' });
    const toolbar = this.root.createDiv({ cls: 'jss-toolbar' });
    const identity = toolbar.createDiv({ cls: 'jss-identity' });
    setIcon(identity.createSpan({ cls: 'jss-brand-icon' }), PLUGIN_ICON);
    this.filename = identity.createSpan({ cls: 'jss-filename' });
    this.counter = identity.createSpan({ cls: 'jss-counter' });
    const actions = toolbar.createDiv({ cls: 'jss-toolbar-actions' });
    this.sorterButton = this.button(actions, 'layout-grid', 'Toggle slide sorter', () => this.setSorter(!this.sorter), 'Slide sorter');
    this.sorterButton.setAttribute('aria-pressed', 'false');
    this.button(actions, 'file-text', 'Edit selected slide in Markdown', () => { void this.editSource(); }, 'Edit source');
    this.button(actions, 'heading', 'Normalize headings', () => {
      new HeadingModal(this.app, this.contentEl.ownerDocument, this.deck.presentation?.title ?? this.file?.basename ?? '', title => this.normalizeHeadings(title)).open();
    });
    this.button(actions, 'panel-bottom', 'Toggle slide editor', () => {
      this.root.toggleClass('jss-hide-source', !this.root.hasClass('jss-hide-source'));
      this.surface.scheduleFit();
      this.editor?.requestMeasure();
    }).addClass('jss-source-toggle');
    this.button(actions, PLUGIN_ICON, 'Present from this slide (F5)', () => { void this.present(); }, 'Present', 'mod-cta');
    const workspace = this.workspace = this.root.createDiv({ cls: 'jss-workspace' });
    const sidebar = this.sidebar = workspace.createDiv({ cls: 'jss-sidebar' });
    const railHeader = sidebar.createDiv({ cls: 'jss-rail-header' });
    railHeader.createSpan({ text: 'Slides' });
    railHeader.createSpan({ cls: 'jss-sorter-hint', text: 'Drag to reorder · Double-click to edit' });
    this.button(railHeader, 'plus', 'Add slide after selection', () => this.perform('add'));
    this.rail = sidebar.createDiv({ cls: 'jss-rail', attr: { role: 'listbox', 'aria-label': 'Slides', tabindex: '0' } });
    this.registerDomEvent(this.rail, 'dragover', event => {
      if (this.draggedIndex === null || this.dragSource !== this.source) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      this.dragY = event.clientY;
      this.dragX = event.clientX;
      this.showDropPosition(event.clientX, event.clientY);
      this.scrollDuringDrag();
    });
    this.registerDomEvent(this.rail, 'dragleave', event => {
      const related = event.relatedTarget as Node | null;
      if (related?.nodeType && this.rail.contains(related)) return;
      this.clearDropPosition();
      this.stopDragScroll();
    });
    this.registerDomEvent(this.rail, 'drop', event => {
      if (this.draggedIndex === null) return;
      event.preventDefault();
      event.stopPropagation();
      const from = this.draggedIndex;
      const valid = this.dragSource === this.source;
      this.showDropPosition(event.clientX, event.clientY);
      const boundary = this.dropBoundary;
      this.clearDrag();
      if (!valid || boundary === null) return;
      this.reorderSlide(from, boundary > from ? boundary - 1 : boundary);
    });
    for (const eventName of ['dragover', 'drop'] as const) {
      this.registerDomEvent(this.root, eventName, event => {
        if (this.draggedIndex === null || this.rail.contains(event.target as Node)) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
        this.clearDropPosition();
        this.stopDragScroll();
        if (eventName === 'drop') this.clearDrag();
      }, { capture: true });
    }
    this.registerDomEvent(this.rail, 'keydown', event => {
      if (this.sorter && (event.key === 'Enter' || event.key === 'Escape')) {
        event.preventDefault();
        event.stopPropagation();
        this.setSorter(false);
        return;
      }
      const next = ['ArrowDown', 'ArrowRight'].includes(event.key);
      const previous = ['ArrowUp', 'ArrowLeft'].includes(event.key);
      if (next || previous || event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        event.stopPropagation();
        const columns = this.sorter && ['ArrowDown', 'ArrowUp'].includes(event.key)
          ? thumbnailColumns(this.thumbnails.map(thumb => thumb.button.getBoundingClientRect())) : 1;
        const target = event.key === 'Home' ? 0 : event.key === 'End' ? this.deck.slides.length - 1 : this.index + (next ? columns : -columns);
        if (event.ctrlKey || event.metaKey) this.reorderSlide(this.index, Math.max(0, Math.min(target, this.deck.slides.length - 1)));
        else this.select(target);
        this.thumbnails[this.index]?.button.focus();
      }
    });
    const railFooter = sidebar.createDiv({ cls: 'jss-rail-footer' });
    this.button(railFooter, 'copy', 'Duplicate slide', () => this.perform('duplicate'));
    this.button(railFooter, 'arrow-up', 'Move slide up', () => this.perform('up'));
    this.button(railFooter, 'arrow-down', 'Move slide down', () => this.perform('down'));
    this.button(railFooter, 'trash-2', 'Delete slide (undo with Ctrl/Cmd+Z)', () => this.perform('delete'));
    const zoom = railFooter.createEl('label', { cls: 'jss-sorter-zoom' });
    zoom.createSpan({ text: 'Slide size' });
    const slider = zoom.createEl('input', { attr: { type: 'range', min: '140', max: '360', step: '20', 'aria-label': 'Slide size' } });
    slider.value = String(this.plugin.layout.sorterSize);
    this.root.style.setProperty('--jss-sorter-size', `${this.plugin.layout.sorterSize}px`);
    this.registerDomEvent(slider, 'input', () => {
      this.clearDrag();
      this.root.style.setProperty('--jss-sorter-size', `${slider.value}px`);
    });
    this.registerDomEvent(slider, 'change', () => {
      this.plugin.updateLayout({ sorterSize: Number(slider.value) });
      this.thumbnails[this.index]?.button.scrollIntoView({ block: 'nearest' });
    });
    this.verticalDivider = this.createDivider(workspace, 'vertical');
    const main = this.main = workspace.createDiv({ cls: 'jss-main' });
    const stageHeader = main.createDiv({ cls: 'jss-stage-header' });
    stageHeader.createSpan({ text: 'Slide preview' });
    this.density = stageHeader.createSpan({ cls: 'jss-density', attr: { role: 'status' } });
    this.stage = main.createDiv({ cls: 'jss-stage' });
    this.surface = this.addChild(new SlideSurface(this.app, this.stage, 'Current slide preview'));
    this.horizontalDivider = this.createDivider(main, 'horizontal');
    const source = this.sourcePanel = main.createDiv({ cls: 'jss-source' });
    const sourceHeader = source.createDiv({ cls: 'jss-source-header' });
    this.sourceLabel = sourceHeader.createSpan();
    const tabs = this.editorTabs = sourceHeader.createDiv({ cls: 'jss-editor-tabs', attr: { role: 'tablist', 'aria-label': 'Slide editor areas' } });
    this.registerDomEvent(tabs, 'keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const count = this.modeTabs.length;
      if (!count) return;
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1
        : (this.areaIndex + (event.key === 'ArrowRight' ? 1 : -1) + count) % count;
      this.selectArea(next);
      this.modeTabs[next]?.focus();
    });
    this.sourceHost = source.createDiv({ cls: 'jss-editor' });
    this.emptyAreas = source.createDiv({ cls: 'jss-empty-areas' });
    this.emptyAreas.createSpan({ text: 'No slide areas' });
    this.emptyAreas.createSpan({ text: 'Keep presenter notes here, outside the slide.' });
    this.button(this.emptyAreas, 'plus', 'Create slide notes', () => this.createSlideNotes(), 'Create slide notes');
    this.registerDomEvent(this.sourceHost, 'focusin', () => this.history.breakGroup());
    this.editor = new EditorView({ parent: this.sourceHost, state: this.makeEditorState('') });
    this.panelObserver = new ResizeObserver(() => this.applyPanelSizes());
    this.panelObserver.observe(workspace);
    this.panelObserver.observe(main);
    this.registerEvent(this.app.workspace.on('layout-change', () => this.onResize()));
    this.registerEvent(this.app.workspace.on('css-change', () => {
      this.surface.scheduleFit();
      for (const thumb of this.thumbnails) thumb.surface?.scheduleFit();
      this.player?.refit();
      this.editor?.requestMeasure();
    }));
    this.registerDomEvent(this.root, 'keydown', event => {
      if (event.key === 'Escape' && this.sorter && this.draggedIndex === null) {
        event.preventDefault();
        event.stopPropagation();
        this.setSorter(false);
        return;
      }
      if (event.key === 'F5') {
        event.preventDefault();
        event.stopPropagation();
        void this.present();
        return;
      }
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && (key === 'z' || key === 'y')) {
        event.preventDefault();
        event.stopPropagation();
        this.undo(key === 'y' || event.shiftKey);
      }
    }, { capture: true });
    this.addAction(PLUGIN_ICON, 'Start presentation', () => { void this.present(); });
    this.loadEditor();
    this.applyPanelSizes();
    this.refresh(true);
  }

  onResize(): void {
    if (!this.root || this.closed) return;
    this.attachEditorDocument();
    this.applyPanelSizes();
  }

  private attachEditorDocument(): void {
    const editor = this.editor;
    const document = this.contentEl.ownerDocument;
    if (!editor || editor.root === document) return;
    // Obsidian adopts this view's DOM when moving it between windows. CodeMirror
    // must move its selection observers and editor styles to the new document too.
    editor.setRoot(document);
    editor.requestMeasure();
  }

  private setSorter(enabled: boolean): void {
    if (this.sorter === enabled) return;
    this.clearDrag();
    this.history.breakGroup();
    this.sorter = enabled;
    this.root.toggleClass('jss-sorter', enabled);
    this.sorterButton.setAttribute('aria-pressed', String(enabled));
    this.sorterButton.lastElementChild?.setText(enabled ? 'Slide editor' : 'Slide sorter');
    setIcon(this.sorterButton.firstElementChild as HTMLElement, enabled ? 'panels-top-left' : 'layout-grid');
    this.rail.setAttribute('aria-label', enabled ? 'Slide sorter' : 'Slides');
    this.main.hidden = enabled;
    this.verticalDivider.hidden = enabled;
    if (enabled) this.focusThumbnail();
    else {
      this.applyPanelSizes();
      this.surface.scheduleFit();
      this.thumbnails[this.index]?.button.scrollIntoView({ block: 'nearest' });
      this.focusEditor();
    }
  }

  private focusThumbnail(): void {
    const button = this.thumbnails[this.index]?.button;
    button?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    button?.focus({ preventScroll: true });
  }

  private button(host: HTMLElement, icon: string, label: string, action: () => void, text?: string, cls = ''): HTMLButtonElement {
    const button = host.createEl('button', { cls: `jss-button ${text ? 'jss-text-button' : 'jss-icon-button'} ${cls}`, attr: { 'aria-label': label, title: label, type: 'button' } });
    setIcon(button.createSpan(), icon);
    if (text) button.createSpan({ text });
    button.addEventListener('click', action);
    return button;
  }

  private createDivider(host: HTMLElement, orientation: 'vertical' | 'horizontal'): HTMLElement {
    const vertical = orientation === 'vertical';
    const divider = host.createDiv({ cls: `jss-divider jss-divider-${orientation}`, attr: {
      role: 'separator', tabindex: '0', 'aria-orientation': orientation,
      'aria-label': vertical ? 'Resize slide thumbnails' : 'Resize slide editor',
      title: 'Drag to resize. Double-click to reset.',
    } });
    let drag: { id: number; from: number; size: number; sidebar: number; ratio: number } | null = null;
    const save = () => this.plugin.updateLayout(vertical ? { sidebarWidth: this.sidebarWidth } : { sourceRatio: this.sourceRatio });
    const setSize = (size: number) => {
      if (vertical) this.sidebarWidth = clampSize(size, sidebarBounds(this.workspace.clientWidth));
      else this.sourceRatio = clampSize(size, sourceBounds(this.main.clientHeight)) / Math.max(1, this.main.clientHeight);
      this.applyPanelSizes();
    };
    const finish = (commit: boolean) => {
      if (!drag) return;
      const previous = drag;
      drag = null;
      if (!commit) { this.sidebarWidth = previous.sidebar; this.sourceRatio = previous.ratio; this.applyPanelSizes(); }
      else save();
      this.root.removeClass('jss-resizing');
      if (divider.hasPointerCapture(previous.id)) divider.releasePointerCapture(previous.id);
    };
    this.registerDomEvent(divider, 'pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      divider.focus({ preventScroll: true });
      drag = { id: event.pointerId, from: vertical ? event.clientX : event.clientY,
        size: vertical ? this.sidebar.getBoundingClientRect().width : this.sourcePanel.getBoundingClientRect().height,
        sidebar: this.sidebarWidth, ratio: this.sourceRatio };
      divider.setPointerCapture(event.pointerId);
      this.root.addClass('jss-resizing');
    });
    this.registerDomEvent(divider, 'pointermove', event => {
      if (!drag || drag.id !== event.pointerId) return;
      event.preventDefault();
      const delta = (vertical ? event.clientX : event.clientY) - drag.from;
      setSize(drag.size + (vertical ? delta : -delta));
    });
    this.registerDomEvent(divider, 'pointerup', () => finish(true));
    this.registerDomEvent(divider, 'pointercancel', () => finish(false));
    this.registerDomEvent(divider, 'lostpointercapture', () => finish(true));
    this.registerDomEvent(divider, 'keydown', event => {
      if (event.key === 'Escape' && drag) { event.preventDefault(); finish(false); return; }
      const keys = vertical ? ['ArrowLeft', 'ArrowRight'] : ['ArrowDown', 'ArrowUp'];
      const bounds = vertical ? sidebarBounds(this.workspace.clientWidth) : sourceBounds(this.main.clientHeight);
      const size = vertical ? this.sidebar.getBoundingClientRect().width : this.sourcePanel.getBoundingClientRect().height;
      if (!keys.includes(event.key) && event.key !== 'Home' && event.key !== 'End') return;
      event.preventDefault();
      setSize(event.key === 'Home' ? bounds.min : event.key === 'End' ? bounds.max : size + (event.key === keys[0] ? -20 : 20));
      save();
    });
    this.registerDomEvent(divider, 'dblclick', () => {
      if (vertical) this.sidebarWidth = DEFAULT_LAYOUT.sidebarWidth;
      else this.sourceRatio = DEFAULT_LAYOUT.sourceRatio;
      this.applyPanelSizes();
      save();
    });
    return divider;
  }

  private applyPanelSizes(): void {
    if (!this.workspace || !this.main || !this.sourcePanel || this.sorter) return;
    const sidebar = sidebarBounds(this.workspace.clientWidth);
    const source = sourceBounds(this.main.clientHeight);
    const width = clampSize(this.sidebarWidth, sidebar);
    const height = clampSize(this.sourceRatio * this.main.clientHeight, source);
    this.root.style.setProperty('--jss-sidebar-size', `${width}px`);
    this.main.style.setProperty('--jss-source-size', `${height}px`);
    for (const [divider, bounds, value] of [[this.verticalDivider, sidebar, width], [this.horizontalDivider, source, height]] as const) {
      divider.setAttribute('aria-valuemin', String(Math.round(bounds.min)));
      divider.setAttribute('aria-valuemax', String(Math.round(bounds.max)));
      divider.setAttribute('aria-valuenow', String(Math.round(value)));
    }
    this.surface?.scheduleFit();
    this.editor?.requestMeasure();
  }

  private makeEditorState(markdown: string, anchor = 0, head = anchor): EditorState {
    const doc = Text.of(markdown.split(/\r\n|\n|\r/));
    const editable = !!this.deck.slides[this.index]?.areas[this.areaIndex];
    return EditorState.create({
      doc,
      selection: { anchor: Math.min(anchor, doc.length), head: Math.min(head, doc.length) },
      extensions: [
        lineNumbers(), drawSelection(), EditorView.lineWrapping,
        EditorState.readOnly.of(!editable), EditorView.editable.of(editable),
        EditorState.lineSeparator.of(this.deck.eol), search({ top: true }),
        placeholder('Write anything here. This area stays private.'),
        EditorView.contentAttributes.of({ 'aria-label': 'Private slide area', spellcheck: 'true' }),
        keymap.of([
          { key: 'Mod-z', run: () => { this.undo(false); return true; } },
          { key: 'Mod-Shift-z', run: () => { this.undo(true); return true; } },
          { key: 'Mod-y', run: () => { this.undo(true); return true; } },
          ...searchKeymap, ...defaultKeymap, indentWithTab,
        ]),
        EditorView.updateListener.of(update => {
          const slide = this.deck.slides[this.index]!;
          if (!update.docChanged || this.closed || !slide.areas[this.areaIndex]) return;
          const selection = update.startState.selection.main;
          this.history.record({ source: this.source, index: this.index, anchor: selection.anchor, head: selection.head, areaIndex: this.areaIndex }, true);
          const markdown = updateSlideArea(slide.markdown, this.areaIndex, update.state.sliceDoc(), this.deck.eol);
          this.source = replaceSlide(this.source, slide, markdown);
          this.deck = parseDeck(this.source);
          this.commitChange();
          this.scheduleRefresh();
        }),
      ],
    });
  }

  private loadEditor(anchor = 0, head = anchor): void {
    this.attachEditorDocument();
    const slide = this.deck.slides[this.index];
    this.areaIndex = Math.max(0, Math.min(this.areaIndex, (slide?.areas.length ?? 0) - 1));
    this.updateEditorTabs();
    const content = slide?.areas[this.areaIndex]?.content ?? '';
    if (this.editor) this.editor.setState(this.makeEditorState(content, anchor, head));
  }

  private selectArea(areaIndex: number): void {
    if (!this.deck.slides[this.index]?.areas[areaIndex] || this.areaIndex === areaIndex) return;
    this.history.breakGroup();
    this.areaIndex = areaIndex;
    this.plugin.updateLayout({ areaIndex });
    this.loadEditor();
    this.editor?.requestMeasure();
    this.modeTabs[areaIndex]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  private updateEditorTabs(): void {
    if (!this.editorTabs) return;
    const names = this.deck.slides[this.index]?.areas.map((area, index) => area.name || `Area ${index + 1}`) ?? [];
    const signature = JSON.stringify(names);
    if (signature !== this.tabsSignature) {
      const focused = this.editorTabs.contains(this.contentEl.ownerDocument.activeElement);
      this.tabsSignature = signature;
      this.editorTabs.empty();
      this.modeTabs = names.map((name, index) => {
        const tab = this.editorTabs.createEl('button', { cls: 'jss-editor-tab', text: name, attr: { role: 'tab', type: 'button' } });
        tab.addEventListener('click', () => this.selectArea(index));
        return tab;
      });
      if (focused) this.modeTabs[this.areaIndex]?.focus({ preventScroll: true });
    }
    this.sourceHost.hidden = !names.length;
    this.emptyAreas.hidden = !!names.length;
    this.modeTabs.forEach((tab, index) => {
      tab.setAttribute('aria-selected', String(index === this.areaIndex));
      tab.tabIndex = index === this.areaIndex ? 0 : -1;
    });
  }

  private commitChange(): void {
    if (this.file) this.plugin.syncDocument(this.file, this.source, this);
    this.savingView().requestSave();
  }

  private snapshot(): Snapshot {
    const selection = this.editor?.state.selection.main;
    return { source: this.source, index: this.index, anchor: selection?.anchor ?? 0,
      head: selection?.head ?? 0, areaIndex: this.areaIndex };
  }

  private undo(redo: boolean): void {
    const next = redo ? this.history.redo(this.snapshot()) : this.history.undo(this.snapshot());
    if (!next) return;
    this.source = next.source;
    this.deck = parseDeck(this.source);
    this.index = Math.min(next.index, this.deck.slides.length - 1);
    this.areaIndex = next.areaIndex ?? this.areaIndex;
    this.loadEditor(next.anchor, next.head);
    this.commitChange();
    this.refresh(true);
    this.focusEditor();
  }

  private perform(action: 'add' | 'duplicate' | 'delete' | 'up' | 'down'): void {
    const next = action === 'add' || action === 'duplicate' ? addSlide(this.source, this.deck, this.index, action === 'duplicate')
      : action === 'delete' ? deleteSlide(this.source, this.deck, this.index)
        : moveSlide(this.source, this.deck, this.index, action === 'up' ? -1 : 1);
    if (next.source === this.source) return;
    this.history.record(this.snapshot());
    this.source = next.source;
    this.deck = parseDeck(this.source);
    this.index = next.index;
    this.loadEditor();
    this.commitChange();
    this.refresh(true);
    this.focusEditor();
  }

  private normalizeHeadings(title: string): void {
    if (this.closed || !this.file) return;
    const source = normalizeHeadings(this.source, title);
    if (source === this.source) { new Notice('Headings already normalized.'); return; }
    const selection = this.editor?.state.selection.main;
    this.history.record(this.snapshot());
    this.source = source;
    this.deck = parseDeck(source);
    this.loadEditor(selection?.anchor, selection?.head);
    this.commitChange();
    this.refresh(true);
    this.focusEditor();
    new Notice('Headings normalized. Undo with Ctrl/Cmd+Z.');
  }

  private createSlideNotes(): void {
    const slide = this.deck.slides[this.index];
    if (this.closed || !this.file || !slide || slide.areas.length) return;
    const markdown = appendSlideNotes(slide.markdown, this.deck.eol);
    if (!readSlideAreas(markdown).length) {
      new Notice('Close the unfinished Markdown block in the source before creating slide notes.');
      return;
    }
    this.history.record(this.snapshot());
    this.source = replaceSlide(this.source, slide, markdown);
    this.deck = parseDeck(this.source);
    this.areaIndex = 0;
    this.loadEditor();
    this.commitChange();
    this.refresh(true);
    this.focusEditor();
  }

  private reorderSlide(from: number, target: number): void {
    const next = moveSlideTo(this.source, this.deck, from, target);
    if (next.source === this.source) return;
    this.history.record(this.snapshot());
    this.source = next.source;
    this.deck = parseDeck(this.source);
    this.index = next.index;
    this.loadEditor();
    this.commitChange();
    this.refresh(true);
    this.focusThumbnail();
  }

  private showDropPosition(x: number, y: number): void {
    const boundary = thumbnailBoundary(this.thumbnails.map(thumb => thumb.button.getBoundingClientRect()), x, y, this.sorter);
    if (boundary === this.dropBoundary) return;
    this.clearDropPosition();
    this.dropBoundary = boundary;
    // Dropping immediately before/after the dragged slide leaves the order alone.
    if (boundary === this.draggedIndex || boundary === (this.draggedIndex ?? -2) + 1) return;
    const end = boundary === this.thumbnails.length;
    this.thumbnails[end ? boundary - 1 : boundary]?.button.addClass(end ? 'jss-drop-after' : 'jss-drop-before');
  }

  private clearDropPosition(): void {
    this.rail?.querySelectorAll('.jss-drop-before, .jss-drop-after').forEach(element => element.classList.remove('jss-drop-before', 'jss-drop-after'));
    this.dropBoundary = null;
  }

  private scrollDuringDrag(): void {
    if (this.dragFrame) return;
    const win = this.contentEl.ownerDocument.defaultView!;
    this.dragWindow = win;
    this.dragFrame = win.requestAnimationFrame(() => {
      this.dragFrame = 0;
      if (this.draggedIndex === null || this.dragY === null || this.dragX === null) return;
      const rect = this.rail.getBoundingClientRect();
      const edge = Math.min(48, rect.height / 4);
      const distance = this.dragY < rect.top + edge ? this.dragY - rect.top - edge
        : this.dragY > rect.bottom - edge ? this.dragY - rect.bottom + edge : 0;
      const before = this.rail.scrollTop;
      this.rail.scrollTop += Math.max(-14, Math.min(14, distance / 3));
      if (this.rail.scrollTop !== before) {
        this.showDropPosition(this.dragX, this.dragY);
        this.scrollDuringDrag();
      }
    });
  }

  private stopDragScroll(): void {
    this.dragWindow?.cancelAnimationFrame(this.dragFrame);
    this.dragFrame = 0;
    this.dragWindow = null;
    this.dragY = null;
    this.dragX = null;
  }

  private clearDrag(): void {
    this.stopDragScroll();
    this.clearDropPosition();
    if (this.draggedIndex !== null) this.thumbnails[this.draggedIndex]?.button.removeClass('jss-dragging');
    this.draggedIndex = null;
    this.dragSource = null;
  }

  select(index: number): void {
    const next = Math.max(0, Math.min(index, this.deck.slides.length - 1));
    if (next === this.index) return;
    this.history.breakGroup();
    this.index = next;
    this.loadEditor();
    this.refresh(false);
    this.thumbnails[this.index]?.button.scrollIntoView({ block: 'nearest' });
  }

  selectSourceOffset(offset: number): void { this.select(slideAt(this.deck, offset)); }

  private async editSource(): Promise<void> {
    const file = this.file;
    const slide = this.deck.slides[this.index];
    if (!file || !slide) return;
    const start = slide.start + Math.max(0, slide.markdown.search(/\S/));
    // Obsidian's native editor uses logical LF offsets even for CRLF files.
    const offset = this.source.slice(0, start).replace(/\r\n|\r/g, '\n').length;
    await this.save();
    let leaf = this.app.workspace.getLeavesOfType('markdown')
      .find(leaf => leaf.view instanceof MarkdownView && leaf.view.file === file || leaf.getViewState().state?.file === file.path);
    if (!leaf) {
      leaf = this.app.workspace.getLeaf('tab');
      await leaf.openFile(file, { state: { mode: 'source' }, active: true });
    }
    // Finish restoring an inactive tab before revealing it can start another load.
    await leaf.loadIfDeferred();
    await this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof MarkdownView && leaf.view.getMode() !== 'source') {
      const state = leaf.getViewState();
      await leaf.setViewState({ ...state, state: { ...state.state, mode: 'source' } });
    }
    if (!(leaf.view instanceof MarkdownView)) return;
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    leaf.view.contentEl.ownerDocument.defaultView?.focus();
    const editor = leaf.view.editor;
    const cursor = editor.offsetToPos(offset);
    editor.setCursor(cursor);
    editor.scrollIntoView({ from: cursor, to: cursor }, true);
    editor.focus();
  }

  focusEditor(): void {
    this.attachEditorDocument();
    if (this.sorter || !this.deck.slides[this.index]?.areas[this.areaIndex]) this.focusThumbnail();
    else this.editor?.focus();
  }

  private scheduleRefresh(): void {
    const win = this.contentEl.ownerDocument.defaultView!;
    win.clearTimeout(this.timer);
    this.timer = win.setTimeout(() => this.refresh(false), 180);
  }

  private refresh(rebuild: boolean): void {
    if (this.closed) return;
    const slide = this.deck.slides[this.index]!;
    this.filename.setText(this.file?.basename ?? 'Presentation');
    this.counter.setText(`${this.index + 1} / ${this.deck.slides.length}`);
    this.sourceLabel.setText(`Slide ${this.index + 1}`);
    this.updateEditorTabs();
    if (rebuild || this.thumbnails.length !== this.deck.slides.length) this.buildThumbnails();
    this.thumbnails.forEach((thumb, i) => {
      thumb.button.setAttribute('aria-selected', String(i === this.index));
      thumb.button.tabIndex = i === this.index ? 0 : -1;
      thumb.button.setAttribute('aria-label', `${i + 1}. ${this.deck.slides[i]!.title}`);
      thumb.caption.setText(this.deck.slides[i]!.title);
      if (thumb.visible) this.renderThumbnail(i);
    });
    if (this.currentPreview !== slide.markdown || rebuild) {
      this.currentPreview = slide.markdown;
      const id = ++this.renderId;
      void this.surface.render(slide.markdown, this.file?.path ?? '').then(() => {
        if (id !== this.renderId || this.closed) return;
        this.density.setText(this.stage.querySelector('.jss-slide')?.getAttribute('data-dense') === 'true' ? 'Dense slide · content scaled to fit' : '');
      }).catch(error => this.renderError(error));
    }
  }

  private buildThumbnails(): void {
    const focused = this.rail.contains(this.contentEl.ownerDocument.activeElement);
    this.clearDrag();
    this.thumbObserver?.disconnect();
    if (this.thumbOwner) this.removeChild(this.thumbOwner);
    this.thumbOwner = this.addChild(new Component());
    this.rail.empty();
    this.thumbnails = this.deck.slides.map((slide, i) => {
      const button = this.rail.createEl('button', { cls: 'jss-thumbnail', attr: { role: 'option', type: 'button', draggable: 'true', title: 'Drag to reorder', 'aria-selected': String(i === this.index) } });
      button.dataset.index = String(i);
      const frame = button.createDiv({ cls: 'jss-thumb-frame', attr: { 'aria-hidden': 'true' } });
      const captionRow = button.createDiv({ cls: 'jss-thumb-caption' });
      captionRow.createSpan({ cls: 'jss-thumb-number', text: String(i + 1).padStart(2, '0') });
      const caption = captionRow.createSpan({ text: slide.title });
      button.addEventListener('click', () => this.select(i));
      button.addEventListener('dblclick', () => { if (this.sorter) this.setSorter(false); });
      button.addEventListener('dragstart', event => {
        if (!event.dataTransfer || this.deck.slides.length < 2) { event.preventDefault(); return; }
        event.stopPropagation();
        this.clearDrag();
        this.history.breakGroup();
        this.draggedIndex = i;
        this.dragSource = this.source;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('application/x-just-simple-slides', String(i));
        button.addClass('jss-dragging');
      });
      button.addEventListener('dragend', () => this.clearDrag());
      // Surface construction is deferred until this thumbnail is near the visible rail.
      return { button, caption, frame, surface: null, visible: false };
    });
    this.thumbObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const i = Number((entry.target as HTMLElement).dataset.index);
        const thumb = this.thumbnails[i];
        if (!thumb) continue;
        thumb.visible = entry.isIntersecting;
        if (thumb.visible) this.renderThumbnail(i);
      }
    }, { root: this.rail, rootMargin: '180px' });
    for (const thumb of this.thumbnails) this.thumbObserver.observe(thumb.button);
    if (focused) this.focusThumbnail();
  }

  private renderThumbnail(i: number): void {
    const thumb = this.thumbnails[i]!;
    const markdown = this.deck.slides[i]!.markdown;
    if (thumb.markdown === markdown) return;
    thumb.markdown = markdown;
    thumb.surface ??= this.thumbOwner!.addChild(new SlideSurface(this.app, thumb.button.querySelector<HTMLElement>('.jss-thumb-frame')!, 'Slide thumbnail'));
    void thumb.surface.render(markdown, this.file?.path ?? '').catch(error => this.renderError(error));
  }

  private renderError(error: unknown): void {
    console.error('Just Simple Slides:', error);
    new Notice('Could not render this slide. Your Markdown is preserved.');
  }

  async present(): Promise<void> {
    if (this.player || !this.file) return;
    await this.save();
    this.player = this.addChild(new Presentation(this, this.deck, this.index, () => { this.player = null; }));
    await this.player.start();
  }

  async onClose(): Promise<void> {
    this.closed = true;
    this.clearDrag();
    this.contentEl.ownerDocument.defaultView!.clearTimeout(this.timer);
    this.thumbObserver?.disconnect();
    this.panelObserver?.disconnect();
    this.player?.stop();
    this.editor?.destroy();
    this.editor = null;
  }
}

class Presentation extends Component {
  private root!: HTMLElement;
  private surface!: SlideSurface;
  private counter!: HTMLElement;
  private previous!: HTMLButtonElement;
  private next!: HTMLButtonElement;
  private ownsFullscreen = false;
  private stopped = false;
  private previousFocus: HTMLElement | null = null;
  private scope: Scope;
  private scopePushed = false;
  private sequence = 0;
  private document: Document;

  constructor(private view: SlidesView, private deck: Deck, private index: number, private done: () => void) {
    super();
    this.document = view.contentEl.ownerDocument;
    this.scope = new Scope(view.app.scope);
    for (const key of ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter']) this.scope.register([], key, () => { this.go(1); return false; });
    for (const key of ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace']) this.scope.register([], key, () => { this.go(-1); return false; });
    this.scope.register([], 'Home', () => { this.show(0); return false; });
    this.scope.register([], 'End', () => { this.show(this.deck.slides.length - 1); return false; });
    this.scope.register([], 'Escape', () => { this.stop(); return false; });
  }

  async start(): Promise<void> {
    this.previousFocus = this.document.activeElement as HTMLElement;
    this.root = this.document.body.createDiv({ cls: 'jss-presentation', attr: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Slide presentation', tabindex: '-1' } });
    const stage = this.root.createDiv({ cls: 'jss-player-stage' });
    this.surface = this.addChild(new SlideSurface(this.view.app, stage, 'Presentation slide'));
    const controls = this.root.createDiv({ cls: 'jss-player-controls' });
    this.previous = this.control(controls, 'chevron-left', 'Previous slide', () => this.go(-1));
    this.counter = controls.createSpan({ cls: 'jss-player-counter', attr: { 'aria-live': 'polite' } });
    this.next = this.control(controls, 'chevron-right', 'Next slide', () => this.go(1));
    this.control(controls, 'minimize', 'Exit presentation (Esc)', () => this.stop());
    this.registerDomEvent(this.root, 'click', event => {
      if ((event.target as HTMLElement).closest('a, button, input, video, audio, iframe')) return;
      this.go(1);
    });
    this.registerDomEvent(this.root, 'wheel', event => event.preventDefault(), { passive: false });
    this.registerDomEvent(this.root, 'keydown', event => {
      // Keep focus inside the full-screen player, including its exit control.
      if (event.key !== 'Tab') return;
      const focusable = [...this.root.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]')];
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && (this.document.activeElement === first || this.document.activeElement === this.root)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && this.document.activeElement === last) { event.preventDefault(); first?.focus(); }
    });
    this.view.app.keymap.pushScope(this.scope);
    this.scopePushed = true;
    this.root.focus();
    this.show(this.index);
    // Works in desktop/mobile WebViews; the overlay remains usable if fullscreen is denied.
    if (!this.document.fullscreenElement && this.root.requestFullscreen) {
      try { await this.root.requestFullscreen(); this.ownsFullscreen = true; }
      catch { /* Some mobile WebViews do not expose browser fullscreen. */ }
    }
    if (this.stopped) {
      if (this.document.fullscreenElement === this.root) void this.document.exitFullscreen().catch(() => {});
      return;
    }
    this.registerDomEvent(this.document, 'fullscreenchange', () => {
      if (this.ownsFullscreen && !this.document.fullscreenElement) this.stop();
      else this.refit();
    });
  }

  private control(host: HTMLElement, icon: string, label: string, action: () => void): HTMLButtonElement {
    const button = host.createEl('button', { cls: 'jss-button jss-icon-button', attr: { 'aria-label': label, title: label } });
    setIcon(button, icon);
    button.addEventListener('click', action);
    return button;
  }
  private go(direction: number): void { this.show(this.index + direction); }
  private show(index: number): void {
    this.index = Math.max(0, Math.min(index, this.deck.slides.length - 1));
    const slide = this.deck.slides[this.index]!;
    const sequence = ++this.sequence;
    this.counter.setText(`${this.index + 1} / ${this.deck.slides.length}`);
    this.previous.disabled = this.index === 0;
    this.next.disabled = this.index === this.deck.slides.length - 1;
    void this.surface.render(slide.markdown, this.view.file?.path ?? '').then(() => {
      if (sequence === this.sequence) this.root.setAttribute('aria-label', `Slide ${this.index + 1}: ${slide.title}`);
    }).catch(error => { console.error('Just Simple Slides:', error); new Notice('Could not render this slide.'); });
  }
  refit(): void { this.surface?.scheduleFit(); }
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.view.select(this.index);
    this.view.removeChild(this);
    this.done();
  }
  onunload(): void {
    this.stopped = true;
    if (this.scopePushed) this.view.app.keymap.popScope(this.scope);
    if (this.ownsFullscreen && this.document.fullscreenElement === this.root) void this.document.exitFullscreen().catch(() => {});
    this.root?.remove();
    this.previousFocus?.focus();
  }
}
