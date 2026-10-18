// Optional real-app QA: use only the repository's disposable vault and profile.
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9234');
const context = browser.contexts()[0], page = context.pages().find(p => p.url().includes('index.html'));
const checks = [], errors = [];
const version = JSON.parse(await readFile('manifest.json', 'utf8')).version;
const original = Array.from({ length: 8 }, (_, i) => `## Slide ${i + 1}\n\nVisible content.\n\n${i % 2 ? '' : '> [!slide] Notes\n> First line.\n> Second line.\n> Third line.\n\n> [!slide] Cues\n> Another private area.\n'}`).join('\n---\n\n');
const check = (name, ok) => { assert.ok(ok, name); checks.push(name); console.log('PASS ' + name); };
for (const p of context.pages()) p.on('pageerror', e => errors.push(e.message));
context.on('page', p => p.on('pageerror', e => errors.push(e.message)));
const state = () => page.evaluate(() => {
  const v = jssArrowLeaf.view, selection = v.editor.state.selection.main;
  return { index: v.index, source: v.getViewData(), native: jssArrowNative.view.editor.getValue(),
    previewFocus: v.contentEl.ownerDocument.activeElement === v.stage, notesFocus: v.editor.hasFocus,
    caret: selection.head, line: v.editor.state.doc.lineAt(selection.head).number, selected: !selection.empty,
    sorter: v.sorter, area: v.areaIndex, text: v.editor.state.sliceDoc(), width: v.sidebarWidth };
});
const select = index => page.evaluate(index => { jssArrowLeaf.view.select(index); jssArrowLeaf.view.focusPreview(); }, index);
let popup;
try {
  const trust = page.getByRole('button', { name: 'Confiar en el autor y activar complementos', exact: true });
  if (await trust.count()) { await trust.click(); await page.waitForFunction(() => app.plugins.plugins['just-simple-slides']); }
  await page.evaluate(async ({ original, version }) => {
    if (app.vault.adapter.basePath.replaceAll('\\', '/') !== 'C:/Users/dhtor/OneDrive/@Obsidian-dev/Development/just-simple-slides/qa/vault') throw Error('Not test vault');
    await new Promise(resolve => app.workspace.onLayoutReady(resolve));
    for (const type of ['just-simple-slides', 'markdown']) for (const leaf of app.workspace.getLeavesOfType(type)) {
      if (leaf.view.file) await leaf.view.save(); await leaf.setViewState({ type: 'empty', state: {} });
    }
    const main = app.workspace.getLeavesOfType('empty').find(l => l.view.contentEl.ownerDocument === document);
    await app.workspace.revealLeaf(main); app.workspace.setActiveLeaf(main, { focus: true });
    for (const leaf of app.workspace.getLeavesOfType('empty')) if (leaf !== main) leaf.detach();
    if (app.plugins.plugins['just-simple-slides']) await app.plugins.disablePlugin('just-simple-slides');
    await app.plugins.loadManifests(); await app.plugins.enablePlugin('just-simple-slides');
    const plugin = app.plugins.plugins['just-simple-slides'];
    if (plugin.manifest.version !== version) throw Error('Wrong loaded version');
    plugin.updateLayout({ sidebarWidth: 208, sourceRatio: 0.3, areaIndex: 0, sorterSize: 220 });
    let file = app.vault.getAbstractFileByPath('Arrow navigation QA.md');
    if (file) await app.vault.modify(file, original); else file = await app.vault.create('Arrow navigation QA.md', original);
    await plugin.open(file); globalThis.jssArrowLeaf = app.workspace.activeLeaf;
    globalThis.jssArrowNative = app.workspace.getLeavesOfType('markdown').find(l => l.view.file === file);
    app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse();
  }, { original, version });
  await page.setViewportSize({ width: 1340, height: 920 }); await page.bringToFront();
  await page.mouse.move(5, 5); await page.locator('.notice').waitFor({ state: 'hidden' });
  check('opening slides focuses the preview even when private notes exist', (await state()).previewFocus && !(await state()).notesFocus);
  for (const [key, index] of [['ArrowRight', 1], ['ArrowDown', 2], ['ArrowLeft', 1], ['ArrowUp', 0]]) {
    await page.keyboard.press(key);
    check(key + ' selects exactly the expected adjacent slide', (await state()).index === index && (await state()).previewFocus);
  }
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowUp');
  check('previous-slide arrows stop at the first slide', (await state()).index === 0);
  await select(7); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowDown');
  check('next-slide arrows stop at the last slide', (await state()).index === 7);
  await select(0);
  await page.keyboard.down('ArrowRight'); await page.keyboard.down('ArrowRight'); await page.keyboard.up('ArrowRight');
  check('held-key repeat advances one slide per key event', (await state()).index === 2);
  await page.getByRole('button', { name: 'Normalize headings', exact: true }).focus(); await page.keyboard.press('ArrowRight');
  check('navigation from a toolbar button returns focus to the preview', (await state()).index === 3 && (await state()).previewFocus);
  await select(0); await page.locator('.jss-editor .cm-content').click(); await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowRight');
  check('Right in notes moves the text cursor without changing slides', (await state()).index === 0 && (await state()).caret === 1);
  await page.keyboard.press('ArrowDown');
  check('Down in notes moves between text lines without changing slides', (await state()).index === 0 && (await state()).line === 2);
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowUp');
  check('Left and Up in notes retain text-cursor behavior', (await state()).index === 0 && (await state()).line === 1 && (await state()).caret === 0);
  await page.keyboard.press('Shift+ArrowRight');
  check('modified arrows still select text in notes', (await state()).index === 0 && (await state()).selected);
  await page.getByRole('button', { name: 'Normalize headings', exact: true }).click();
  await page.getByRole('textbox', { name: 'Presentation title' }).fill('First'); await page.keyboard.press('ArrowLeft');
  check('a native text input keeps its arrow-key behavior without navigating slides', (await state()).index === 0 && await page.getByRole('textbox', { name: 'Presentation title' }).evaluate(el => el.selectionStart === 4));
  await page.keyboard.press('Escape');
  await page.getByRole('region', { name: 'Slide preview', exact: true }).click(); await page.keyboard.press('ArrowDown');
  check('clicking the preview resumes slide navigation after editing notes', (await state()).index === 1 && (await state()).previewFocus);
  await select(0); await page.getByRole('tab', { name: 'Notes', exact: true }).focus(); await page.keyboard.press('ArrowRight');
  check('private-area selector arrows switch areas rather than slides', (await state()).index === 0 && (await state()).area === 1);
  await page.keyboard.press('ArrowLeft');
  const beforeWidth = (await state()).width;
  await page.getByRole('separator', { name: 'Resize slide thumbnails' }).focus(); await page.keyboard.press('ArrowRight');
  check('divider arrows resize the sidebar rather than change slides', (await state()).index === 0 && (await state()).width > beforeWidth);
  await page.locator('.jss-thumbnail').nth(0).click(); await page.keyboard.press('ArrowRight');
  check('thumbnail arrows advance only once through their existing handler', (await state()).index === 1 && await page.locator('.jss-thumbnail').nth(1).evaluate(el => el === document.activeElement));
  await page.keyboard.press('Control+ArrowDown');
  check('modified thumbnail arrows still reorder slides', (await state()).index === 2 && (await state()).source !== original);
  await page.keyboard.press('Control+z'); check('thumbnail reorder remains one undo step', (await state()).source === original);
  await select(0); await page.getByRole('button', { name: 'Toggle slide sorter' }).click();
  await page.keyboard.press('ArrowDown');
  const columns = await page.locator('.jss-thumbnail').evaluateAll(els => els.filter(el => el.offsetTop === els[0].offsetTop).length);
  check('sorter Down still moves by a visible grid row', (await state()).index === columns);
  await page.keyboard.press('Escape');
  check('returning from the sorter focuses the preview for immediate arrow navigation', (await state()).previewFocus && !(await state()).sorter);
  await page.keyboard.press('ArrowUp'); check('normal Up returns to one-slide navigation after leaving the sorter', (await state()).index === columns - 1);
  await select(0); await page.locator('.jss-editor .cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText(' PENDING_NOTE');
  await page.getByRole('region', { name: 'Slide preview', exact: true }).click(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Control+z');
  check('notes typed before arrow navigation remain undoable across slide selection', (await state()).source === original && (await state()).native === original);
  await select(0);
  const modified = await page.evaluate(() => {
    const v = jssArrowLeaf.view;
    for (const flags of [{ shiftKey: true }, { altKey: true }, { metaKey: true }, { ctrlKey: true }, { isComposing: true }]) {
      v.stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true, ...flags }));
    }
    return v.index;
  });
  check('modified and composing arrow events do not navigate the preview', modified === 0);
  await page.evaluate(async () => { app.workspace.moveLeafToPopout(jssArrowLeaf); await app.workspace.revealLeaf(jssArrowLeaf); });
  await page.waitForFunction(() => jssArrowLeaf.view.contentEl.ownerDocument !== document);
  for (const p of context.pages()) if (p !== page && await p.locator('.jss-app').count()) popup = p;
  assert.ok(popup); await popup.bringToFront(); await popup.evaluate(() => window.focus());
  await popup.waitForFunction(() => activeDocument === document);
  await popup.getByRole('region', { name: 'Slide preview', exact: true }).click();
  for (const [key, index] of [['ArrowRight', 1], ['ArrowDown', 2], ['ArrowLeft', 1], ['ArrowUp', 0]]) {
    await popup.keyboard.press(key); assert.equal((await state()).index, index, 'floating ' + key);
  }
  check('all four arrows navigate correctly in a floating window', (await state()).index === 0 && (await state()).previewFocus);
  await popup.locator('.jss-editor .cm-content').click(); await popup.keyboard.press('Control+Home'); await popup.keyboard.press('ArrowRight');
  check('floating notes retain text-cursor movement in the correct document', (await state()).index === 0 && (await state()).caret === 1 && (await state()).notesFocus);
  await page.evaluate(async () => { await jssArrowLeaf.view.save(); });
  check('navigation leaves the saved Markdown unchanged', await readFile('qa/vault/Arrow navigation QA.md', 'utf8') === original);
  check('no arrow-navigation runtime errors', errors.length === 0);
  await writeFile('qa/arrow-navigation-results.json', JSON.stringify({ pass: true, version, checks, errors }, null, 2));
} catch (error) {
  await (popup && !popup.isClosed() ? popup : page).screenshot({ path: 'qa/arrow-navigation-failure.png' });
  await writeFile('qa/arrow-navigation-results.json', JSON.stringify({ pass: false, error: String(error), checks, errors }, null, 2));
  throw error;
} finally { await browser.close(); }
