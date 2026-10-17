import { MarkdownView, Notice, Plugin, TFile, type WorkspaceLeaf } from 'obsidian';
import { SlidesView, VIEW_TYPE } from './view';
import { slideCallout } from './details';
import { DEFAULT_LAYOUT, readLayout, type PanelLayout } from './layout';
import { PLUGIN_ICON } from './icon';

export default class JustSimpleSlides extends Plugin {
  layout: PanelLayout = { ...DEFAULT_LAYOUT };
  private layoutSave: Promise<void> = Promise.resolve();
  async onload(): Promise<void> {
    this.layout = readLayout(await this.loadData());
    this.registerView(VIEW_TYPE, leaf => new SlidesView(leaf, this));
    this.addRibbonIcon(PLUGIN_ICON, 'Just Simple Slides', () => { void this.open(); });
    this.addCommand({ id: 'edit-slides', name: 'Edit as slides', icon: PLUGIN_ICON, checkCallback: checking => this.command(checking, false) });
    this.addCommand({ id: 'present-slides', name: 'Start presentation', icon: PLUGIN_ICON, checkCallback: checking => this.command(checking, true) });
    this.addCommand({ id: 'create-slides', name: 'Create presentation', icon: PLUGIN_ICON, callback: () => { void this.create(); } });
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (file instanceof TFile && file.extension === 'md') {
        menu.addItem(item => item.setTitle('Edit as slides').setIcon(PLUGIN_ICON).onClick(() => { void this.open(file); }));
      }
    }));
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
    const current = this.app.workspace.getActiveViewOfType(MarkdownView);
    const offset = current?.file === file ? current.editor.posToOffset(current.editor.getCursor()) : null;
    // Flush the native editor before changing views. Markdown stays the source of truth.
    if (current?.file === file) await current.save();
    let leaf: WorkspaceLeaf | undefined = this.app.workspace.getLeavesOfType(VIEW_TYPE).find(l => (l.view as SlidesView).file === file);
    leaf ??= current?.file === file ? current.leaf : this.app.workspace.getLeaf('tab');
    await leaf.setViewState({ type: VIEW_TYPE, state: { file: file.path }, active: true });
    await this.app.workspace.revealLeaf(leaf);
    if (offset !== null && leaf.view instanceof SlidesView) leaf.view.selectSourceOffset(offset);
    if (present && leaf.view instanceof SlidesView) await leaf.view.present();
    else if (leaf.view instanceof SlidesView) leaf.view.focusEditor();
  }

  private async create(): Promise<void> {
    let name = 'Untitled presentation';
    for (let n = 2; this.app.vault.getAbstractFileByPath(`${name}.md`); n++) name = `Untitled presentation ${n}`;
    const file = await this.app.vault.create(`${name}.md`, slideCallout('Notes', 'Type: title\n\nPresenter notes go here.') + '\n\n# Your presentation\n\n## A little context\n\nStart with one clear idea.\n\n---\n\n' + slideCallout('Notes', 'Type: content\n\nPresenter notes go here.') + '\n\n# Your next idea\n\n- Write in ordinary Markdown.\n- Add an image with `![[image.png]]`.\n- Use three dashes to start a new slide.\n');
    await this.open(file);
  }
}
