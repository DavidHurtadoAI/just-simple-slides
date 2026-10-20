import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// Setup Obsidian mock environment
class Component {
  addChild(child) { return child; }
  removeChild() {}
  unload() { this.unloaded = true; }
  register() {}
}
class Scope { register() {} }
class TFile {
  constructor(path, source = '') {
    this.path = path;
    this.basename = path.replace(/\.[^/.]+$/, '');
    this.extension = 'md';
    this.source = source;
  }
}
class FileSystemAdapter {}
class TextFileView {
  constructor(leaf) {
    this.leaf = leaf;
    this.app = leaf.app;
    this.file = null;
    this.lastSavedData = null;
    this.saving = false;
    this.closed = false;
    this.exporting = false;
    this.player = null;
    this.deck = { slides: [] };
  }
  async save() {}
}
class MarkdownView extends TextFileView {}
class Plugin {
  constructor(app) { this.app = app; }
  async loadData() { return {}; }
  registerView() {}
  registerEvent() {}
  addRibbonIcon() {}
  addCommand() {}
}

const require = createRequire(import.meta.url);
let lastNotice = '';
class Notice {
  constructor(message) {
    this.message = message;
    lastNotice = message;
  }
  hide() {}
}

let modalInstance = null;
class Modal {
  constructor(app) {
    this.app = app;
    this.containerEl = { ownerDocument: {} };
    this.contentEl = { createEl: () => ({}), empty: () => {} };
    modalInstance = this;
  }
  open() { this.onOpen?.(); }
  close() { this.onClose?.(); }
  setTitle() {}
}
class Setting {
  constructor(el) { this.el = el; }
  setName() { return this; }
  addText() { return this; }
  addButton(cb) {
    const btn = {
      setButtonText: () => btn,
      setCta: () => btn,
      setDestructive: () => btn,
      onClick: fn => { btn.click = fn; return btn; },
      buttonEl: { addClass: () => {} },
    };
    cb(btn);
    this.buttons = this.buttons || [];
    this.buttons.push(btn);
    return this;
  }
}

class SlideSurface extends Component {
  constructor(app, host, label) {
    super();
    this.app = app;
    this.host = host;
    this.label = label;
  }
  async render() {}
  fit() {}
}

const obsidian = {
  Component,
  Scope,
  TFile,
  FileSystemAdapter,
  TextFileView,
  MarkdownView,
  Plugin,
  Modal,
  Setting,
  Notice,
  MarkdownRenderer: { render: async () => {} },
  setIcon() {},
};

const { outputFiles } = buildSync({
  stdin: {
    contents: "export * from './src/export-pdf'; export { SlidesView } from './src/view'; export { default as SlidesPlugin } from './src/main';",
    resolveDir: fileURLToPath(new URL('../', import.meta.url)),
  },
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  external: [
    'obsidian',
    './surface',
    '@codemirror/state',
    '@codemirror/view',
    '@codemirror/commands',
    '@codemirror/search',
  ],
});

const mod = { exports: {} };
vm.runInNewContext(outputFiles[0].text, {
  module: mod,
  exports: mod.exports,
  require: name => {
    if (name === 'obsidian') return obsidian;
    if (name === './surface') return { SlideSurface };
    return require(name);
  },
  console,
  setTimeout,
  clearTimeout,
});
const { defaultPdfPath, copyPdfPath, nextAvailablePdfPath, waitForDeckMedia, SlidesView, SlidesPlugin } = mod.exports;

test('defaultPdfPath generates a PDF path beside the markdown file', () => {
  assert.equal(defaultPdfPath('Deck.md'), 'Deck.pdf');
  assert.equal(defaultPdfPath('Folder/Subfolder/Presentation.MD'), 'Folder/Subfolder/Presentation.pdf');
  assert.equal(defaultPdfPath('Notes'), 'Notes.pdf');
});

test('copyPdfPath generates sequential numbered filenames preserving base folder and name', () => {
  assert.equal(copyPdfPath('Deck.pdf', 1), 'Deck 1.pdf');
  assert.equal(copyPdfPath('Deck.pdf', 2), 'Deck 2.pdf');
  assert.equal(copyPdfPath('Folder/Deck 2026.pdf', 1), 'Folder/Deck 2026 1.pdf');
});

test('nextAvailablePdfPath skips all existing files until an unused index is found', async () => {
  const existing = new Set(['Deck 1.pdf', 'Deck 2.pdf']);
  const exists = async path => existing.has(path);

  const next = await nextAvailablePdfPath('Deck.pdf', exists);
  assert.equal(next, 'Deck 3.pdf');
});

test('waitForDeckMedia waits for images, diagrams and refits all surfaces', async () => {
  let fontsAwaited = false;
  let fitCalled = 0;

  const doc = {
    fonts: {
      ready: (async () => { fontsAwaited = true; })(),
    },
  };

  const image = {
    complete: false,
    decode: async () => { image.complete = true; },
  };

  const diagram = {
    querySelector: sel => (sel === 'svg' ? (diagram.ready ? {} : null) : null),
    classList: { contains: () => false },
    ready: false,
  };

  const deckEl = {
    ownerDocument: doc,
    querySelectorAll: selector => {
      if (selector === 'img') return [image];
      if (selector === '.jss-diagram') return [diagram];
      return [];
    },
  };

  const surface = {
    fit: () => { fitCalled++; },
  };

  const win = {
    setTimeout: fn => {
      diagram.ready = true;
      fn();
      return 1;
    },
  };

  await waitForDeckMedia(deckEl, [surface], win, 1000);

  assert.ok(fontsAwaited, 'fonts.ready was awaited');
  assert.ok(image.complete, 'image was decoded and marked complete');
  assert.ok(diagram.ready, 'diagram was ready before completion');
  assert.equal(fitCalled, 1, 'surface was refitted');
});

async function waitForModal() {
  for (let i = 0; i < 20; i++) {
    if (modalInstance) return modalInstance;
    await new Promise(r => setTimeout(r, 5));
  }
  return modalInstance;
}

async function createTestContext(options = {}) {
  modalInstance = null;
  const binaryWrites = {};
  const vaultFiles = { ...options.existingFiles };

  const printDeckElements = [];
  const fakeDoc = {
    body: {
      append: () => {},
      createDiv: attrs => {
        const el = {
          attrs,
          createDiv: () => ({ createDiv: () => ({}) }),
          remove: () => {
            const idx = printDeckElements.indexOf(el);
            if (idx >= 0) printDeckElements.splice(idx, 1);
          },
          ownerDocument: fakeDoc,
          querySelectorAll: () => [],
        };
        printDeckElements.push(el);
        return el;
      },
    },
    fonts: { ready: Promise.resolve() },
    activeElement: null,
  };

  const fakeWin = {
    setTimeout: fn => { fn(); return 1; },
    clearTimeout: () => {},
    printCalled: false,
    print: () => { fakeWin.printCalled = true; },
    addEventListener: (evt, cb) => {
      if (evt === 'afterprint') fakeWin.afterprintCb = cb;
    },
    require: modName => {
      if (modName === 'electron') {
        return {
          remote: {
            getCurrentWebContents: () => ({
              printToPDF: async () => {
                if (options.printToPdfFails) throw new Error('PDF print driver failed');
                return new Uint8Array([37, 80, 68, 70]); // %PDF
              },
            }),
            shell: { openPath: () => {} },
          },
        };
      }
      return null;
    },
  };
  fakeDoc.defaultView = fakeWin;

  const adapter = {
    exists: async path => Boolean(vaultFiles[path]),
    writeBinary: async (path, buffer) => {
      binaryWrites[path] = new Uint8Array(buffer);
      vaultFiles[path] = binaryWrites[path];
    },
    getFullPath: path => `/vault/${path}`,
  };
  Object.setPrototypeOf(adapter, obsidian.FileSystemAdapter.prototype);

  const app = {
    workspace: {
      on: () => ({}),
      getLeavesOfType: () => [],
    },
    vault: {
      adapter,
    },
  };

  const plugin = new SlidesPlugin(app);
  await plugin.onload();

  const leaf = { app };
  const view = new SlidesView(leaf, plugin);
  view.contentEl = { ownerDocument: fakeDoc };
  view.file = new TFile('MyDeck.md', '# Slide 1\n\n---\n\n# Slide 2');
  view.deck = {
    slides: [
      { markdown: '# Slide 1', title: 'Slide 1' },
      { markdown: '# Slide 2', title: 'Slide 2' },
    ],
  };

  return { view, binaryWrites, vaultFiles, printDeckElements, fakeWin };
}

test('exportPdf exports clean PDF to default destination when no file collision exists', async () => {
  const { view, binaryWrites, printDeckElements } = await createTestContext();

  await view.exportPdf();

  assert.ok(binaryWrites['MyDeck.pdf'], 'MyDeck.pdf was written');
  assert.equal(binaryWrites['MyDeck.pdf'][0], 37, '%PDF header written');
  assert.equal(printDeckElements.length, 0, 'print deck cleaned up');
  assert.equal(view.exporting, false, 'exporting flag is reset');
  assert.ok(lastNotice.includes('MyDeck.pdf'), 'completion notice shown');
});

test('destination collision: overwrite preserves user choice and replaces destination', async () => {
  const originalBytes = new Uint8Array([1, 2, 3]);
  const { view, binaryWrites } = await createTestContext({
    existingFiles: { 'MyDeck.pdf': originalBytes },
  });

  const exportPromise = view.exportPdf();

  const modal = await waitForModal();
  assert.ok(modal, 'modal opened on collision');
  modal.onChoice({ action: 'overwrite' });

  await exportPromise;

  assert.ok(binaryWrites['MyDeck.pdf'], 'MyDeck.pdf was overwritten');
  assert.equal(binaryWrites['MyDeck.pdf'][0], 37, 'new pdf content written');
});

test('destination collision: save copy writes to non-colliding copy and preserves existing file', async () => {
  const originalBytes = new Uint8Array([1, 2, 3]);
  const { view, binaryWrites, vaultFiles } = await createTestContext({
    existingFiles: { 'MyDeck.pdf': originalBytes },
  });

  const exportPromise = view.exportPdf();

  const modal = await waitForModal();
  assert.ok(modal, 'modal opened on collision');
  assert.equal(modal.copyPath, 'MyDeck 1.pdf');
  modal.onChoice({ action: 'copy', path: modal.copyPath });

  await exportPromise;

  assert.equal(vaultFiles['MyDeck.pdf'], originalBytes, 'existing PDF untouched');
  assert.ok(binaryWrites['MyDeck 1.pdf'], 'MyDeck 1.pdf written');
});

test('destination collision: cancel leaves existing file untouched and aborts write', async () => {
  const originalBytes = new Uint8Array([1, 2, 3]);
  const { view, binaryWrites, vaultFiles, printDeckElements } = await createTestContext({
    existingFiles: { 'MyDeck.pdf': originalBytes },
  });

  const exportPromise = view.exportPdf();

  const modal = await waitForModal();
  assert.ok(modal, 'modal opened on collision');
  modal.onChoice({ action: 'cancel' });

  await exportPromise;

  assert.equal(vaultFiles['MyDeck.pdf'], originalBytes, 'existing PDF untouched');
  assert.equal(Object.keys(binaryWrites).length, 0, 'no files written');
  assert.equal(view.exporting, false, 'exporting reset');
  assert.equal(printDeckElements.length, 0, 'no deck elements left');
});

test('repeated export with save copy generates incremental copies (Deck 1.pdf, Deck 2.pdf)', async () => {
  const { view, binaryWrites } = await createTestContext();

  // First export
  await view.exportPdf();
  assert.ok(binaryWrites['MyDeck.pdf']);

  // Second export -> collision -> choose copy
  let promise = view.exportPdf();
  let modal = await waitForModal();
  assert.equal(modal.copyPath, 'MyDeck 1.pdf');
  modalInstance = null;
  modal.onChoice({ action: 'copy', path: modal.copyPath });
  await promise;
  assert.ok(binaryWrites['MyDeck 1.pdf']);

  // Third export -> collision -> choose copy
  promise = view.exportPdf();
  modal = await waitForModal();
  assert.equal(modal.copyPath, 'MyDeck 2.pdf');
  modalInstance = null;
  modal.onChoice({ action: 'copy', path: modal.copyPath });
  await promise;
  assert.ok(binaryWrites['MyDeck 2.pdf']);
});

test('source changes during export do not affect snapshotted output', async () => {
  const { view, binaryWrites } = await createTestContext();

  const promise = view.exportPdf();

  // Mutate file and slides while export is running
  view.file = new TFile('AnotherFile.md', '# Modified');
  view.deck = { slides: [{ markdown: '# Changed', title: 'Changed' }] };

  await promise;

  // Output must still be MyDeck.pdf (the snapshotted target), not AnotherFile.pdf
  assert.ok(binaryWrites['MyDeck.pdf'], 'written to snapshotted destination');
  assert.equal(binaryWrites['AnotherFile.pdf'], undefined, 'later file switch ignored');
});

test('failures during PDF generation clean up print deck and reset exporting state', async () => {
  const { view, printDeckElements } = await createTestContext({
    printToPdfFails: true,
  });

  await view.exportPdf();

  assert.equal(view.exporting, false, 'exporting reset to false on failure');
  assert.equal(printDeckElements.length, 0, 'printDeck removed from DOM on failure');
  assert.ok(lastNotice.includes('Could not export'), 'error notice shown');
});

test('mobile environment without electron falls back to window.print()', async () => {
  const { view, fakeWin, printDeckElements } = await createTestContext();

  // Simulate mobile / non-Electron by removing window.require
  fakeWin.require = undefined;

  await view.exportPdf();

  assert.ok(fakeWin.printCalled, 'win.print() was called');
  assert.ok(fakeWin.afterprintCb, 'afterprint listener was registered');

  // Trigger afterprint
  fakeWin.afterprintCb();
  assert.equal(printDeckElements.length, 0, 'print deck cleaned up on afterprint');
  assert.equal(view.exporting, false, 'exporting reset');
});
