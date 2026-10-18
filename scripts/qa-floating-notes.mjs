// Optional live QA. Uses only this project's disposable Obsidian vault/profile.
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { normalizeHeadings } from '../src/headings.ts';
const { chromium } = createRequire(import.meta.url)('playwright');
const version = JSON.parse(await readFile('manifest.json', 'utf8')).version;
const browser = await chromium.connectOverCDP('http://127.0.0.1:9234');
const context = browser.contexts()[0];
const page = context.pages().find(p => p.url().includes('index.html'));
const errors = [], checks = [], areas = [];
context.on('page', p => p.on('pageerror', e => errors.push(e.message)));
const check = (name, ok) => { assert.ok(ok, name); checks.push(name); console.log('PASS ' + name); };
const rawFixture = Array.from({ length: 30 }, (_, i) => {
  const names = i % 5 === 0 ? ['Notes'] : ['Notes', 'Cues', 'Development'];
  const bodies = names.map((name, area) => {
    const marker = `PRIVATE_${i + 1}_${area + 1}`;
    const lines = area === 0 && i % 3 === 0 ? 180 : 3;
    return `${marker}\n\n` + Array.from({ length: lines }, (_, n) => `Line ${n + 1}: private notes for slide ${i + 1}.`).join('\n') + `\nEND_${i + 1}_${area + 1}`;
  });
  areas.push(...bodies.map((body, area) => ({ slide: i, area, body, marker: `PRIVATE_${i + 1}_${area + 1}`, end: `END_${i + 1}_${area + 1}` })));
  return `# Slide ${i + 1}\n\n![[slides-demo.svg]]\n\n` + names.map((name, a) => `> [!slide] ${name}\n` + bodies[a].split('\n').map(line => line ? `> ${line}` : '>').join('\n')).join('\n\n');
}).join('\n\n---\n\n') + '\n';
const fixture = process.env.QA_NORMALIZE_HEADINGS ? normalizeHeadings(rawFixture, 'Floating notes overview') : rawFixture;
let popup;
try {
  await page.evaluate(async fixture => {
    if (app.vault.adapter.basePath.replaceAll('\\', '/') !== 'C:/Users/dhtor/OneDrive/@Obsidian-dev/Development/just-simple-slides/qa/vault') throw Error('Not the test vault');
    await new Promise(resolve => app.workspace.onLayoutReady(resolve));
    const main = app.workspace.getLeavesOfType('markdown').find(l => l.view.contentEl.ownerDocument === document);
    if (main) app.workspace.setActiveLeaf(main, { focus: true });
    for (const leaf of app.workspace.getLeavesOfType('just-simple-slides')) {
      if (leaf.view.file) await leaf.view.save();
      await leaf.setViewState({ type: 'empty', state: {} });
    }
    const windows = new Set(app.workspace.getLeavesOfType('empty').map(l => l.view.contentEl.ownerDocument.defaultView).filter(w => w !== window));
    for (const win of windows) win.close();
    await app.plugins.disablePlugin('just-simple-slides'); await app.plugins.loadManifests(); await app.plugins.enablePlugin('just-simple-slides');
    const plugin = app.plugins.plugins['just-simple-slides'];
    plugin.updateLayout({ sidebarWidth: 208, sourceRatio: 0.3, areaIndex: 0 });
    const name = 'Floating notes QA.md';
    let file = app.vault.getAbstractFileByPath(name);
    if (file) await app.vault.modify(file, fixture); else file = await app.vault.create(name, fixture);
    await plugin.open(file); globalThis.jssFloatingTestLeaf = app.workspace.activeLeaf;
    globalThis.jssFloatingNative = app.workspace.getLeavesOfType('markdown').find(l => l.view.file === file);
    jssFloatingTestLeaf.view.select(7); jssFloatingTestLeaf.view.focusEditor();
  }, fixture);
  check('the tested plugin is loaded', await page.evaluate(version => app.plugins.plugins['just-simple-slides'].manifest.version === version, version));
  await page.keyboard.press('Control+End'); await page.keyboard.insertText(' BEFORE_MOVE');
  const before = await page.evaluate(() => {
    const v = jssFloatingTestLeaf.view;
    globalThis.jssBeforeEditor = v.editor; globalThis.jssBeforeHistory = v.history;
    return { source: v.getViewData(), selection: v.editor.state.selection.toJSON() };
  });
  await page.evaluate(async () => { app.workspace.moveLeafToPopout(jssFloatingTestLeaf); await app.workspace.revealLeaf(jssFloatingTestLeaf); });
  await page.waitForFunction(() => jssFloatingTestLeaf.view.contentEl.ownerDocument !== document);
  for (const p of context.pages()) if (p !== page && await p.locator('.jss-app').count()) popup = p;
  assert.ok(popup, 'Floating slide window exists');
  await page.waitForFunction(() => jssFloatingTestLeaf.view.editor.root === jssFloatingTestLeaf.view.contentEl.ownerDocument);
  check('moving the slide view rebinds the editor to the floating document', await page.evaluate(() => jssFloatingTestLeaf.view.editor.root === jssFloatingTestLeaf.view.contentEl.ownerDocument));
  check('moving preserves the editor, undo history, selection and unsaved notes', await page.evaluate(before => {
    const v = jssFloatingTestLeaf.view;
    return v.editor === jssBeforeEditor && v.history === jssBeforeHistory && v.getViewData() === before.source && JSON.stringify(v.editor.state.selection.toJSON()) === JSON.stringify(before.selection);
  }, before));
  await popup.locator('.jss-editor .cm-content').click(); await popup.keyboard.press('Control+End'); await popup.keyboard.insertText(' FLOATING_EDIT');
  check('typing in floating notes updates the native Markdown editor', await page.evaluate(() => jssFloatingTestLeaf.view.getViewData().includes('FLOATING_EDIT') && jssFloatingNative.view.editor.getValue() === jssFloatingTestLeaf.view.getViewData()));
  await popup.keyboard.press('Control+z');
  check('undo in the floating window preserves the edit made before moving', await page.evaluate(before => jssFloatingTestLeaf.view.getViewData() === before.source, before));
  await page.evaluate(async fixture => { jssFloatingNative.view.editor.setValue(fixture); await jssFloatingNative.view.save(); }, fixture);
  await page.waitForFunction(fixture => jssFloatingTestLeaf.view.getViewData() === fixture, fixture);
  for (let slide = 0; slide < 30; slide++) {
    await popup.getByRole('option', { name: `${slide + 1}. Slide ${slide + 1}`, exact: true }).click();
    for (const area of areas.filter(a => a.slide === slide)) {
      await popup.getByRole('tablist', { name: 'Slide editor areas' }).getByRole('tab').nth(area.area).click();
      await popup.waitForFunction(marker => document.querySelector('.jss-editor .cm-content')?.textContent.includes(marker), area.marker);
      assert.equal(await page.evaluate(() => jssFloatingTestLeaf.view.editor.state.sliceDoc()), area.body, area.marker);
      if (area.body.length > 1000) {
        await popup.locator('.jss-editor .cm-scroller').evaluate(el => { el.scrollTop = el.scrollHeight; });
        await popup.waitForFunction(end => document.querySelector('.jss-editor .cm-content')?.textContent.includes(end), area.end);
      }
    }
  }
  check('all 78 private areas are visible and editable across 30 floating slides', areas.length === 78);
  check('long notes render their last lines after scrolling', areas.some(a => a.body.length > 1000));
  check('private notes stay out of floating previews and thumbnails', !(await popup.locator('.jss-stage').innerText()).includes('PRIVATE_') && !(await popup.locator('.jss-thumb-frame').allInnerTexts()).some(t => t.includes('PRIVATE_')));
  await popup.setViewportSize({ width: 900, height: 680 });
  await popup.getByRole('separator', { name: 'Resize slide editor' }).focus(); await popup.keyboard.press('ArrowUp');
  check('resizing the floating notes panel keeps its content visible', await popup.locator('.jss-editor').isVisible() && await popup.locator('.jss-editor .cm-content').innerText() !== '');
  await popup.getByRole('button', { name: 'Present from this slide (F5)' }).click();
  await popup.waitForSelector('.jss-presentation .jss-slide');
  check('floating presentation keeps private callouts hidden', !(await popup.locator('.jss-presentation').innerText()).includes('PRIVATE_'));
  await popup.keyboard.press('Escape'); await popup.waitForSelector('.jss-presentation', { state: 'detached' });
  check('returning from fullscreen restores the floating note editor', await popup.locator('.jss-editor .cm-content').innerText() !== '' && await page.evaluate(() => jssFloatingTestLeaf.view.editor.root === jssFloatingTestLeaf.view.contentEl.ownerDocument));
  const source = await page.evaluate(() => jssFloatingTestLeaf.view.getViewData());
  await popup.getByRole('button', { name: 'Edit selected slide in Markdown' }).click();
  await page.waitForFunction(() => app.workspace.activeLeaf === jssFloatingNative);
  check('Edit source focuses the native note in the original window', await page.evaluate(() => jssFloatingNative.view.editor.hasFocus()));
  await page.evaluate(async () => { await jssFloatingTestLeaf.view.save(); });
  check('floating navigation leaves the file unchanged', source === fixture && await readFile('qa/vault/Floating notes QA.md', 'utf8') === fixture);
  check('no floating editor runtime errors', errors.length === 0);
  await writeFile('qa/floating-notes-results.json', JSON.stringify({ pass: true, normalized: !!process.env.QA_NORMALIZE_HEADINGS, version, checks, areaCount: areas.length, errors }, null, 2));
} catch (error) {
  if (popup && !popup.isClosed()) await popup.screenshot({ path: 'qa/floating-notes-failure.png' });
  await writeFile('qa/floating-notes-results.json', JSON.stringify({ pass: false, error: String(error), checks, errors }, null, 2));
  throw error;
} finally { await browser.close(); }
