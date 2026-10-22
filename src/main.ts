import { MarkdownView, Notice, Plugin, TFile } from 'obsidian';
import { SlidesView, VIEW_TYPE } from './view';
import { slideCallout } from './details';
import { DEFAULT_LAYOUT, readLayout, type PanelLayout } from './layout';
import { PLUGIN_ICON } from './icon';

export default class JustSimpleSlides extends Plugin {
  layout: PanelLayout = { ...DEFAULT_LAYOUT };
  private layoutSave: Promise<void> = Promise.resolve();
  private syncing = false;
  private opening = new Map<TFile, Promise<void>>();
  async onload(): Promise<void> {
    this.layout = readLayout(await this.loadData());
    this.registerView(VIEW_TYPE, leaf => new SlidesView(leaf, this));
    this.addRibbonIcon(PLUGIN_ICON, 'Just Simple Slides', () => { void this.open(); });
    this.addCommand({ id: 'edit-slides', name: 'Edit as slides', icon: PLUGIN_ICON, checkCallback: checking => this.command(checking, false) });
    this.addCommand({ id: 'present-slides', name: 'Start presentation', icon: PLUGIN_ICON, checkCallback: checking => this.command(checking, true) });
    this.addCommand({ id: 'create-slides', name: 'Create presentation', icon: PLUGIN_ICON, callback: () => { void this.create(); } });
    this.registerEvent(this.app.workspace.on('editor-change', (_editor, info) => {
      // Core clears data before clearing an editor on unload. That empty editor
      // is a lifecycle event, not an edit to the document.
      if (!this.syncing && info instanceof MarkdownView && info.file && typeof info.data === 'string') {
        this.syncDocument(info.file, info.getViewData());
      }
    }));
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (file instanceof TFile && file.extension === 'md') {
        menu.addItem(item => item.setTitle('Edit as slides').setIcon(PLUGIN_ICON).onClick(() => { void this.open(file); }));
      }
    }));
  }

  /** Keep the native Markdown document and every slide tab on the same content. */
  syncDocument(file: TFile, source: string, origin?: SlidesView): void {
    if (this.syncing) return;
    this.syncing = true;
    const normalized = source.replace(/\r\n|\r/g, '\n');
    try {
      for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
        const view = leaf.view;
        if (!(view instanceof MarkdownView) || view.file !== file || typeof view.data !== 'string') continue;
        const before = view.editor.getValue().replace(/\r\n|\r/g, '\n');
        if (before === normalized) continue;
        // A minimal replacement preserves the native editor's selection and undo history.
        let from = 0;
        while (from < before.length && from < normalized.length && before[from] === normalized[from]) from++;
        let oldEnd = before.length, newEnd = normalized.length;
        while (oldEnd > from && newEnd > from && before[oldEnd - 1] === normalized[newEnd - 1]) { oldEnd--; newEnd--; }
        view.editor.replaceRange(normalized.slice(from, newEnd), view.editor.offsetToPos(from), view.editor.offsetToPos(oldEnd));
      }
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
        const view = leaf.view;
        if (!(view instanceof SlidesView) || view === origin || !view.isFileLoaded(file)) continue;
        const before = view.getViewData();
        if (before.replace(/\r\n|\r/g, '\n') === normalized) continue;
        const eol = before.match(/\r\n|\n|\r/)?.[0] ?? '\n';
        view.setViewData(normalized.replace(/\n/g, eol), false);
      }
    } finally { this.syncing = false; }
  }

  updateLayout(patch: Partial<PanelLayout>): void {
    this.layout = readLayout({ ...this.layout, ...patch });
    const saved = { ...this.layout };
    this.layoutSave = this.layoutSave.catch(() => {}).then(() => this.saveData(saved));
    void this.layoutSave.catch(error => console.error('Just Simple Slides: could not save panel layout', error));
  }

  private command(checking: boolean, present: boolean): boolean {
    const view = this.app.workspace.getActiveViewOfType(SlidesView);
    const file = view?.file ?? this.app.workspace.getActiveFile();
    if (!file || file.extension !== 'md') return false;
    if (!checking) void this.open(file, present);
    return true;
  }

  async open(file = this.app.workspace.getActiveFile(), present = false): Promise<void> {
    if (!file || file.extension !== 'md') { new Notice('Open a Markdown note to edit it as slides.'); return; }
    // Serialize invocations for this file, including while a restored tab loads.
    const previous = this.opening.get(file) ?? Promise.resolve();
    const opening = previous.catch(() => {}).then(() => this.openSlides(file, present));
    this.opening.set(file, opening);
    try { await opening; }
    finally { if (this.opening.get(file) === opening) this.opening.delete(file); }
  }

  private async openSlides(file: TFile, present: boolean): Promise<void> {
    const active = this.app.workspace.getActiveViewOfType(SlidesView);
    let current = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (active?.file !== file && current?.file !== file) {
      const existing = this.app.workspace.getLeavesOfType('markdown')
        .find(leaf => leaf.view instanceof MarkdownView && leaf.view.file === file || leaf.getViewState().state?.file === file.path);
      if (existing) {
        await existing.loadIfDeferred();
        current = existing.view instanceof MarkdownView ? existing.view : null;
      }
      else {
        const native = this.app.workspace.getLeaf('tab');
        await native.openFile(file);
        current = native.view instanceof MarkdownView ? native.view : null;
      }
    }
    const offset = current?.file === file ? current.editor.posToOffset(current.editor.getCursor()) : null;
    // Keep the native tab, its selection and its undo history in place.
    if (current?.file === file) await current.save();
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)
      .find(leaf => leaf.view instanceof SlidesView && leaf.view.file === file || leaf.getViewState().state?.file === file.path);
    const leaf = existing ?? this.app.workspace.getLeaf('tab');
    if (existing) await leaf.loadIfDeferred();
    else await leaf.setViewState({ type: VIEW_TYPE, state: { file: file.path }, active: true });
    await this.app.workspace.revealLeaf(leaf);
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    if (offset !== null && leaf.view instanceof SlidesView) leaf.view.selectSourceOffset(offset);
    if (present && leaf.view instanceof SlidesView) await leaf.view.present();
    else if (leaf.view instanceof SlidesView) leaf.view.focusPreview();
  }

  private async create(): Promise<void> {
    let name = 'Untitled presentation';
    for (let n = 2; this.app.vault.getAbstractFileByPath(`${name}.md`); n++) name = `Untitled presentation ${n}`;
    const file = await this.app.vault.create(`${name}.md`, slideCallout('Notes', 'Type: title\n\nPresenter notes go here.') + '\n\n# Your presentation\n\n## A little context\n\nStart with one clear idea.\n\n---\n\n' + slideCallout('Notes', 'Type: content\n\nPresenter notes go here.') + '\n\n# Your next idea\n\n- Write in ordinary Markdown.\n- Add an image with `![[image.png]]`.\n- Use three dashes to start a new slide.\n');
    await this.open(file);
  }
}
