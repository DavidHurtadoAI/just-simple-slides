import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// Exercise the actual view/plugin with a small model of Obsidian's public
// lifecycle. In particular, save(true) clears before its asynchronous write,
// and a debounced save can still run after clear(). Live QA covers core itself.
class Component {}
class Scope { register() {} }
class TFile {
  constructor(path, source = '') { this.path = path; this.basename = path.slice(0, -3); this.extension = 'md'; this.source = source; }
}
class TextFileView {
  constructor(leaf) { this.leaf = leaf; this.app = leaf.app; this.contentEl = { ownerDocument: {} }; this.file = null; this.lastSavedData = null; this.requestSave = () => { this.requested = true; }; }
  async onLoadFile(file) {
    const source = await this.app.vault.read(file);
    this.data = this.lastSavedData = source;
    this.setViewData(source, true);
  }
  async save(clear = false) {
    const file = this.file, source = this.getViewData();
    if (this.saving) return;
    if (!file || this.lastSavedData === null || source === this.lastSavedData) return;
    const previous = this.lastSavedData;
    this.data = this.lastSavedData = clear ? null : source;
    if (clear) this.clear();
    this.saving = true;
    try { await this.app.vault.modify(file, source); }
    catch (error) { this.lastSavedData = previous; throw error; }
    finally { this.saving = false; }
  }
}
class MarkdownView extends TextFileView {
  constructor(leaf) {
    super(leaf);
    this.value = '';
    this.editor = {
      getValue: () => this.value, getCursor: () => ({ line: 0, ch: 0 }), posToOffset: () => 0,
      offsetToPos: offset => offset,
      replaceRange: (text, from, to) => { this.value = this.value.slice(0, from) + text + this.value.slice(to); },
    };
  }
  getViewData() { return this.value; }
  setViewData(source) { this.value = source; }
  clear() { this.value = ''; }
}
class Plugin {
  constructor(app) { this.app = app; }
  async loadData() { return {}; }
  registerView(type, factory) { this.app.factories.set(type, factory); }
  registerEvent() {} addRibbonIcon() {} addCommand() {}
}
const require = createRequire(import.meta.url);
const obsidian = { Component, Scope, TFile, TextFileView, MarkdownView, Plugin, Modal: class {}, Setting: class {}, Notice: class {}, MarkdownRenderer: {}, setIcon() {} };
const { outputFiles } = buildSync({
  stdin: { contents: "export {default as SlidesPlugin} from './src/main'; export {SlidesView} from './src/view';", resolveDir: fileURLToPath(new URL('../', import.meta.url)) },
  bundle: true, write: false, format: 'cjs', platform: 'node',
  external: ['obsidian', '@codemirror/state', '@codemirror/view', '@codemirror/commands', '@codemirror/search'],
});
const mod = { exports: {} };
vm.runInNewContext(outputFiles[0].text, { module: mod, exports: mod.exports, require: name => name === 'obsidian' ? obsidian : require(name), console });
const { SlidesPlugin, SlidesView } = mod.exports;
const source = '# Keep my slides\n\n> [!slide] Notes\n> **Private notes**\n\n---\n\n# Second\n';

async function setup() {
  const leaves = [], writes = [], events = new Map();
  const app = { scope: {}, factories: new Map(), vault: {
    read: async file => file.source,
    modify: async (file, text) => { writes.push({ file, text }); file.source = text; },
  }, workspace: {
    on: (event, callback) => { events.set(event, callback); return {}; },
    getLeavesOfType: type => leaves.filter(leaf => leaf.type === type),
    getActiveViewOfType: Type => app.workspace.activeLeaf?.view instanceof Type ? app.workspace.activeLeaf.view : null,
    getActiveFile: () => app.workspace.activeLeaf?.view.file,
    setActiveLeaf: leaf => { app.workspace.activeLeaf = leaf; },
    revealLeaf: async () => {},
    getLeaf: () => {
      const leaf = { app, type: 'empty', view: {}, getViewState: () => ({ type: leaf.type, state: { file: leaf.view.file?.path } }), loadIfDeferred: async () => {} };
      leaf.openFile = async file => { leaf.type = 'markdown'; leaf.view = new MarkdownView(leaf); leaf.view.file = file; await leaf.view.onLoadFile(file); };
      leaf.setViewState = async state => {
        leaf.type = state.type; leaf.view = app.factories.get(state.type)(leaf); leaf.view.file = files.get(state.state.file);
        await leaf.view.onLoadFile(leaf.view.file);
      };
      leaves.push(leaf); return leaf;
    },
  } };
  const files = new Map();
  const plugin = new SlidesPlugin(app); await plugin.onload();
  const file = new TFile('Deck.md', source); files.set(file.path, file);
  const add = async (Type = SlidesView, target = file, loaded = true) => {
    const leaf = app.workspace.getLeaf(); leaf.type = Type === SlidesView ? 'just-simple-slides' : 'markdown';
    leaf.view = Type === SlidesView ? new SlidesView(leaf, plugin) : new MarkdownView(leaf); leaf.view.file = target;
    if (loaded) await leaf.view.onLoadFile(target);
    return leaf.view;
  };
  return { app, file, plugin, leaves, writes, events, add, files };
}

test('a cleared slide view cannot save an empty buffer after its native owner closes', async () => {
  const { add, file, leaves, writes } = await setup();
  const native = await add(MarkdownView), view = await add();
  await view.save(true);
  assert.equal(view.getViewData(), '');
  leaves.splice(leaves.indexOf(native.leaf), 1);
  await view.save(); // A pending autosave, while the old file reference still exists.
  await view.save(true);
  assert.equal(file.source, source);
  assert.equal(writes.length, 0);
});

test('a slide view cannot save or receive synchronization before its first file load finishes', async () => {
  const { app, add, file, plugin, writes } = await setup();
  const view = await add(SlidesView, file, false);
  let finish; app.vault.read = () => new Promise(resolve => { finish = resolve; });
  const loading = view.onLoadFile(file);
  await view.save();
  plugin.syncDocument(file, 'A different live buffer');
  assert.equal(view.getViewData(), '');
  assert.equal(writes.length, 0);
  finish(source); await loading;
  assert.equal(view.isFileLoaded(), true);
  assert.equal(view.getViewData(), source);
});

test('closing during an unfinished load does not make that view a save owner later', async () => {
  const { app, add, file, writes } = await setup();
  const view = await add(SlidesView, file, false);
  let finish; app.vault.read = () => new Promise(resolve => { finish = resolve; });
  const loading = view.onLoadFile(file);
  await view.save(true); finish(source); await loading;
  await view.save();
  assert.equal(view.isFileLoaded(), false);
  assert.equal(file.source, source);
  assert.equal(writes.length, 0);
});

test('closing views cannot be selected by a second closing tab while the surviving writer saves', async () => {
  const { app, add, file, leaves, writes } = await setup();
  const first = await add(), second = await add(), survivor = await add();
  const edited = source + '\nNewest private notes\n';
  for (const view of [first, second, survivor]) view.setViewData(edited, true);
  let finish, signal; const started = new Promise(resolve => { signal = resolve; });
  app.vault.modify = async (file, text) => { signal(); await new Promise(resolve => { finish = resolve; }); writes.push({ text }); file.source = text; };
  const closing = first.save(true);
  await started;
  assert.equal(first.isFileLoaded(), false);
  assert.equal(second.savingView(true), survivor);
  finish(); await closing;
  leaves.splice(leaves.indexOf(survivor.leaf), 1);
  await first.save();
  assert.equal(file.source, edited);
  assert.equal(writes.length, 1);
});

test('an unload save completing late does not clear another file loaded in the same view', async () => {
  const { add, file } = await setup();
  const native = await add(MarkdownView), view = await add();
  let finish; native.save = () => new Promise(resolve => { finish = resolve; });
  const closing = view.save(true);
  const next = new TFile('Next.md', '# Next file\n');
  view.file = next; await view.onLoadFile(next);
  finish(); await closing;
  assert.equal(view.getViewData(), next.source);
  assert.equal(view.isFileLoaded(next), true);
  assert.equal(file.source, source);
});

test('a failed delegated close keeps the loaded buffer available for retry', async () => {
  const { add } = await setup();
  const native = await add(MarkdownView), view = await add();
  native.save = async () => { throw Error('Write failed'); };
  await assert.rejects(view.save(true), /Write failed/);
  assert.equal(view.isFileLoaded(), true);
  assert.equal(view.getViewData(), source);
});

test('native unload events with cleared data cannot erase a loaded slide document', async () => {
  const { add, file, events } = await setup();
  const native = await add(MarkdownView), view = await add();
  native.data = null; native.clear();
  events.get('editor-change')(native.editor, native);
  assert.equal(view.getViewData(), source);
  assert.equal(view.savingView(), view);
  assert.equal(file.source, source);
});

test('intentional empty source edits still synchronize and save', async () => {
  const { add, file, events } = await setup();
  const native = await add(MarkdownView), view = await add();
  native.value = '';
  events.get('editor-change')(native.editor, native);
  await view.save();
  assert.equal(view.getViewData(), '');
  assert.equal(file.source, '');
});

test('a loaded slide-only view saves its latest edit and can load a new file after clearing', async () => {
  const { add, file } = await setup();
  const view = await add();
  const edited = source + '\nEdited content\n';
  view.setViewData(edited, true); await view.save(true);
  assert.equal(file.source, edited);
  await view.save(); assert.equal(file.source, edited);
  const next = new TFile('Next.md', '# Next\n'); view.file = next; await view.onLoadFile(next);
  view.setViewData('# Next edited\n', true); await view.save();
  assert.equal(next.source, '# Next edited\n');
});

test('closing the final slide view waits for an in-flight save and flushes newer edits', async () => {
  const { app, add, file, writes } = await setup();
  const view = await add();
  const first = source + '\nFirst edit\n', latest = source + '\nLatest edit\n';
  let finish, signal; const started = new Promise(resolve => { signal = resolve; });
  app.vault.modify = async (file, text) => {
    if (!writes.length) { signal(); await new Promise(resolve => { finish = resolve; }); }
    writes.push({ text }); file.source = text;
  };
  view.setViewData(first, true);
  const pending = view.save(); await started;
  view.setViewData(latest, true);
  const closing = view.save(true);
  assert.equal(view.isFileLoaded(), false);
  finish(); await Promise.all([pending, closing]);
  assert.equal(file.source, latest);
  assert.equal(view.getViewData(), '');
  assert.equal(writes.length, 2);
  await view.save(); assert.equal(file.source, latest);
});

test('a failed final save keeps the source available rather than clearing it before the write', async () => {
  const { app, add } = await setup();
  const view = await add();
  view.setViewData(source + '\nUnsaved changes\n', true);
  app.vault.modify = async () => { throw Error('Disk write failed'); };
  await assert.rejects(view.save(true), /Disk write failed/);
  assert.equal(view.getViewData(), source + '\nUnsaved changes\n');
  assert.equal(view.isFileLoaded(), true);
  app.vault.modify = async (file, text) => { file.source = text; };
  await view.save(); assert.equal(view.file.source, source + '\nUnsaved changes\n');
});

test('invoking from Markdown reuses and activates an existing slide tab without resetting it', async () => {
  const { app, add, file, plugin, leaves } = await setup();
  const native = await add(MarkdownView), view = await add();
  view.history.record({ source: 'Earlier draft', index: 0, anchor: 0, head: 0 });
  app.workspace.activeLeaf = native.leaf;
  await plugin.open(file);
  assert.equal(leaves.filter(leaf => leaf.type === 'just-simple-slides').length, 1);
  assert.equal(app.workspace.activeLeaf, view.leaf);
  assert.equal(view.history.undo({ source }).source, 'Earlier draft');
});

test('concurrent invocations from the source create only one slide tab', async () => {
  const { app, add, file, plugin, leaves } = await setup();
  const native = await add(MarkdownView); app.workspace.activeLeaf = native.leaf;
  await Promise.all(Array.from({ length: 8 }, () => plugin.open(file)));
  assert.equal(leaves.filter(leaf => leaf.type === 'just-simple-slides').length, 1);
  assert.equal(file.source, source);
});

test('a restored deferred slide tab is loaded and reused', async () => {
  const { app, add, file, plugin, leaves } = await setup();
  const native = await add(MarkdownView); app.workspace.activeLeaf = native.leaf;
  const deferred = app.workspace.getLeaf(); deferred.type = 'just-simple-slides';
  deferred.getViewState = () => ({ type: deferred.type, state: { file: file.path } });
  let loads = 0;
  deferred.loadIfDeferred = async () => { loads++; deferred.view = new SlidesView(deferred, plugin); deferred.view.file = file; await deferred.view.onLoadFile(file); };
  await plugin.open(file);
  assert.equal(loads, 1);
  assert.equal(app.workspace.activeLeaf, deferred);
  assert.equal(leaves.filter(leaf => leaf.type === 'just-simple-slides').length, 1);
});
