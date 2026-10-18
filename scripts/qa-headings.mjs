// Optional real-app QA. Refuses every vault except this project's disposable vault.
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { normalizeHeadings, slideHeadings } from '../src/headings.ts';
import { parseDeck } from '../src/deck.ts';
import { TITLE_MARKER } from '../src/presentation-title.ts';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9234');
const context = browser.contexts()[0], page = context.pages().find(p => p.url().includes('index.html'));
const checks = [], errors = [];
for (const p of context.pages()) p.on('pageerror', e => errors.push(e.message));
context.on('page', p => p.on('pageerror', e => errors.push(e.message)));
const original = (await readFile('demo/Just Simple Slides - Demo.md', 'utf8')).replace('> Open with one idea:', '> # PRIVATE_HEADING\n>\n> Open with one idea:');
const note = 'Heading normalization QA.md';
const check = (name, ok) => { assert.ok(ok, name); checks.push(name); console.log('PASS ' + name); };
const data = () => page.evaluate(() => jssHeadingLeaf.view.getViewData());
const state = () => page.evaluate(() => {
  const v = jssHeadingLeaf.view;
  return { source: v.getViewData(), index: v.index, area: v.areaIndex, count: v.deck.slides.length, title: v.deck.presentation?.title,
    selection: v.editor.state.selection.toJSON(), native: jssHeadingNative.view.editor.getValue(), sorter: v.sorter };
});
const open = async p => {
  await p.bringToFront(); await p.evaluate(() => window.focus());
  await p.waitForFunction(() => activeDocument === document);
  await p.getByRole('button', { name: 'Normalize headings', exact: true }).click();
  await p.locator('.modal').waitFor({ state: 'visible' });
};
const apply = async (p, title) => {
  await open(p); await p.getByRole('textbox', { name: 'Presentation title', exact: true }).fill(title);
  await p.locator('.modal').getByRole('button', { name: 'Normalize headings', exact: true }).click();
  await p.locator('.modal').waitFor({ state: 'detached' });
};
let popup;
try {
  const trust = page.getByRole('button', { name: 'Confiar en el autor y activar complementos', exact: true });
  if (await trust.count()) await trust.click();
  const cancel = page.locator('.modal').getByRole('button', { name: 'Cancel', exact: true });
  if (await cancel.count()) await cancel.click();
  await page.evaluate(async ({ note, original }) => {
    if (app.vault.adapter.basePath.replaceAll('\\', '/') !== 'C:/Users/dhtor/OneDrive/@Obsidian-dev/Development/just-simple-slides/qa/vault') throw Error('Not test vault');
    await new Promise(resolve => app.workspace.onLayoutReady(resolve));
    for (const type of ['just-simple-slides', 'markdown']) for (const leaf of app.workspace.getLeavesOfType(type)) {
      if (leaf.view.file) await leaf.view.save(); await leaf.setViewState({ type: 'empty', state: {} });
    }
    const main = app.workspace.getLeavesOfType('empty').find(l => l.view.contentEl.ownerDocument === document);
    if (main) { await app.workspace.revealLeaf(main); app.workspace.setActiveLeaf(main, { focus: true }); }
    for (const leaf of app.workspace.getLeavesOfType('empty')) if (leaf !== main) leaf.detach();
    if (app.plugins.plugins['just-simple-slides']) await app.plugins.disablePlugin('just-simple-slides');
    await app.plugins.loadManifests(); await app.plugins.enablePlugin('just-simple-slides');
    const plugin = app.plugins.plugins['just-simple-slides'];
    let file = app.vault.getAbstractFileByPath(note);
    if (file) await app.vault.modify(file, original); else file = await app.vault.create(note, original);
    await plugin.open(file); globalThis.jssHeadingLeaf = app.workspace.activeLeaf;
    globalThis.jssHeadingNative = app.workspace.getLeavesOfType('markdown').find(l => l.view.file === file);
    jssHeadingLeaf.view.select(4); jssHeadingLeaf.view.focusEditor();
    app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse();
  }, { note, original });
  for (const p of context.pages()) if (p !== page) await p.close();
  await page.bringToFront();
  await page.setViewportSize({ width: 1340, height: 920 });
  await open(page);
  check('the button opens a native dialog with the file name as its default title', await page.getByRole('textbox', { name: 'Presentation title' }).inputValue() === 'Heading normalization QA');
  await page.screenshot({ path: 'qa/headings-dialog.png' });
  await page.getByRole('textbox', { name: 'Presentation title' }).fill('   ');
  check('an empty presentation title cannot be applied', await page.locator('.modal').getByRole('button', { name: 'Normalize headings', exact: true }).isDisabled());
  await page.locator('.modal').getByRole('button', { name: 'Cancel', exact: true }).click();
  check('cancelling leaves the file unchanged', await data() === original && (await state()).native === original);
  await page.locator('.jss-editor .cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText(' PENDING_PRIVATE');
  await page.keyboard.press('Shift+Home');
  const before = await state(), title = 'Workshop overview';
  const expected = normalizeHeadings(before.source, title);
  await apply(page, title);
  const after = await state(), deck = parseDeck(after.source);
  check('the real button applies a separate H1 and exact normalized source in both editors', after.source === expected && after.native === expected && after.title === title);
  check('all six existing slides survive with H2 titles and H3 subtitles', after.count === 6 && deck.slides.every(s => slideHeadings(s.markdown).every((h, i) => h.level === (i === 0 ? 2 : i === 1 ? 3 : Math.max(4, h.level)))));
  check('normalization preserves the selected slide, private area and note selection', after.index === before.index && after.area === before.area && JSON.stringify(after.selection) === JSON.stringify(before.selection));
  check('all private callout names and bodies are unchanged, including private H1 headings', JSON.stringify(deck.slides.map(s => s.areas.map(a => [a.name, a.content]))) === JSON.stringify(parseDeck(before.source).slides.map(s => s.areas.map(a => [a.name, a.content]))));
  check('the independent title never appears in previews or thumbnails', !(await page.locator('.jss-stage').innerText()).includes(title) && !(await page.locator('.jss-thumb-frame').allInnerTexts()).some(t => t.includes(title)));
  await page.keyboard.press('Control+z'); check('one undo restores the original heading levels and pending notes', await data() === before.source);
  await page.keyboard.press('Control+Shift+z'); check('one redo restores the normalized document', await data() === expected);
  await apply(page, title); await page.keyboard.press('Control+z');
  check('reapplying is a no-op and adds no undo step', await data() === before.source);
  await page.keyboard.press('Control+Shift+z');
  await open(page); check('reopening offers the existing independent title', await page.getByRole('textbox', { name: 'Presentation title' }).inputValue() === title);
  await page.getByRole('textbox', { name: 'Presentation title' }).fill('Renamed overview'); await page.keyboard.press('Enter');
  check('Enter applies a renamed title without duplicating it', (await state()).title === 'Renamed overview' && (await data()).split(TITLE_MARKER).length === 2);
  await page.keyboard.press('Control+z'); check('renaming the title is independently undoable', await data() === expected);
  await page.getByRole('button', { name: 'Toggle slide sorter' }).click();
  await apply(page, title); check('the heading button also works in the sorter and preserves its mode', (await state()).sorter && await data() === expected);
  const prefix = expected.slice(0, parseDeck(expected).prefixEnd);
  const cards = page.locator('.jss-thumbnail'), rect = await cards.nth(2).boundingBox();
  await cards.nth(0).dragTo(cards.nth(2), { targetPosition: { x: rect.width - 10, y: rect.height / 2 } });
  await page.waitForTimeout(250);
  check('grid reordering preserves the independent title and slide count', (await data()).startsWith(prefix) && (await state()).count === 6 && await data() !== expected);
  await page.keyboard.press('Control+z'); check('reorder undo leaves the normalization intact', await data() === expected);
  await page.getByRole('button', { name: 'Present from this slide (F5)' }).click(); await page.waitForSelector('.jss-presentation .jss-slide');
  check('the player has six slides and excludes the independent title and private headings', (await page.locator('.jss-player-counter').innerText()).endsWith('/ 6') && !(await page.locator('.jss-presentation').innerText()).includes(title) && !(await page.locator('.jss-presentation').innerText()).includes('PRIVATE_HEADING'));
  await page.keyboard.press('Escape'); await page.waitForSelector('.jss-presentation', { state: 'detached' });
  await page.getByRole('button', { name: 'Edit selected slide in Markdown' }).click();
  check('source navigation accounts for the new presentation title prefix', await page.evaluate(() => {
    const v = jssHeadingLeaf.view, e = jssHeadingNative.view.editor, s = v.deck.slides[v.index], offset = e.posToOffset(e.getCursor());
    return app.workspace.activeLeaf === jssHeadingNative && offset >= s.start && offset <= s.end && e.hasFocus();
  }));
  await page.evaluate(async () => { await app.workspace.revealLeaf(jssHeadingLeaf); jssHeadingLeaf.view.focusEditor(); });
  await page.setViewportSize({ width: 390, height: 844 });
  check('the heading button and presentation control fit in a narrow pane', await page.getByRole('button', { name: 'Normalize headings', exact: true }).isVisible() && await page.getByRole('button', { name: 'Present from this slide (F5)' }).evaluate(el => el.getBoundingClientRect().right <= innerWidth));
  await page.setViewportSize({ width: 1340, height: 920 });
  await page.evaluate(async () => { app.workspace.moveLeafToPopout(jssHeadingLeaf); await app.workspace.revealLeaf(jssHeadingLeaf); });
  await page.waitForFunction(() => jssHeadingLeaf.view.contentEl.ownerDocument !== document);
  for (const p of context.pages()) if (p !== page && await p.locator('.jss-app').count()) popup = p;
  assert.ok(popup, 'floating slide view'); await popup.waitForSelector('.jss-app', { state: 'visible' });
  await open(popup); await popup.keyboard.press('Escape'); await popup.locator('.modal').waitFor({ state: 'detached' });
  check('Escape cancels the floating dialog and returns keyboard focus to its own view', await data() === expected && await popup.evaluate(() => document.activeElement.closest('.jss-app') !== null));
  await apply(popup, 'Floating overview');
  check('the dialog works in the floating window and synchronizes the original native note', (await state()).title === 'Floating overview' && (await state()).native === await data());
  await popup.keyboard.press('Control+z'); check('floating undo restores the independent title and all slides', await data() === expected && (await state()).count === 6);
  await popup.getByRole('button', { name: 'Toggle slide sorter' }).click();
  check('returning to the editor retains the correct floating document root and notes', await page.evaluate(() => jssHeadingLeaf.view.editor.root === jssHeadingLeaf.view.contentEl.ownerDocument) && await popup.locator('.jss-editor').isVisible());
  await page.evaluate(async () => { await jssHeadingLeaf.view.save(); });
  check('the actual saved file matches the normalized buffer exactly', await readFile(`qa/vault/${note}`, 'utf8') === expected);
  check('no heading normalization runtime errors', errors.length === 0);
  await writeFile('qa/headings-results.json', JSON.stringify({ pass: true, checks, errors }, null, 2));
} catch (error) {
  const active = popup && !popup.isClosed() ? popup : page;
  await active.screenshot({ path: 'qa/headings-failure.png' });
  await writeFile('qa/headings-results.json', JSON.stringify({ pass: false, checks, error: String(error), errors, state: await state() }, null, 2));
  throw error;
} finally { await browser.close(); }
