// Optional integration check against an isolated Obsidian --remote-debugging-port=9234 instance.
// Provide Playwright via NODE_PATH or install it separately; it is not a plugin dependency.
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.connectOverCDP(process.env.OBSIDIAN_CDP ?? 'http://127.0.0.1:9234');
const page = browser.contexts()[0].pages().find(page => page.url().includes('index.html'));
if (!page) throw Error('No Obsidian test window');
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
await mkdir('qa', { recursive: true });
const results = [];
const note = 'Just Simple Slides - Demo.md';
const original = await readFile(`demo/${note}`, 'utf8');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (name, result = true) => { assert.ok(result, name); results.push(name); console.log(`PASS ${name}`); };
const click = label => page.getByRole('button', { name: label, exact: true }).click();
const state = () => page.evaluate(() => {
  const view = app.workspace.getLeavesOfType('just-simple-slides')[0]?.view;
  return view ? { data: view.getViewData(), index: view.index, count: view.deck.slides.length, editor: view.editor.state.sliceDoc(), slides: view.deck.slides.map(slide => ({ markdown: slide.markdown, areas: slide.areas })) } : null;
});
try {
  const trust = page.getByRole('button', { name: 'Confiar en el autor y activar complementos', exact: true });
  if (await trust.count()) await trust.click();
  await page.evaluate(async ({ note, original }) => {
    if (app.vault.getName() !== 'vault' || !app.vault.adapter.basePath.includes('just-simple-slides')) throw Error('Refusing non-test vault');
    await app.plugins.loadManifests();
    for (const leaf of app.workspace.getLeavesOfType('just-simple-slides')) {
      await leaf.view.save();
      await leaf.setViewState({ type: 'empty', state: {} });
    }
    if (app.plugins.plugins['just-simple-slides']) await app.plugins.disablePlugin('just-simple-slides');
    await app.plugins.enablePlugin('just-simple-slides');
    if (!app.plugins.plugins['just-simple-slides']) throw Error('Plugin did not load');
    app.plugins.plugins['just-simple-slides'].updateLayout({ sidebarWidth: 208, sourceRatio: 0.3, editorMode: 'markdown', areaIndex: 0 });
    const file = app.vault.getAbstractFileByPath(note);
    await app.vault.modify(file, original);
    await app.plugins.plugins['just-simple-slides'].open(file);
    app.workspace.leftSplit.collapse();
    app.workspace.rightSplit.collapse();
    document.body.classList.remove('theme-dark'); document.body.classList.add('theme-light');
    app.workspace.trigger('css-change');
  }, { note, original });
  await page.waitForSelector('.jss-slide:not(.jss-preparing)');
  await pause(700);
  check('plugin loads in actual Obsidian and opens a six-slide Markdown note', (await state()).count === 6);
  check('frontmatter and note are unchanged when opening the view', (await state()).data === original);
  check('private areas retain free names and Markdown', (await state()).slides[0].areas[0].name === 'Notes' && (await state()).slides[0].areas[0].content.includes('Type: title') && (await state()).slides[0].areas[0].content.includes('Markdown stays the source'));
  check('slide details remain editable in Markdown', (await state()).editor.includes('> [!slide] Notes'));
  check('presenter notes are excluded from the slide preview', !(await page.locator('.jss-stage').innerText()).includes('Markdown stays the source') && await page.locator('.jss-stage .callout[data-callout="slide"]').count() === 0);
  check('presenter notes are excluded from thumbnails', !(await page.locator('.jss-thumb-frame').allInnerTexts()).some(text => text.includes('Markdown stays the source')));
  check('six thumbnail buttons', await page.locator('.jss-thumbnail').count() === 6);
  check('first heading and second heading form title and subtitle', await page.locator('.jss-stage .jss-title').innerText() === 'Just Simple Slides'
    && await page.locator('.jss-stage .jss-subtitle').innerText() === 'Your Markdown. Your theme. Your presentation.');
  const dragBefore = await state();
  const thumbs = page.locator('.jss-thumbnail');
  const third = await thumbs.nth(2).boundingBox();
  await thumbs.nth(0).dragTo(thumbs.nth(2), { targetPosition: { x: third.width / 2, y: third.height - 10 } });
  await pause(300);
  const dragAfter = await state();
  const expectedDown = [...dragBefore.slides];
  expectedDown.splice(2, 0, expectedDown.splice(0, 1)[0]);
  check('dragging a thumbnail down changes the Markdown order', JSON.stringify(dragAfter.slides) === JSON.stringify(expectedDown));
  check('the moved slide stays selected after dropping', dragAfter.index === 2 && dragAfter.editor.includes('Just Simple Slides'));
  check('drag feedback is cleared after dropping', await page.locator('.jss-dragging, .jss-drop-before, .jss-drop-after').count() === 0);
  await pause(2300);
  check('drag reorder autosaves to the Markdown file', await readFile(`qa/vault/${note}`, 'utf8') === dragAfter.data);
  await page.keyboard.press('Control+z');
  check('drag reordering is one undo operation', (await state()).data === dragBefore.data);
  await page.keyboard.press('Control+Shift+z');
  check('drag reordering can be redone', (await state()).data === dragAfter.data);
  await thumbs.nth(2).dragTo(thumbs.nth(0), { targetPosition: { x: 40, y: 6 } });
  await pause(250);
  check('a thumbnail can be dragged back to the start', (await state()).data === dragBefore.data && (await state()).index === 0);
  await thumbs.nth(2).dragTo(thumbs.nth(0), { targetPosition: { x: 40, y: 6 } });
  await pause(250);
  check('an image slide keeps its callout and content when dragged', (await state()).slides[0].areas[0].content.includes('Type: image')
    && (await state()).slides[0].areas[0].content.includes('Let the image speak')
    && await page.locator('.jss-stage .jss-slide').getAttribute('data-layout') === 'image');
  const cancelBefore = (await state()).data;
  await thumbs.nth(0).dragTo(page.locator('.jss-editor'), { targetPosition: { x: 80, y: 25 } });
  await pause(200);
  check('dropping outside the rail does not edit or reorder Markdown', (await state()).data === cancelBefore);
  await page.evaluate(async original => {
    const view = app.workspace.getLeavesOfType('just-simple-slides')[0].view;
    view.setViewData(original, true); await view.save();
  }, original);
  await pause(250);
  await page.screenshot({ path: 'qa/editor-light.png' });
  await page.locator('.jss-thumbnail').nth(1).click();
  await pause(400);
  check('thumbnail selects that slide in preview and source', (await state()).index === 1 && (await state()).editor.includes('One idea, one slide'));
  check('mixed text and local image use two columns', await page.locator('.jss-stage .jss-slide').getAttribute('data-layout') === 'split');
  check('local Obsidian SVG image resolves', await page.locator('.jss-stage img').evaluate(img => img.complete && img.naturalWidth > 0));
  // Multiple private areas are exercised through actual editor input and native rendering.
  const multi = '# Visible title\n\n> [!slide] Alpha PRIVATE_NAME\n> First private.\n\n> [!slide] Beta PRIVATE_NAME\n> Type: not-a-layout\n>\n> Second private.\n\n> [!slide]\n\n> [!slide] Alpha PRIVATE_NAME\n> Fourth private.\n\n> [!tip] Visible tip\n> Keep ordinary callouts.\n';
  await page.evaluate(multi => app.workspace.getLeavesOfType('just-simple-slides')[0].view.setViewData(multi, true), multi);
  await pause(250);
  const tabs = () => page.getByRole('tablist', { name: 'Slide editor areas' }).getByRole('tab');
  check('one selector per callout follows full slide source', JSON.stringify(await tabs().allTextContents()) === JSON.stringify(['full slide source', 'Alpha PRIVATE_NAME', 'Beta PRIVATE_NAME', 'Area 3', 'Alpha PRIVATE_NAME']));
  check('private names appear only in selectors and source', !(await page.locator('.jss-stage').innerText()).includes('PRIVATE_NAME') && !(await page.locator('.jss-thumb-frame').allInnerTexts()).some(t => t.includes('PRIVATE_NAME')) && await page.locator('[data-slide-type]').count() === 0);
  check('ordinary callouts are visible beside multiple private areas', await page.locator('.jss-stage .callout[data-callout="tip"]').count() === 1 && await page.locator('.jss-stage .callout[data-callout="slide"]').count() === 0);
  await page.getByRole('tab', { name: 'Beta PRIVATE_NAME', exact: true }).click();
  check('selecting an area is read-only and shows free Markdown without its header', (await state()).data === multi && (await state()).editor === 'Type: not-a-layout\n\nSecond private.' && await page.getByRole('textbox', { name: 'Slide type', exact: true }).count() === 0);
  await page.locator('.jss-editor .cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('\n\nPRIVATE_ADDED');
  await pause(250);
  const multiEdited = (await state()).data;
  check('editing the second area preserves every byte outside its body', multiEdited === multi.replace('> Second private.', '> Second private.\n>\n> PRIVATE_ADDED'));
  check('arbitrary type text does not control the layout', await page.locator('.jss-stage .jss-slide').getAttribute('data-layout') === 'text');
  await page.getByRole('tab', { name: 'Alpha PRIVATE_NAME', exact: true }).nth(1).click();
  check('repeated names have independent selectors', (await state()).editor === 'Fourth private.');
  await page.keyboard.press('Control+z');
  check('undo restores the edited area even after selecting another area', (await state()).data === multi && await page.getByRole('tab', { name: 'Beta PRIVATE_NAME', exact: true }).getAttribute('aria-selected') === 'true');
  await page.keyboard.press('Control+Shift+z');
  check('redo restores content without mixing private areas', (await state()).data === multiEdited && (await state()).editor === 'Fourth private.');
  await page.getByRole('tab', { name: 'full slide source', exact: true }).click();
  check('full slide source includes all private areas and visible content', (await state()).editor === multiEdited);
  await page.evaluate(() => {
    const view = app.workspace.getLeavesOfType('just-simple-slides')[0].view;
    const start = view.editor.state.sliceDoc().indexOf('Beta PRIVATE_NAME');
    view.editor.dispatch({ selection: { anchor: start, head: start + 'Beta PRIVATE_NAME'.length } });
    view.editor.focus();
  });
  await page.keyboard.insertText('Renamed PRIVATE_NAME');
  await pause(250);
  check('renaming an area in full source updates its selector live', await page.getByRole('tab', { name: 'Renamed PRIVATE_NAME', exact: true }).count() === 1 && await page.getByRole('tab', { name: 'Beta PRIVATE_NAME', exact: true }).count() === 0);
  await page.getByRole('tab', { name: 'Area 3', exact: true }).click();
  check('unnamed empty areas are selectable', (await state()).editor === '');
  await page.locator('.jss-editor .cm-content').click();
  await page.keyboard.insertText('Temporary private text');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await pause(250);
  check('clearing an area keeps its callout and selector', (await state()).slides[0].areas.length === 4 && (await state()).slides[0].areas[2].content === '' && await page.getByRole('tab', { name: 'Area 3', exact: true }).getAttribute('aria-selected') === 'true');
  await page.getByRole('tab', { name: 'full slide source', exact: true }).click();
  await page.locator('.jss-editor .cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('\n\n> [!slide] Extra\n> Anything goes.\n');
  await pause(250);
  check('adding an area in source creates a selector without moving the source cursor', await tabs().count() === 6 && (await state()).editor.endsWith('> Anything goes.\n'));
  await page.keyboard.press('Control+z');
  await pause(250);
  check('removing an area in source removes its selector live', await tabs().count() === 5 && await page.getByRole('tab', { name: 'Extra', exact: true }).count() === 0);
  await page.getByRole('tab', { name: 'full slide source', exact: true }).focus();
  await page.keyboard.press('End');
  check('End selects the last private area', (await state()).editor === 'Fourth private.');
  await page.keyboard.press('Home');
  check('Home returns to full slide source', await page.getByRole('tab', { name: 'full slide source', exact: true }).getAttribute('aria-selected') === 'true');
  await page.keyboard.press('ArrowRight');
  check('arrow keys select the next private area', (await state()).editor === 'First private.');
  await click('Present from this slide (F5)');
  await page.waitForSelector('.jss-presentation .jss-slide');
  check('fullscreen hides every private area and its name but keeps ordinary callouts', !(await page.locator('.jss-presentation').innerText()).includes('PRIVATE_') && await page.locator('.jss-presentation .callout[data-callout="tip"]').count() === 1 && await page.locator('.jss-presentation .callout[data-callout="slide"]').count() === 0);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.jss-presentation', { state: 'detached' });
  await page.evaluate(() => app.workspace.getLeavesOfType('just-simple-slides')[0].view.setViewData('# Plain slide\n\nNo private areas.', true));
  await pause(250);
  check('a slide without callouts offers only full slide source', await tabs().count() === 1 && await tabs().innerText() === 'full slide source' && (await state()).editor.includes('No private areas.'));
  const crlf = '# CRLF title\r\n\r\n> [!slide] Private\r\n> Type: free\r\n>\r\n> A second line.\r\n\r\n> [!slide] Extra\r\n> Untouched.\r\n';
  await page.evaluate(crlf => app.workspace.getLeavesOfType('just-simple-slides')[0].view.setViewData(crlf, true), crlf);
  await page.getByRole('tab', { name: 'Private', exact: true }).click();
  check('CRLF areas load as separate logical editor lines', await page.evaluate(() => app.workspace.getLeavesOfType('just-simple-slides')[0].view.editor.state.doc.lines) === 3 && (await state()).editor === 'Type: free\r\n\r\nA second line.');
  await page.locator('.jss-editor .cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText(' Added.');
  await pause(250);
  check('CRLF body edits preserve all other source and original line endings', (await state()).data === crlf.replace('A second line.', 'A second line. Added.') && !(await state()).data.replaceAll('\r\n', '').includes('\n'));
  await page.getByRole('tab', { name: 'full slide source', exact: true }).click();
  check('full slide source shows the edited CRLF body', (await state()).editor.includes('> A second line. Added.\r\n\r\n> [!slide] Extra'));


  await page.evaluate(original => {
    const view = app.workspace.getLeavesOfType('just-simple-slides')[0].view;
    view.setViewData(original, true); view.select(1);
  }, original);
  await pause(300);
  const detailsBefore = await state();
  await page.getByRole('tab', { name: 'Notes', exact: true }).click();
  check('private editor opens without modifying Markdown', (await state()).data === detailsBefore.data);
  check('the suggested type and presenter notes remain plain body text', (await state()).editor === 'Type: content\n\nShow the source editor, then select the next thumbnail.');
  await page.locator('.jss-editor .cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('\n\nDETAILS_PANEL_PRIVATE');
  await pause(250);
  const detailsEdited = await state();
  check('editing notes preserves the other area and all other slides', detailsEdited.slides[1].areas[1].content === detailsBefore.slides[1].areas[1].content && JSON.stringify(detailsEdited.slides.filter((_, i) => i !== 1)) === JSON.stringify(detailsBefore.slides.filter((_, i) => i !== 1)));
  check('edited private content stays off the slide', !(await page.locator('.jss-stage').innerText()).includes('DETAILS_PANEL_PRIVATE'));
  await page.locator('.jss-thumbnail').nth(2).click();
  check('thumbnail selection updates the selected area editor', (await state()).editor.includes('Let the image speak') && (await state()).editor.includes('Type: image'));
  await page.locator('.jss-thumbnail').nth(1).click();
  await pause(2300);
  check('area edits autosave to the real Markdown file', (await readFile(`qa/vault/${note}`, 'utf8')).includes('> DETAILS_PANEL_PRIVATE'));
  await page.getByRole('tab', { name: 'Cues', exact: true }).click();
  await page.screenshot({ path: 'qa/details-light.png' });
  await page.locator('.jss-app').screenshot({ path: 'qa/details.png' });
  await page.getByRole('tab', { name: 'Notes', exact: true }).click();

  const sidebar = page.locator('.jss-sidebar');
  const bottom = page.locator('.jss-source');
  const leftBefore = (await sidebar.boundingBox()).width;
  const leftGrip = await page.getByRole('separator', { name: 'Resize slide thumbnails' }).boundingBox();
  await page.mouse.move(leftGrip.x + leftGrip.width / 2, leftGrip.y + leftGrip.height / 2);
  await page.mouse.down(); await page.mouse.move(leftGrip.x + 62, leftGrip.y + leftGrip.height / 2, { steps: 6 }); await page.mouse.up();
  const leftAfter = (await sidebar.boundingBox()).width;
  check('thumbnail panel resizes by dragging its divider', leftAfter > leftBefore + 45);
  const bottomBefore = (await bottom.boundingBox()).height;
  const bottomGrip = await page.getByRole('separator', { name: 'Resize slide editor' }).boundingBox();
  await page.mouse.move(bottomGrip.x + bottomGrip.width / 2, bottomGrip.y + bottomGrip.height / 2);
  await page.mouse.down(); await page.mouse.move(bottomGrip.x + bottomGrip.width / 2, bottomGrip.y - 72, { steps: 6 }); await page.mouse.up();
  const bottomAfter = (await bottom.boundingBox()).height;
  check('lower panel resizes by dragging its divider', bottomAfter > bottomBefore + 50);
  await page.getByRole('separator', { name: 'Resize slide editor' }).focus();
  await page.keyboard.press('ArrowDown');
  check('panel divider supports keyboard resizing', (await bottom.boundingBox()).height < bottomAfter - 15);
  await pause(250);
  const savedLayout = await page.evaluate(() => app.plugins.plugins['just-simple-slides'].loadData());
  check('panel sizes and selected mode are saved', savedLayout.sidebarWidth > leftBefore + 45 && savedLayout.sourceRatio > 0.3 && savedLayout.editorMode === 'area' && savedLayout.areaIndex === 0);
  const beforeReopen = (await bottom.boundingBox()).height;
  await page.evaluate(async note => {
    const view = app.workspace.getLeavesOfType('just-simple-slides')[0].view;
    await view.save(); await view.leaf.setViewState({ type: 'empty', state: {} });
    await app.plugins.plugins['just-simple-slides'].open(app.vault.getAbstractFileByPath(note));
  }, note);
  await pause(250);
  check('mode and panel sizes survive reopening the view', await page.getByRole('tab', { name: 'Notes', exact: true }).getAttribute('aria-selected') === 'true'
    && Math.abs((await sidebar.boundingBox()).width - leftAfter) < 2 && Math.abs((await bottom.boundingBox()).height - beforeReopen) < 2);
  await page.getByRole('separator', { name: 'Resize slide thumbnails' }).dblclick();
  await page.getByRole('separator', { name: 'Resize slide editor' }).dblclick();
  check('double-click resets panel sizes', Math.abs((await sidebar.boundingBox()).width - leftBefore) < 2 && Math.abs((await bottom.boundingBox()).height - bottomBefore) < 2);
  await page.evaluate(async original => {
    const view = app.workspace.getLeavesOfType('just-simple-slides')[0].view;
    view.setViewData(original, true); await view.save(); view.select(1);
  }, original);
  await page.getByRole('tab', { name: 'full slide source', exact: true }).click();
  await pause(250);
  await page.screenshot({ path: 'qa/editor-split-light.png' });
  await page.locator('.jss-app').screenshot({ path: 'qa/editor.png' });
  await page.locator('.jss-thumbnail').nth(2).click();
  await pause(300);
  check('image-only slide is centered in its own region', await page.locator('.jss-stage .jss-slide').getAttribute('data-layout') === 'image'
    && await page.locator('.jss-stage .jss-text-region').count() === 0);

  // Actual input, not direct replacement, exercises the selected-slide editor and autosave.
  await page.locator('.jss-thumbnail').nth(1).click();
  const beforeState = await state();
  const before = beforeState.data;
  await page.locator('.jss-editor .cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('\n\nA real edit in slide two.');
  await pause(350);
  const edited = await state();
  check('editing changes only the selected slide and keeps the other slides', edited.data.includes('A real edit in slide two.') && edited.count === 6
    && JSON.stringify(edited.slides.filter((_, i) => i !== 1)) === JSON.stringify(beforeState.slides.filter((_, i) => i !== 1)));
  await pause(2400);
  check('autosave writes the real Markdown file', (await readFile(`qa/vault/${note}`, 'utf8')) === edited.data);
  await page.locator('.jss-thumbnail').nth(4).click();
  await page.locator('.jss-editor .cm-content').click();
  await page.keyboard.press('Control+z');
  await pause(250);
  check('undo returns to the edited slide after navigating elsewhere', (await state()).data === before && (await state()).index === 1);
  await page.keyboard.press('Control+Shift+z');
  await pause(250);
  check('redo restores the whole document', (await state()).data === edited.data);
  await page.keyboard.press('Control+z');
  await click('Duplicate slide');
  check('duplicate slide', (await state()).count === 7);
  await click('Move slide down');
  check('move slide', (await state()).index === 3);
  await click('Delete slide (undo with Ctrl/Cmd+Z)');
  check('delete slide', (await state()).count === 6);
  await page.evaluate(async ({ note, original }) => {
    const file = app.vault.getAbstractFileByPath(note);
    const view = app.workspace.getLeavesOfType('just-simple-slides')[0].view;
    view.setViewData(original, true); await view.save();
    await app.vault.modify(file, original + '\n---\n\n# External change\n');
  }, { note, original });
  await pause(700);
  check('external Markdown changes reload source and slide boundaries together', (await state()).count === 7 && (await state()).data.endsWith('# External change\n'));
  await page.locator('.jss-thumbnail').nth(6).click();
  await page.locator('.jss-editor .cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('\n---\n\n# Split from source\n');
  await pause(350);
  check('typing a separator creates and selects a new slide', (await state()).count === 8 && (await state()).index === 7 && (await state()).editor.includes('Split from source'));
  // Reset via the view, then save, before testing presentation read-only behavior.
  await page.evaluate(async original => {
    const view = app.workspace.getLeavesOfType('just-simple-slides')[0].view;
    view.setViewData(original, true); await view.save(); view.select(1);
  }, original);
  await pause(300);
  await click('Present from this slide (F5)');
  await page.waitForSelector('.jss-presentation .jss-slide');
  await pause(350);
  check('presentation starts on the selected slide', await page.locator('.jss-player-counter').innerText() === '2 / 6');
  check('native fullscreen is active on desktop', await page.evaluate(() => document.fullscreenElement?.classList.contains('jss-presentation')));
  check('presenter notes and slide type are not shown to the audience', !(await page.locator('.jss-presentation').innerText()).includes('Show the source editor') && await page.locator('.jss-presentation .callout[data-callout="slide"]').count() === 0);
  check('presentation inherits theme background', await page.locator('.jss-presentation').evaluate(el => {
    const reference = document.body.createDiv(); reference.style.backgroundColor = 'var(--background-primary)';
    const matches = getComputedStyle(reference).backgroundColor === getComputedStyle(el).backgroundColor;
    reference.remove(); return matches;
  }));
  await page.screenshot({ path: 'qa/presentation-light.png' });
  await page.keyboard.press('ArrowRight');
  check('next-slide keyboard navigation', await page.locator('.jss-player-counter').innerText() === '3 / 6');
  await page.keyboard.press('Space');
  check('Space advances', await page.locator('.jss-player-counter').innerText() === '4 / 6');
  await page.keyboard.press('Home');
  check('Home selects the first slide', await page.locator('.jss-player-counter').innerText() === '1 / 6');
  await page.keyboard.press('End');
  check('End selects the last slide', await page.locator('.jss-player-counter').innerText() === '6 / 6');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.jss-presentation', { state: 'detached' });
  check('Esc returns to the last presented slide', (await state()).index === 5);
  check('presentation leaves Markdown unchanged', (await state()).data === original);

  // Callout privacy is checked against Obsidian's real Markdown parser, not a mock.
  for (const [markdown, layout] of [
    ['> [!SLIDE]- image\n> PRIVATE_FOLDED_NOTES\n> # PRIVATE_HEADING\n\n![[slides-demo.svg]]', 'image'],
    ['> [!slide]+ content\n> PRIVATE_EXPANDED_NOTES\n\n# Visible title', 'title'],
    ['> [!slide]\n> PRIVATE_NOTES_WITHOUT_TYPE\n\n# Visible title', 'title'],
    ['> [!slide] content\n> PRIVATE_FIRST_LINE\nPRIVATE_LAZY_CONTINUATION\n\n# Visible title', 'title'],
    ['# Visible title\n\nPlain Markdown without a callout.', 'text'],
    ['# Visible title\n\n> [!tip] Visible\n> Keep this.\n>\n> > [!slide] Nested\n> > PRIVATE_NESTED\n>\n> Keep this too.', 'text'],
  ]) {
    await page.evaluate(markdown => app.workspace.getLeavesOfType('just-simple-slides')[0].view.setViewData(markdown, true), markdown);
    await pause(200);
    check(`callout rendering: ${layout}, ${markdown.split('\n')[0]}`, await page.locator('.jss-stage .jss-slide').getAttribute('data-layout') === layout
      && !(await page.locator('.jss-stage').innerText()).includes('PRIVATE_'));
  }
  await page.evaluate(() => app.workspace.getLeavesOfType('just-simple-slides')[0].view.setViewData('# Visible title\n\n```md\n> [!slide] content\n> A literal code example.\n```\n\n> [!tip] Visible tip\n> Keep this callout on the slide.', true));
  await pause(200);
  check('literal slide-callout examples in code remain visible', (await page.locator('.jss-stage pre').innerText()).includes('[!slide] content'));
  check('ordinary content callouts remain visible', await page.locator('.jss-stage .callout[data-callout="tip"]').count() === 1);
  await page.evaluate(original => app.workspace.getLeavesOfType('just-simple-slides')[0].view.setViewData(original, true), original);
  await pause(200);

  const fitting = await page.evaluate(async () => {
    const view = app.workspace.getLeavesOfType('just-simple-slides')[0].view;
    const out = [];
    for (let index = 0; index < view.deck.slides.length; index++) {
      view.select(index);
      await new Promise(r => setTimeout(r, 220));
      view.surface.fit();
      const root = view.contentEl.querySelector('.jss-stage');
      const slide = root.querySelector('.jss-slide');
      const bounds = slide.getBoundingClientRect();
      const problems = [];
      for (const el of slide.querySelectorAll('.jss-title, .jss-subtitle, .jss-text > *, .jss-media img')) {
        const rect = el.getBoundingClientRect();
        if (rect.width && rect.height && (rect.left < bounds.left - 2 || rect.right > bounds.right + 2 || rect.top < bounds.top - 2 || rect.bottom > bounds.bottom + 2)) problems.push(el.tagName);
      }
      out.push({ index, layout: slide.dataset.layout, problems });
    }
    return out;
  });
  check('all demo content fits inside the slide', fitting.every(r => !r.problems.length));
  console.log(JSON.stringify(fitting));

  // Stress real rendering, delayed embeds and autoscaling without changing the fixture on disk.
  await page.evaluate(() => {
    const view = app.workspace.getLeavesOfType('just-simple-slides')[0].view;
    view.setViewData('# A title '.repeat(18) + '\n\n## A subtitle '.repeat(12) + '\n\n' + Array.from({ length: 70 }, (_, i) => `- Item ${i}: a detailed point with enough words to wrap.`).join('\n') + '\n\n![[slides-demo.svg]]', true);
  });
  await pause(400);
  const stress = await page.locator('.jss-stage .jss-slide').evaluate(slide => {
    const bounds = slide.getBoundingClientRect();
    return { dense: slide.dataset.dense, fits: [...slide.querySelectorAll('.jss-text > *, .jss-title, .jss-subtitle, img')].every(el => {
      const r = el.getBoundingClientRect(); return r.bottom <= bounds.bottom + 1 && r.right <= bounds.right + 1;
    }) };
  });
  check('dense content shrinks to fit', stress.dense === 'true' && stress.fits);

  await page.evaluate(original => {
    const view = app.workspace.getLeavesOfType('just-simple-slides')[0].view;
    view.setViewData(original, true); view.select(1);
    document.body.classList.remove('theme-light'); document.body.classList.add('theme-dark');
    app.workspace.trigger('css-change');
  }, original);
  await pause(300);
  await page.screenshot({ path: 'qa/editor-dark.png' });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await pause(300);
  check('narrow viewport keeps rail, editor and stage usable', await page.locator('.jss-app').evaluate(el => {
    const stage = el.querySelector('.jss-stage').getBoundingClientRect();
    const editor = el.querySelector('.jss-editor').getBoundingClientRect();
    const present = el.querySelector('.jss-toolbar .mod-cta').getBoundingClientRect();
    return stage.width > 120 && editor.width > 120 && stage.right <= innerWidth + 1 && stage.left >= 0 && present.right <= innerWidth + 1;
  }));
  await page.screenshot({ path: 'qa/editor-narrow.png' });
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  await page.evaluate(async original => {
    const view = app.workspace.getLeavesOfType('just-simple-slides')[0].view;
    view.setViewData(original, true); await view.save();
  }, original);
  await click('Open Markdown');
  await page.waitForSelector('.markdown-source-view');
  check('return to the native Markdown editor', await page.evaluate(() => app.workspace.activeLeaf.view.getViewType() === 'markdown'));
  check('all original Markdown survives the round trip', (await readFile(`qa/vault/${note}`, 'utf8')) === original);
  await page.evaluate(() => {
    const view = app.workspace.activeLeaf.view;
    view.editor.setCursor(view.editor.offsetToPos(view.editor.getValue().indexOf('# A little more detail')));
    app.commands.executeCommandById('just-simple-slides:edit-slides');
  });
  await page.waitForSelector('.jss-app');
  await pause(250);
  check('Edit as slides opens the slide under the native editor cursor', (await state()).index === 4);
  await page.keyboard.press('F5');
  await page.waitForSelector('.jss-presentation .jss-slide');
  check('F5 presents the current slide', await page.locator('.jss-player-counter').innerText() === '5 / 6');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.jss-presentation', { state: 'detached' });
  check('no plugin runtime errors', errors.filter(e => /just-simple-slides|jss-|TypeError|ReferenceError/.test(e)).length === 0);
  await writeFile('qa/results.json', JSON.stringify({ pass: true, results, fitting, stress, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: 'qa/failure.png' });
  await writeFile('qa/results.json', JSON.stringify({ pass: false, error: String(error), results, errors, state: await state() }, null, 2));
  throw error;
} finally { await browser.close(); }
