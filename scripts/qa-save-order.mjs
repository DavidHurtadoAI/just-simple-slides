// Force an older save to finish after undo and normalization. Disposable vault only.
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { normalizeHeadings } from '../src/headings.ts';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9234');
const page = browser.contexts()[0].pages().find(p => p.url().includes('index.html'));
const source = '# First\n\n## Subtitle\n\n> [!slide] Notes\n> Private.\n\n---\n\n###### Second\n\nContent.\n';
const expected = normalizeHeadings(source, 'Independent title');
const checks = [], errors = [];
page.on('pageerror', e => errors.push(e.message));
const check = (name, ok) => { assert.ok(ok, name); checks.push(name); console.log('PASS ' + name); };
const allMatch = value => page.evaluate(value => {
  const views = [jssSaveFirst.view, jssSaveSecond.view];
  return views.every(v => v.getViewData() === value);
}, value);
try {
  await page.evaluate(async source => {
    if (app.vault.adapter.basePath.replaceAll('\\', '/') !== 'C:/Users/dhtor/OneDrive/@Obsidian-dev/Development/just-simple-slides/qa/vault') throw Error('Not test vault');
    for (const type of ['just-simple-slides', 'markdown']) for (const leaf of app.workspace.getLeavesOfType(type)) {
      if (leaf.view.file) await leaf.view.save(); await leaf.setViewState({ type: 'empty', state: {} });
    }
    const main = app.workspace.getLeavesOfType('empty').find(l => l.view.contentEl.ownerDocument === document);
    await app.workspace.revealLeaf(main); app.workspace.setActiveLeaf(main, { focus: true });
    for (const leaf of app.workspace.getLeavesOfType('empty')) if (leaf !== main) leaf.detach();
    await app.plugins.disablePlugin('just-simple-slides'); await app.plugins.loadManifests(); await app.plugins.enablePlugin('just-simple-slides');
    const plugin = app.plugins.plugins['just-simple-slides'];
    let file = app.vault.getAbstractFileByPath('Save order QA.md');
    if (file) await app.vault.modify(file, source); else file = await app.vault.create('Save order QA.md', source);
    await plugin.open(file); globalThis.jssSaveFirst = app.workspace.activeLeaf;
    globalThis.jssSaveNative = app.workspace.getLeavesOfType('markdown').find(l => l.view.file === file);
    await app.workspace.revealLeaf(jssSaveNative); await plugin.open(file); globalThis.jssSaveSecond = app.workspace.activeLeaf;
  }, source);
  await page.evaluate(async () => {
    const v = jssSaveFirst.view;
    v.perform('duplicate'); const pending = v.save(); v.undo(false); v.normalizeHeadings('Independent title');
    await pending; await new Promise(resolve => setTimeout(resolve, 450));
  });
  check('an older native-owned save cannot overwrite a later undo and normalization in either slide tab', await allMatch(expected) && await page.evaluate(expected => jssSaveNative.view.getViewData() === expected, expected));
  await page.evaluate(() => jssSaveFirst.view.undo(false));
  check('the stale disk echo preserves normalization undo history', await allMatch(source));
  await page.evaluate(() => jssSaveFirst.view.undo(true));
  await page.waitForTimeout(2400);
  check('autosave ultimately writes the newest normalized buffer', await allMatch(expected) && await readFile('qa/vault/Save order QA.md', 'utf8') === expected);
  const external = expected.replace('## First', '## External title');
  await page.evaluate(async external => { await app.vault.modify(jssSaveFirst.view.file, external); }, external);
  await page.waitForFunction(external => jssSaveFirst.view.getViewData() === external && jssSaveSecond.view.getViewData() === external, external);
  check('genuine external file edits still reach the native editor and both slide tabs', await allMatch(external) && await page.evaluate(external => jssSaveNative.view.getViewData() === external, external));
  const readingExternal = external.replace('## External title', '## Reading view update');
  await page.evaluate(async data => {
    const state = jssSaveNative.getViewState();
    await jssSaveNative.setViewState({ ...state, state: { ...state.state, mode: 'preview' } });
    await app.vault.modify(jssSaveFirst.view.file, data);
  }, readingExternal);
  await page.waitForFunction(data => jssSaveFirst.view.getViewData() === data && jssSaveSecond.view.getViewData() === data, readingExternal);
  check('external file updates also propagate while the native tab is in reading view', await allMatch(readingExternal));
  await page.evaluate(async data => { await app.vault.modify(jssSaveFirst.view.file, data); }, external);
  await page.waitForFunction(data => jssSaveFirst.view.getViewData() === data && jssSaveSecond.view.getViewData() === data, external);
  await page.evaluate(async () => { await jssSaveNative.view.save(); jssSaveNative.detach(); });
  await page.evaluate(async () => {
    const v = jssSaveFirst.view;
    v.perform('duplicate'); const pending = v.save(); v.undo(false);
    await pending; await new Promise(resolve => setTimeout(resolve, 450));
  });
  check('the slide-only save owner and its follower also retain a newer undo', await allMatch(external));
  const slideOnlyExternal = external.replace('## External title', '## Changed without a native tab');
  await page.evaluate(async data => { await app.vault.modify(jssSaveFirst.view.file, data); }, slideOnlyExternal);
  await page.waitForFunction(data => jssSaveFirst.view.getViewData() === data && jssSaveSecond.view.getViewData() === data, slideOnlyExternal);
  check('external file edits propagate between slide tabs when no native editor is open', await allMatch(slideOnlyExternal));
  check('no save-order runtime errors', errors.length === 0);
  await writeFile('qa/save-order-results.json', JSON.stringify({ pass: true, checks, errors }, null, 2));
} catch (error) {
  await writeFile('qa/save-order-results.json', JSON.stringify({ pass: false, checks, errors, error: String(error) }, null, 2));
  throw error;
} finally { await browser.close(); }
