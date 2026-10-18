// Optional real-app QA. Only this project's disposable vault may be used.
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { parseDeck } from '../src/deck.ts';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9234');
const context = browser.contexts()[0], page = context.pages().find(p => p.url().includes('index.html'));
const checks = [], errors = [], note = 'Slide notes demo.md';
const version = JSON.parse(await readFile('manifest.json', 'utf8')).version;
const original = '---\ntitle: Keep metadata\n---\n\n<!-- just-simple-slides:title -->\n# Slide notes demo\n\n## First\n\nVisible content.\n\n---\n\n## Middle\n\n> [!tip] Visible tip\n> Keep this.\n\n---\n\n## Existing\n\n> [!SLIDE]- Custom area\n> Keep these notes.\n\n---\n\n## Last';
const check = (name, ok) => { assert.ok(ok, name); checks.push(name); console.log('PASS ' + name); };
for (const p of context.pages()) p.on('pageerror', e => errors.push(e.message));
context.on('page', p => p.on('pageerror', e => errors.push(e.message)));
const data = () => page.evaluate(() => jssNotesLeaf.view.getViewData());
const state = () => page.evaluate(() => {
  const v = jssNotesLeaf.view;
  return { source: v.getViewData(), index: v.index, areas: v.deck.slides[v.index].areas, count: v.deck.slides.length,
    content: v.editor.state.sliceDoc(), focused: v.editor.hasFocus, root: v.editor.root === v.contentEl.ownerDocument,
    native: jssNotesNative?.view.editor?.getValue(), follower: jssNotesFollower.view.getViewData() };
});
const create = p => p.getByRole('button', { name: 'Create slide notes', exact: true });
const select = i => page.evaluate(i => jssNotesLeaf.view.select(i), i);
const reset = async source => {
  await page.evaluate(async source => { jssNotesNative.view.editor.setValue(source); await jssNotesNative.view.save(); }, source);
  await page.waitForFunction(source => jssNotesLeaf.view.getViewData() === source, source);
  await select(0);
};
let popup;
try {
  const trust = page.getByRole('button', { name: 'Confiar en el autor y activar complementos', exact: true });
  if (await trust.count()) {
    await trust.click();
    await page.waitForFunction(() => app.plugins.plugins['just-simple-slides']);
  }
  await page.evaluate(async ({ original, note, version }) => {
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
    if (plugin.manifest.version !== version) throw Error('Wrong installed version');
    let file = app.vault.getAbstractFileByPath(note);
    if (file) await app.vault.modify(file, original); else file = await app.vault.create(note, original);
    await plugin.open(file); globalThis.jssNotesLeaf = app.workspace.activeLeaf;
    globalThis.jssNotesNative = app.workspace.getLeavesOfType('markdown').find(l => l.view.file === file);
    globalThis.jssNotesFollower = app.workspace.getLeaf('tab');
    await jssNotesFollower.setViewState({ type: 'just-simple-slides', state: { file: file.path } });
    await app.workspace.revealLeaf(jssNotesLeaf); app.workspace.setActiveLeaf(jssNotesLeaf, { focus: true });
    app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse();
  }, { original, note, version });
  for (const p of context.pages()) if (p !== page) await p.close();
  await page.setViewportSize({ width: 1340, height: 920 }); await page.bringToFront();
  await page.mouse.move(5, 5); await page.locator('.notice').waitFor({ state: 'hidden' });
  check('the lower empty panel offers the create button with no editable area', await create(page).isVisible() && !await page.locator('.jss-editor:visible').count());
  await page.screenshot({ path: 'qa/create-notes-empty.png' });
  await create(page).focus(); await page.keyboard.press('Enter');
  let s = await state();
  check('keyboard activation creates one empty Slide notes area and focuses its editor', s.areas.length === 1 && s.areas[0].name === 'Slide notes' && s.content === '' && s.focused);
  check('creation preserves the original prefix, every other slide, metadata and separator', s.count === 4 && s.source.startsWith(original.slice(0, parseDeck(original).slides[0].end)) && s.source.endsWith(original.slice(parseDeck(original).slides[0].end)) && s.source.includes('> [!slide] Slide notes\n>\n\n---'));
  check('the create button is hidden and the new selector is selected', !await create(page).isVisible() && await page.getByRole('tab', { name: 'Slide notes', exact: true }).getAttribute('aria-selected') === 'true');
  check('native Markdown and another slide tab share the new callout immediately', s.source === s.native && s.source === s.follower);
  const created = s.source;
  await page.keyboard.insertText('PRIVATE_NOTES\n\n---\nMore notes.');
  s = await state();
  check('typing immediately writes quoted notes without adding a slide', s.count === 4 && s.content === 'PRIVATE_NOTES\n\n---\nMore notes.' && s.source.includes('> PRIVATE_NOTES\n>\n> ---\n> More notes.'));
  check('new private notes and their name stay out of preview and thumbnails', !(await page.locator('.jss-stage, .jss-thumb-frame').allInnerTexts()).join('').match(/PRIVATE_NOTES|Slide notes/));
  await page.keyboard.press('Control+z'); check('undo typing leaves the newly created empty callout intact', await data() === created);
  await page.keyboard.press('Control+z'); check('one more undo removes creation and restores the exact source and empty panel', await data() === original && await create(page).isVisible());
  await page.keyboard.press('Control+Shift+z'); check('redo restores creation as one operation', await data() === created);
  await page.keyboard.press('Control+Shift+z'); check('redo typing restores the private notes', (await state()).content.includes('PRIVATE_NOTES'));
  await reset(original); await select(2);
  check('an existing folded case-insensitive private area keeps its selector without a create button', !await create(page).isVisible() && (await state()).areas[0].name === 'Custom area');
  await select(1); await create(page).click(); s = await state();
  check('middle-slide creation stays separate from the visible callout and preserves all other slides', s.count === 4 && s.areas.length === 1 && s.source.includes('> Keep this.\n\n\n> [!slide] Slide notes') && s.source.endsWith(original.slice(parseDeck(original).slides[1].end)));
  await page.keyboard.press('Control+z'); await select(3); await create(page).click();
  check('last-slide creation works without a final newline and leaves an empty notes body', (await data()).startsWith(original + '\n\n') && (await state()).content === '' && (await state()).focused);
  await page.keyboard.press('Control+z'); check('last-slide undo restores the absent final newline exactly', await data() === original);
  await reset(''); await create(page).click();
  check('an empty note becomes one slide with editable private notes', (await state()).count === 1 && (await state()).areas.length === 1 && (await state()).focused);
  await reset('## Broken\n\n```md\nUnfinished example.'); await create(page).click();
  check('an unfinished code block cannot silently swallow a newly created callout', await data() === '## Broken\n\n```md\nUnfinished example.' && await create(page).isVisible());
  await reset(original);
  await page.mouse.move(5, 5); await page.locator('.notice').waitFor({ state: 'hidden' });
  await page.setViewportSize({ width: 390, height: 844 });
  check('the lower-panel button remains accessible in a narrow pane', await create(page).isVisible() && await create(page).evaluate(el => el.getBoundingClientRect().right <= innerWidth));
  await page.setViewportSize({ width: 1340, height: 920 });
  await page.evaluate(async () => { app.workspace.moveLeafToPopout(jssNotesLeaf); await app.workspace.revealLeaf(jssNotesLeaf); });
  await page.waitForFunction(() => jssNotesLeaf.view.contentEl.ownerDocument !== document);
  for (const p of context.pages()) if (p !== page && await p.locator('.jss-app').count()) popup = p;
  assert.ok(popup); await popup.bringToFront(); await popup.evaluate(() => window.focus());
  await popup.waitForFunction(() => activeDocument === document);
  await create(popup).click(); await popup.keyboard.insertText('FLOATING_NOTES'); s = await state();
  check('floating creation focuses the correct editor document and synchronizes every tab', s.root && s.focused && s.content === 'FLOATING_NOTES' && s.source === s.native && s.source === s.follower);
  await popup.keyboard.press('Control+z'); await popup.keyboard.press('Control+z');
  check('floating undo restores the original file and create button', await data() === original && await create(popup).isVisible());
  await page.evaluate(async () => { await jssNotesNative.view.save(); jssNotesNative.detach(); globalThis.jssNotesNative = null; });
  await create(popup).click(); await popup.keyboard.insertText('SAVED_WITHOUT_NATIVE');
  await page.evaluate(async () => { await jssNotesLeaf.view.save(); });
  check('notes save to disk and synchronize without a native Markdown tab', await readFile(`qa/vault/${note}`, 'utf8') === await data() && (await state()).follower === await data());
  await popup.keyboard.press('Control+z'); await popup.keyboard.press('Control+z');
  await page.evaluate(async () => { await jssNotesLeaf.view.save(); });
  check('the test finishes with the original file saved byte for byte', await readFile(`qa/vault/${note}`, 'utf8') === original);
  check('no create-notes runtime errors', errors.length === 0);
  await writeFile('qa/create-notes-results.json', JSON.stringify({ pass: true, version, checks, errors }, null, 2));
} catch (error) {
  await (popup && !popup.isClosed() ? popup : page).screenshot({ path: 'qa/create-notes-failure.png' });
  await writeFile('qa/create-notes-results.json', JSON.stringify({ pass: false, error: String(error), checks, errors, state: await state().catch(() => null) }, null, 2));
  throw error;
} finally { await browser.close(); }
