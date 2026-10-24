// Actual Obsidian editing and file-integrity QA. Never opens a non-test vault.
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9234');
const context = browser.contexts()[0], page = context.pages().find(p => p.url().includes('index.html'));
const checks = [], errors = [], requests = [];
for (const target of context.pages()) target.on('pageerror', error => errors.push(error.message));
context.on('page', target => target.on('pageerror', error => errors.push(error.message)));
context.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
const check = (name, value) => { assert.ok(value, name); checks.push(name); console.log('PASS ' + name); };
const empty = '<!-- just-simple-slides:empty-heading -->';
const note = 'Editable headings.md';
let expected = '---\ntags: [slides, demo]\n---\n\n<!-- just-simple-slides:title -->\n# A little editing\n\n## A small **editable** heading\n\n### Keep the message short\n\nMake small changes without leaving the slide.\n\n![[slides-demo.svg]]\n\n#### Body headings stay in the body\n\nThe rest of the Markdown stays intact.\n\n> [!slide] Notes\n> Private **notes** stay private.\n> ## This is not the slide title\n\n---\n\n![[slides-demo.svg]]\n\n---\n\n## A diagram still works\n\n### Markdown and Mermaid\n\n```mermaid\nflowchart LR\n Draft --> Review --> Ready\n```\n\n---\n\n###### Legacy title ###\n\n# Legacy subtitle\n\nExisting levels stay unchanged.\n\n---\n\nSetext title\n=====\n\nSetext subtitle\n=====\n\nKeep the underlines.\n';
const source = () => page.evaluate(() => headerLeaf.view.getViewData());
const waitSource = async value => page.waitForFunction(value => headerLeaf.view.getViewData() === value, value);
const select = async index => {
  await page.evaluate(index => headerLeaf.view.select(index), index);
  await page.waitForFunction(index => headerLeaf.view.index === index && !headerLeaf.view.surface.canvas.classList.contains('jss-preparing'), index);
  await page.waitForTimeout(100);
};
const open = async (role, target = page) => {
  await target.locator('.jss-stage [data-jss-heading-role="' + role + '"]').dblclick();
  await target.getByRole('textbox', { name: 'Slide ' + role, exact: true }).waitFor();
  return target.getByRole('textbox', { name: 'Slide ' + role, exact: true });
};
const menuEdit = async (role, present, target = page) => {
  await target.getByRole('button', { name: 'Edit title or subtitle', exact: true }).click();
  await target.locator('.menu-item').filter({ hasText: (present ? 'Edit ' : 'Add ') + role }).click();
  return target.getByRole('textbox', { name: 'Slide ' + role, exact: true });
};
try {
  await context.setOffline(true);
  await page.setViewportSize({ width: 1400, height: 980 });
  await page.evaluate(async ({ note, expected }) => {
    if (app.vault.adapter.basePath.replaceAll('\\', '/') !== 'C:/Users/dhtor/OneDrive/@Obsidian-dev/Development/just-simple-slides/qa/vault') throw Error('Refusing non-test vault');
    for (const type of ['just-simple-slides', 'markdown']) for (const leaf of app.workspace.getLeavesOfType(type)) {
      await leaf.loadIfDeferred(); if (leaf.view.file) await leaf.view.save(); await leaf.setViewState({ type: 'empty', state: {} });
    }
    const main = app.workspace.getLeavesOfType('empty').find(leaf => leaf.view.contentEl.ownerDocument === document);
    await app.workspace.revealLeaf(main); app.workspace.setActiveLeaf(main, { focus: true });
    for (const leaf of app.workspace.getLeavesOfType('empty')) if (leaf !== main) leaf.detach();
    await app.plugins.disablePlugin('just-simple-slides'); await app.plugins.loadManifests(); await app.plugins.enablePlugin('just-simple-slides');
    let file = app.vault.getAbstractFileByPath(note);
    if (file) await app.vault.modify(file, expected); else file = await app.vault.create(note, expected);
    globalThis.headerNative = app.workspace.getLeaf('tab');
    await headerNative.openFile(file, { state: { mode: 'source', source: true }, active: true });
    app.workspace.setActiveLeaf(headerNative, { focus: true });
    await app.plugins.plugins['just-simple-slides'].open(file); globalThis.headerLeaf = app.workspace.activeLeaf;
    app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse();
    document.body.classList.remove('theme-dark'); document.body.classList.add('theme-light'); app.workspace.trigger('css-change');
  }, { note, expected });
  await page.waitForSelector('.jss-stage .jss-title');
  check('first two Markdown headings render with separate title/subtitle roles', await page.evaluate(() => headerLeaf.view.surface.canvas.querySelector('.jss-title').textContent === 'A small editable heading' && headerLeaf.view.surface.canvas.querySelector('.jss-subtitle').textContent === 'Keep the message short'));
  check('temporary markers never leak into heading text or link metadata', await page.evaluate(() => [...headerLeaf.view.surface.canvas.querySelectorAll('.jss-slide-header, .jss-slide-header *')].every(node => [...node.attributes].every(attribute => !/data-jss-header|jss-[a-f\d]{8}-[a-f\d-]{27}/i.test(attribute.value)))));
  check('private headings are not editable and later headings stay body content', await page.evaluate(() => headerLeaf.view.surface.canvas.querySelectorAll('[data-jss-heading-role]').length === 2 && headerLeaf.view.surface.canvas.querySelector('.jss-text h4').textContent === 'Body headings stay in the body' && !headerLeaf.view.surface.canvas.textContent.includes('Private notes')));
  check('raw HTML headers retain their existing composition and remain read-only', await page.evaluate(async () => {
    const view = headerLeaf.view, host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:-10000px;width:900px;height:520px'; document.body.append(host);
    const surface = view.addChild(new view.surface.constructor(app, host, 'HTML header regression'));
    try {
      await surface.render('<h2>HTML title</h2>\n\n### Markdown subtitle\n\nBody.', view.file.path);
      return surface.canvas.querySelector('.jss-title')?.textContent === 'HTML title' && surface.canvas.querySelector('.jss-subtitle')?.textContent === 'Markdown subtitle' && !surface.headingsEditable && !surface.canvas.querySelector('[data-jss-heading-role]');
    } finally { view.removeChild(surface); host.remove(); }
  }));
  await page.screenshot({ path: 'qa/headings-preview-light.png' });
  let input = await open('title');
  check('double-click opens only one heading field with its raw inline Markdown', await input.inputValue() === 'A small **editable** heading' && await page.locator('.jss-heading-editor input').count() === 1);
  await input.fill('Unconfirmed draft');
  for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'F5']) await page.keyboard.press(key);
  check('cursor keys, no-op navigation and F5 preserve the heading draft', await page.evaluate(() => {
    const draft = headerLeaf.view.headingDraft;
    headerLeaf.view.select(-1); headerLeaf.view.perform('up'); headerLeaf.view.reorderSlide(0, 0);
    return draft === headerLeaf.view.headingDraft && headerLeaf.view.index === 0 && !headerLeaf.view.player;
  }));
  check('typing does not write a partial header to Markdown', await source() === expected);
  await page.keyboard.press('Escape');
  check('Escape cancels without changing any source bytes', await source() === expected && await page.locator('.jss-heading-editor').count() === 0);
  input = await open('title');
  await input.press('End'); await page.keyboard.type('x'); await page.keyboard.press('Control+z');
  check('Ctrl+Z inside the input undoes typing without changing document history', await input.inputValue() === 'A small **editable** heading' && await source() === expected);
  await input.fill('A clearer **title**');
  await page.screenshot({ path: 'qa/headings-edit-light.png' });
  await page.keyboard.press('Enter'); expected = expected.replace('A small **editable** heading', 'A clearer **title**'); await waitSource(expected);
  check('Enter commits exactly the targeted heading and synchronizes the native editor', await page.evaluate(value => headerNative.view.editor.getValue() === value, expected));
  await page.waitForFunction(() => headerLeaf.view.surface.canvas.querySelector('.jss-title')?.textContent === 'A clearer title');
  check('preview and thumbnail caption update after a title edit', await page.evaluate(() => headerLeaf.view.thumbnails[0].caption.textContent === 'A clearer **title**'));
  await page.keyboard.press('Control+z'); const original = expected.replace('A clearer **title**', 'A small **editable** heading'); await waitSource(original);
  check('one document undo restores the complete original header', true);
  await page.keyboard.press('Control+Shift+z'); await waitSource(expected); check('one redo restores the heading edit', true);
  input = await open('subtitle'); await input.fill('A short subtitle'); await page.getByRole('button', { name: 'Save subtitle', exact: true }).click();
  expected = expected.replace('Keep the message short', 'A short subtitle'); await waitSource(expected);
  check('subtitle save changes only the second header', true);
  await open('title'); await page.getByRole('button', { name: 'Remove title', exact: true }).click();
  expected = expected.replace('## A clearer **title**', empty); await waitSource(expected); await page.waitForFunction(() => !headerLeaf.view.surface.canvas.querySelector('.jss-title'));
  check('removing the title keeps the subtitle small and body headings in place', await page.evaluate(() => headerLeaf.view.surface.canvas.querySelector('.jss-subtitle')?.textContent === 'A short subtitle' && !!headerLeaf.view.surface.canvas.querySelector('.jss-text h4')));
  await page.screenshot({ path: 'qa/headings-subtitle-only.png' });
  await open('subtitle'); await page.getByRole('button', { name: 'Remove subtitle', exact: true }).click();
  expected = expected.replace('### A short subtitle', empty); await waitSource(expected);
  check('removing both headings never promotes a body heading', await page.evaluate(() => !headerLeaf.view.surface.canvas.querySelector('.jss-slide-header') && !!headerLeaf.view.surface.canvas.querySelector('.jss-text h4')));
  input = await menuEdit('title', false); check('a missing title can be added from the compact menu', await input.inputValue() === '' && await page.getByRole('button', { name: 'Remove title', exact: true }).isDisabled());
  await input.fill('A restored title'); await page.keyboard.press('Enter'); expected = expected.replace(empty, '## A restored title'); await waitSource(expected);
  input = await menuEdit('subtitle', false); await input.fill('A restored subtitle'); await page.keyboard.press('Control+s'); expected = expected.replace(empty, '### A restored subtitle'); await waitSource(expected);
  check('adding/restoring uses H2 and H3 and supports Ctrl+S', true);
  input = await open('title'); await page.getByRole('button', { name: 'Save title', exact: true }).click();
  await page.keyboard.press('Control+z'); const noSub = expected.replace('### A restored subtitle', empty); await waitSource(noSub);
  check('saving an unchanged heading adds no undo step', true);
  await page.keyboard.press('Control+Shift+z'); await waitSource(expected);
  await select(1); input = await menuEdit('subtitle', false); await input.fill('Just a subtitle'); await page.keyboard.press('Enter');
  expected = expected.replace('---\n\n![[slides-demo.svg]]\n\n---', '---\n' + empty + '\n\n### Just a subtitle\n\n\n![[slides-demo.svg]]\n\n---'); await waitSource(expected);
  check('an image-only slide can have a subtitle without inventing a title', await page.evaluate(() => !headerLeaf.view.surface.canvas.querySelector('.jss-title') && headerLeaf.view.surface.canvas.querySelector('.jss-subtitle')?.textContent === 'Just a subtitle' && !!headerLeaf.view.surface.canvas.querySelector('.jss-media img')));
  await select(3); input = await open('title'); await input.fill('Edited legacy title'); await page.keyboard.press('Enter'); expected = expected.replace('###### Legacy title ###', '###### Edited legacy title ###'); await waitSource(expected);
  check('existing heading levels and closing markers are preserved', true);
  await select(4); input = await open('title'); await input.fill('Edited Setext title'); await page.keyboard.press('Enter'); expected = expected.replace('Setext title\n=====', 'Edited Setext title\n====='); await waitSource(expected);
  check('Setext editing retains the original underline', true);
  await select(0); input = await open('title'); await input.fill('My pending draft');
  expected = expected.replace('## A restored title', '## Native title wins');
  await page.evaluate(value => headerNative.view.editor.setValue(value), expected); await waitSource(expected);
  await page.getByRole('button', { name: 'Save title', exact: true }).click();
  check('a stale draft cannot overwrite newer native Markdown edits', await source() === expected && await input.inputValue() === 'My pending draft' && await page.locator('.jss-heading-status').isVisible());
  await page.keyboard.press('Escape'); input = await open('title'); check('reopening reads the latest native header', await input.inputValue() === 'Native title wins'); await page.keyboard.press('Escape');
  await page.evaluate(() => { document.body.classList.remove('theme-light'); document.body.classList.add('theme-dark'); app.workspace.trigger('css-change'); });
  await open('subtitle'); await page.screenshot({ path: 'qa/headings-edit-dark.png' }); await page.keyboard.press('Escape');
  check('closing a draft releases its owned UI component', await page.evaluate(() => !headerLeaf.view.headingDraft && !headerLeaf.view.stage.querySelector('.jss-heading-editor')));
  await page.evaluate(() => headerLeaf.view.setSorter(true));
  check('sorter thumbnails expose no heading editing controls', await page.locator('.jss-thumbnail input, .jss-thumbnail .jss-heading-editor').count() === 0);
  await page.evaluate(() => headerLeaf.view.setSorter(false)); await select(2);
  if (await page.evaluate(() => !!window.pele)) {
    await page.waitForSelector('.jss-stage .jss-diagram svg'); check('Mermaid composition still renders with editable headers', true);
  } else check('native Mermaid fallback remains available with editable headers', await page.evaluate(() => !!headerLeaf.view.surface.canvas.querySelector('svg') || headerLeaf.view.surface.canvas.textContent.includes('flowchart LR')));
  await page.getByRole('button', { name: 'Present from this slide (F5)', exact: true }).click(); await page.waitForSelector('.jss-presentation .jss-title');
  await page.locator('.jss-presentation .jss-title').dblclick();
  check('presentation headings stay read-only without edit controls', await page.locator('.jss-presentation input, .jss-presentation .jss-heading-editor').count() === 0);
  await page.keyboard.press('Home'); await page.waitForFunction(() => document.querySelector('.jss-player-counter')?.textContent === '1 / 5');
  await page.keyboard.press('ArrowRight'); await page.waitForFunction(() => document.querySelector('.jss-player-counter')?.textContent === '2 / 5');
  check('presentation keyboard navigation is unchanged', true); await page.keyboard.press('Escape'); await page.waitForSelector('.jss-presentation', { state: 'detached' });
  await select(0); const popupReady = context.waitForEvent('page');
  await page.evaluate(async () => { app.workspace.moveLeafToPopout(headerLeaf); await app.workspace.revealLeaf(headerLeaf); });
  await page.waitForFunction(() => headerLeaf.view.contentEl.ownerDocument !== document);
  const popup = await popupReady;
  await popup.waitForSelector('.jss-stage .jss-title');
  input = await menuEdit('title', true, popup); check('the compact menu and editor use the floating window’s document', await input.evaluate(input => input.ownerDocument === document && document.activeElement === input));
  await input.fill('Edited in a floating window'); await popup.keyboard.press('Enter'); expected = expected.replace('## Native title wins', '## Edited in a floating window'); await waitSource(expected);
  check('floating-window edits synchronize back to the main native editor', await page.evaluate(value => headerNative.view.editor.getValue() === value, expected));
  await popup.setViewportSize({ width: 520, height: 760 }); input = await open('subtitle', popup);
  check('the editor fits a narrow floating window', await input.evaluate(input => { const form = input.closest('form').getBoundingClientRect(), stage = input.closest('.jss-stage').getBoundingClientRect(); return form.left >= stage.left && form.right <= stage.right && form.width > 100; }));
  await popup.screenshot({ path: 'qa/headings-floating.png' }); await popup.keyboard.press('Escape');
  await page.evaluate(async () => { await headerNative.view.save(); await headerNative.setViewState({ type: 'empty', state: {} }); });
  input = await open('title', popup); await input.fill('Saved with only the slide editor'); await popup.keyboard.press('Enter');
  expected = expected.replace('## Edited in a floating window', '## Saved with only the slide editor'); await waitSource(expected);
  await page.evaluate(async () => headerLeaf.view.save());
  check('header edits save safely with no native Markdown tab open', await readFile('qa/vault/' + note, 'utf8') === expected);
  input = await open('title', popup); await input.fill('Unconfirmed close draft');
  check('closing the last slide tab discards its unconfirmed draft and late saves preserve the file', await page.evaluate(async () => {
    const view = headerLeaf.view, form = view.headingDraft.form;
    await view.save(true); await headerLeaf.setViewState({ type: 'empty', state: {} }); await view.save();
    return !form.isConnected && !view.isFileLoaded();
  }) && await readFile('qa/vault/' + note, 'utf8') === expected);
  check('saved Markdown contains exactly the confirmed changes', await readFile('qa/vault/' + note, 'utf8') === expected);
  check('frontmatter, independent deck title, notes, images and diagrams remain intact', expected.startsWith('---\ntags: [slides, demo]\n---') && expected.includes('# A little editing') && expected.includes('> Private **notes** stay private.') && expected.includes('```mermaid\nflowchart LR\n Draft --> Review --> Ready\n```'));
  check('no runtime errors during header editing', errors.length === 0);
  check('heading editing works offline without HTTP resources', requests.length === 0);
  await writeFile('qa/heading-edit-results.json', JSON.stringify({ pass: true, checks, errors, requests }, null, 2));
} catch (error) {
  await page.screenshot({ path: 'qa/heading-edit-failure.png' }).catch(() => {});
  await writeFile('qa/heading-edit-results.json', JSON.stringify({ pass: false, checks, errors, error: String(error) }, null, 2));
  throw error;
} finally { await context.setOffline(false).catch(() => {}); await browser.close(); }
