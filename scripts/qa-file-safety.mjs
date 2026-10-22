// Run only against this project's disposable Obsidian instance on port 9234.
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9234');
const page = browser.contexts()[0].pages().find(p => p.url().includes('index.html'));
const source = '# Keep all content\n\nBody **bold**.\n\n> [!slide] Notes\n> Private notes.\n\n---\n\n# Second\n\nMore content.\n';
const checks = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
const check = (name, pass) => { assert.ok(pass, name); checks.push(name); console.log('PASS ' + name); };
try {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(async source => {
    if (app.vault.adapter.basePath.replaceAll('\\', '/') !== 'C:/Users/dhtor/OneDrive/@Obsidian-dev/Development/just-simple-slides/qa/vault') throw Error('Refusing non-test vault');
    for (const type of ['just-simple-slides', 'markdown']) for (const leaf of app.workspace.getLeavesOfType(type)) {
      await leaf.loadIfDeferred();
      if (leaf.view.file) await leaf.view.save();
      await leaf.setViewState({ type: 'empty', state: {} });
    }
    const main = app.workspace.getLeavesOfType('empty').find(leaf => leaf.view.contentEl.ownerDocument === document);
    await app.workspace.revealLeaf(main); app.workspace.setActiveLeaf(main, { focus: true });
    for (const leaf of app.workspace.getLeavesOfType('empty')) if (leaf !== main) leaf.detach();
    await app.plugins.disablePlugin('just-simple-slides');
    await app.plugins.loadManifests(); await app.plugins.enablePlugin('just-simple-slides');
    globalThis.safetyPlugin = app.plugins.plugins['just-simple-slides'];
    let file = app.vault.getAbstractFileByPath('File integrity QA.md');
    if (file) await app.vault.modify(file, source); else file = await app.vault.create('File integrity QA.md', source);
    globalThis.safetyFile = file;
    globalThis.safetyNative = app.workspace.getLeaf('tab');
    await safetyNative.openFile(file);
    await app.workspace.revealLeaf(safetyNative); app.workspace.setActiveLeaf(safetyNative, { focus: true });
    await safetyPlugin.open(file);
    globalThis.safetySlides = app.workspace.activeLeaf;
  }, source);
  check('a slide view only becomes writable after its initial load', await page.evaluate(() => safetySlides.view.isFileLoaded(safetyFile)));
  await page.evaluate(async () => {
    await app.workspace.revealLeaf(safetyNative); app.workspace.setActiveLeaf(safetyNative, { focus: true });
    await Promise.all(Array.from({ length: 8 }, () => safetyPlugin.open(safetyFile)));
  });
  check('eight invocations from Markdown reuse and activate the same slide tab', await page.evaluate(() =>
    app.workspace.getLeavesOfType('just-simple-slides').filter(l => l.view.file === safetyFile).length === 1 && app.workspace.activeLeaf === safetySlides));
  check('opening and focusing preserve every byte of Markdown', await readFile('qa/vault/File integrity QA.md', 'utf8') === source);
  check('invoking presentation again from Markdown reuses both the tab and the existing player', await page.evaluate(async () => {
    await safetyPlugin.open(safetyFile, true);
    const player = safetySlides.view.player;
    await app.workspace.revealLeaf(safetyNative); app.workspace.setActiveLeaf(safetyNative, { focus: true });
    await safetyPlugin.open(safetyFile, true);
    const reused = player && safetySlides.view.player === player && app.workspace.activeLeaf === safetySlides
      && app.workspace.getLeavesOfType('just-simple-slides').filter(l => l.view.file === safetyFile).length === 1;
    player.stop();
    return !!reused;
  }));
  await page.evaluate(() => {
    safetySlides.view.editor.dispatch({ changes: { from: 0, to: safetySlides.view.editor.state.doc.length, insert: 'Private **updated** notes.' } });
  });
  const edited = source.replace('Private notes.', 'Private **updated** notes.');
  check('notes editing synchronizes the native document without replacing slide content', await page.evaluate(edited => safetyNative.view.getViewData() === edited && safetySlides.view.getViewData() === edited, edited));
  await page.evaluate(() => safetySlides.view.undo(false));
  check('notes undo restores the complete original document', await page.evaluate(source => safetySlides.view.getViewData() === source && safetyNative.view.getViewData() === source, source));
  await page.evaluate(() => safetySlides.view.undo(true));
  await page.evaluate(async () => { await safetySlides.view.save(); safetySlides.view.requestSave(); await safetySlides.view.save(true); });
  check('delegated close clears and invalidates the slide buffer', await page.evaluate(() => !safetySlides.view.isFileLoaded() && safetySlides.view.getViewData() === ''));
  await page.evaluate(async () => {
    await safetyNative.setViewState({ type: 'empty', state: {} });
    // Keep the old file reference to reproduce the vulnerable interval exactly.
    await safetySlides.view.save();
  });
  await page.waitForTimeout(2300);
  check('a late autosave after delegated close cannot write the cleared buffer', await readFile('qa/vault/File integrity QA.md', 'utf8') === edited);
  await page.evaluate(async () => {
    await safetySlides.setViewState({ type: 'empty', state: {} });
    await safetyPlugin.open(safetyFile); globalThis.safetySlides = app.workspace.activeLeaf;
    globalThis.safetyNative = app.workspace.getLeavesOfType('markdown').find(l => l.view.file === safetyFile);
    // A genuine edit just before native close exercises core clear() events.
    safetyNative.view.editor.replaceRange('\nNative close edit\n', safetyNative.view.editor.offsetToPos(safetyNative.view.getViewData().length));
    await safetyNative.setViewState({ type: 'empty', state: {} });
  });
  const nativeEdited = edited + '\nNative close edit\n';
  check('closing a dirty native editor preserves the surviving slide buffer', await page.evaluate(expected => safetySlides.view.getViewData() === expected, nativeEdited));
  await page.evaluate(async () => { safetySlides.view.requestSave(); await safetySlides.setViewState({ type: 'empty', state: {} }); });
  await page.waitForTimeout(2300);
  check('closing the final slide tab with a pending autosave preserves the file', await readFile('qa/vault/File integrity QA.md', 'utf8') === nativeEdited);
  await page.evaluate(async () => {
    await safetyPlugin.open(safetyFile); globalThis.safetySlides = app.workspace.activeLeaf;
    const native = app.workspace.getLeavesOfType('markdown').find(l => l.view.file === safetyFile);
    await native.setViewState({ type: 'empty', state: {} });
    const view = safetySlides.view, originalModify = app.vault.modify;
    let release, signal, delayed = false;
    const started = new Promise(resolve => { signal = resolve; });
    app.vault.modify = async function(file, ...args) {
      if (file === safetyFile && !delayed) { delayed = true; signal(); await new Promise(resolve => { release = resolve; }); }
      return originalModify.call(this, file, ...args);
    };
    try {
      view.editor.dispatch({ changes: { from: 0, to: view.editor.state.doc.length, insert: 'First pending edit.' } });
      const pending = view.save(); await started;
      view.editor.dispatch({ changes: { from: 0, to: view.editor.state.doc.length, insert: 'Latest notes before close.' } });
      const closing = view.save(true); release(); await Promise.all([pending, closing]);
    } finally { app.vault.modify = originalModify; }
  });
  const latest = nativeEdited.replace('Private **updated** notes.', 'Latest notes before close.');
  check('closing during an older save flushes the latest notes before clearing', await readFile('qa/vault/File integrity QA.md', 'utf8') === latest);
  await page.evaluate(async () => {
    await safetySlides.setViewState({ type: 'empty', state: {} });
    await safetyPlugin.open(safetyFile); globalThis.safetySlides = app.workspace.activeLeaf;
    safetySlides.view.setSorter(true);
  });
  await page.waitForTimeout(200);
  check('desktop sorter gap is reduced to 14px', await page.evaluate(() => getComputedStyle(safetySlides.view.rail).gap === '14px'));
  await page.screenshot({ path: 'qa/file-safety-sorter.png' });
  await page.setViewportSize({ width: 390, height: 800 });
  await page.waitForTimeout(200);
  check('narrow sorter gap is reduced to 12px', await page.evaluate(() => getComputedStyle(safetySlides.view.rail).gap === '12px'));
  await page.setViewportSize({ width: 1280, height: 900 });
  check('no runtime errors during file lifecycle QA', errors.length === 0);
  await writeFile('qa/file-safety-results.json', JSON.stringify({ pass: true, checks, errors }, null, 2));
} catch (error) {
  await writeFile('qa/file-safety-results.json', JSON.stringify({ pass: false, checks, errors, error: String(error) }, null, 2));
  await page.screenshot({ path: 'qa/file-safety-failure.png' });
  throw error;
} finally { await browser.close(); }
