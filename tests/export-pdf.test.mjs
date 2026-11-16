import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

class Component {
  load() { this.children = []; }
  addChild(child) { this.children.push(child); return child; }
  unload() { for (const child of this.children ?? []) child.unload(); }
}
class Scope { register() {} }
class FileSystemAdapter {
  getFullPath(path) { return path; }
}
class TextFileView {
  constructor(leaf) { this.app = leaf.app; }
  async save() { throw new Error('Export must not save the note'); }
}
const platform = { isDesktopApp: true };
const notices = [];
class Notice {
  constructor(message) { notices.push(message); }
  hide() {}
}
class SlideSurface {
  constructor(app) { this.app = app; }
  async render(markdown, path) { this.app.rendered.push({ markdown, path }); }
  fit() {}
  unload() { this.app.unloaded++; }
}
const obsidian = { Component, FileSystemAdapter, Modal: class {}, Platform: platform, Scope, Notice, TextFileView };
const require = createRequire(import.meta.url);
const { outputFiles } = buildSync({
  stdin: {
    contents: "export * from './src/export-pdf'; export { SlidesView } from './src/view';",
    resolveDir: fileURLToPath(new URL('../', import.meta.url)),
  },
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  external: ['obsidian', './surface', '@codemirror/state', '@codemirror/view', '@codemirror/commands', '@codemirror/search'],
});
const mod = { exports: {} };
vm.runInNewContext(outputFiles[0].text, {
  module: mod, exports: mod.exports, console, AbortController,
  require: id => id === 'obsidian' ? obsidian : id === './surface' ? { SlideSurface } : require(id),
});
const { saveUniquePdf, waitForDeckMedia, SlidesView } = mod.exports;
const bytes = new Uint8Array([37, 80, 68, 70]);
const existing = new Uint8Array([1, 2, 3]);
const signal = () => new AbortController().signal;
const newFile = (path = 'Folder/MyDeck.md') => ({ path, basename: 'MyDeck' });

function fileSystem(entries = [], options = {}) {
  const vault = new Map(entries);
  let inode = 0;
  const identities = new Map();
  const files = {
    async open(path, flag) {
      assert.equal(flag, 'wx');
      if (vault.has(path)) throw Object.assign(new Error('Exists'), { code: 'EEXIST' });
      const id = { dev: 1, ino: ++inode };
      identities.set(path, id);
      vault.set(path, null);
      return {
        async writeFile(data) {
          await options.write?.(path, vault, identities);
          vault.set(path, data);
        },
        async stat() { return id; },
        async close() {},
      };
    },
    async stat(path) { return identities.get(path); },
    async unlink(path) { vault.delete(path); },
  };
  return { vault, files };
}

function context({ print, entries, invalidMedia = false } = {}) {
  notices.length = 0;
  const { vault, files } = fileSystem(entries);
  const doc = {
    fonts: { status: 'loaded' },
    documentElement: { classList: new Set() },
    body: {},
  };
  doc.documentElement.classList.remove = doc.documentElement.classList.delete;
  const printDecks = new Set();
  doc.body.createDiv = () => {
    const deck = {
      ownerDocument: doc,
      createDiv: () => ({}),
      querySelector: selector => invalidMedia && selector.includes('.mod-empty-attachment') ? {} : null,
      querySelectorAll: () => [],
      remove: () => printDecks.delete(deck),
    };
    printDecks.add(deck);
    return deck;
  };
  let prints = 0;
  const printer = {
    async printToPDF(options) {
      assert.equal(options.printBackground, true);
      assert.equal(options.preferCSSPageSize, true);
      assert.ok(doc.documentElement.classList.has('jss-printing-pdf'));
      assert.equal(printDecks.size, 1);
      prints++;
      return print ? print(vault) : bytes;
    },
  };
  doc.defaultView = {
    setTimeout: callback => queueMicrotask(callback),
    require: id => id === 'electron' ? { remote: { getCurrentWebContents: () => printer } } : { promises: files },
  };
  const app = { vault: { adapter: new FileSystemAdapter() }, rendered: [], unloaded: 0 };
  const addView = () => {
    const view = new SlidesView({ app }, { layout: { areaIndex: 0, sidebarWidth: 200, sourceRatio: 0.5 } });
    view.contentEl = { ownerDocument: doc };
    view.file = view.loadedFile = newFile();
    view.deck = { slides: [{ markdown: '# Slide 1' }, { markdown: '# Slide 2' }] };
    return view;
  };
  const clean = () => {
    assert.equal(printDecks.size, 0);
    assert.equal(doc.documentElement.classList.size, 0);
  };
  return { view: addView(), addView, app, vault, clean, prints: () => prints };
}

test('export keeps the selected slide snapshot and leaves the Markdown buffer unsaved', async () => {
  const { view, vault, app, clean } = context();
  const pending = view.exportPdf();
  view.file = view.loadedFile = newFile('Different.md');
  view.deck = { slides: [{ markdown: '# Changed' }] };
  await pending;
  assert.deepEqual(app.rendered, [
    { markdown: '# Slide 1', path: 'Folder/MyDeck.md' },
    { markdown: '# Slide 2', path: 'Folder/MyDeck.md' },
  ]);
  assert.equal(vault.get('Folder/MyDeck.pdf'), bytes);
  assert.equal(vault.has('Different.pdf'), false);
  assert.equal(app.unloaded, 2);
  clean();
});

test('an existing PDF and repeated exports produce numbered copies', async () => {
  const { view, vault, clean } = context({ entries: [['Folder/MyDeck.pdf', existing], ['Folder/MyDeck 1.pdf', existing]] });
  await view.exportPdf();
  await view.exportPdf();
  assert.equal(vault.get('Folder/MyDeck.pdf'), existing);
  assert.equal(vault.get('Folder/MyDeck 1.pdf'), existing);
  assert.equal(vault.get('Folder/MyDeck 2.pdf'), bytes);
  assert.equal(vault.get('Folder/MyDeck 3.pdf'), bytes);
  clean();
});

test('a file that appears during printing is never overwritten', async () => {
  const { view, vault, clean } = context({ print: current => {
    current.set('Folder/MyDeck.pdf', existing);
    return bytes;
  } });
  await view.exportPdf();
  assert.equal(vault.get('Folder/MyDeck.pdf'), existing);
  assert.equal(vault.get('Folder/MyDeck 1.pdf'), bytes);
  clean();
});

test('a second view cannot export while the current document is printing', async () => {
  const { view, addView, vault, prints, clean } = context();
  const source = view.exportPdf();
  await addView().exportPdf();
  await source;
  assert.equal(prints(), 1);
  assert.equal(vault.size, 1);
  assert.ok(notices.some(message => message.includes('already running')));
  clean();
});

test('an Electron print failure removes temporary print state and permits retry', async () => {
  let attempts = 0;
  const { view, vault, clean } = context({ print: () => {
    if (++attempts === 1) throw new Error('Print failed');
    return bytes;
  } });
  await view.exportPdf();
  clean();
  assert.equal(vault.size, 0);
  await view.exportPdf();
  clean();
  assert.equal(vault.get('Folder/MyDeck.pdf'), bytes);
});

test('cancelling during Electron printing never writes an output', async () => {
  const { view, vault, clean } = context({ print: () => {
    view.pdfExport.abort();
    return bytes;
  } });
  await view.exportPdf();
  assert.equal(vault.size, 0);
  clean();
});

test('non-desktop Obsidian skips PDF printing and creates no temporary output', async () => {
  const { view, vault, prints, clean } = context();
  platform.isDesktopApp = false;
  try { await view.exportPdf(); } finally { platform.isDesktopApp = true; }
  assert.equal(prints(), 0);
  assert.equal(vault.size, 0);
  clean();
});

test('failed media prevents printing and cleans up the deck', async () => {
  const { view, prints, vault, clean } = context({ invalidMedia: true });
  await view.exportPdf();
  assert.equal(prints(), 0);
  assert.equal(vault.size, 0);
  assert.ok(notices.some(message => message.includes('could not be rendered')));
  clean();
});

test('a write failure removes only the file reserved by this export', async () => {
  const { vault, files } = fileSystem([], { write: () => { throw new Error('Disk full'); } });
  await assert.rejects(saveUniquePdf('MyDeck.md', bytes, name => name, files, signal()), /Disk full/);
  assert.equal(vault.size, 0);

  const replaced = fileSystem([], { write: (path, current, identities) => {
    current.set(path, existing);
    identities.set(path, { dev: 1, ino: 42 });
    throw new Error('Disk full');
  } });
  await assert.rejects(saveUniquePdf('MyDeck.md', bytes, name => name, replaced.files, signal()), /Disk full/);
  assert.equal(replaced.vault.get('MyDeck.pdf'), existing);
});

test('media waits for fonts, lazy images and diagrams before the final fit', async () => {
  const fonts = { status: 'loading' };
  const image = { loading: 'lazy', complete: false, naturalWidth: 0 };
  let diagramReady = false;
  const deck = {
    ownerDocument: { fonts },
    querySelector: () => null,
    querySelectorAll: selector => selector === 'img' ? [image] : selector === '.jss-diagram' ? [
      { querySelector: () => diagramReady ? {} : null },
    ] : [],
  };
  let fitted = 0;
  await waitForDeckMedia(deck, [{ fit: () => fitted++ }], { setTimeout: callback => {
    assert.equal(image.loading, 'eager');
    fonts.status = 'loaded';
    image.complete = true;
    image.naturalWidth = 100;
    diagramReady = true;
    callback();
  } }, signal());
  assert.equal(fitted, 1);
});

test('unfinished fonts and broken images fail cleanly rather than printing a partial slide', async () => {
  const deck = {
    ownerDocument: { fonts: { status: 'loading' } },
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  await assert.rejects(waitForDeckMedia(deck, [], {}, signal(), 0), /Timed out/);
  const broken = { complete: true, src: 'missing.png', naturalWidth: 0 };
  deck.querySelectorAll = selector => selector === 'img' ? [broken] : [];
  await assert.rejects(waitForDeckMedia(deck, [], {}, signal()), /An image could not be loaded/);
});
