// Real-app regression: sample existing canvases in the same task as each UI change.
// This catches stale scale before a delayed ResizeObserver or animation frame fixes it.
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9234');
const context = browser.contexts()[0], page = context.pages().find(p => p.url().includes('index.html'));
const checks = [], errors = [], samples = [];
const version = process.env.QA_EXPECTED_VERSION ?? JSON.parse(await readFile('manifest.json', 'utf8')).version;
const fixture = Array.from({ length: 102 }, (_, i) => `## Slide ${i + 1}\n\n### Optional subtitle\n\n${i % 2 ? '- One idea.\n- Another idea.\n\n' : ''}![[slides-demo.svg]]\n\n> [!slide] Notes\n> Private notes ${i + 1}.`).join('\n\n---\n\n');
const check = (name, ok) => { assert.ok(ok, name); checks.push(name); console.log('PASS ' + name); };
for (const p of context.pages()) p.on('pageerror', e => errors.push(e.message));
context.on('page', p => p.on('pageerror', e => errors.push(e.message)));
const metrics = () => page.evaluate(() => jssFitMetrics());
const precise = rows => rows.length > 0 && rows.every(row => row.delta < 1 && row.centerError < 1);
const toggle = async () => {
  const result = await page.evaluate(() => {
    const v = jssFitLeaf.view, start = performance.now();
    v.root.querySelector('[aria-label="Toggle slide sorter"]').click();
    return { sorter: v.sorter, duration: performance.now() - start, metrics: jssFitMetrics() };
  });
  samples.push(result); return result;
};
let popup;
try {
  const trust = page.getByRole('button', { name: 'Confiar en el autor y activar complementos', exact: true });
  if (await trust.count()) { await trust.click(); await page.waitForFunction(() => app.plugins.plugins['just-simple-slides']); }
  await page.evaluate(async ({ fixture, version }) => {
    if (app.vault.adapter.basePath.replaceAll('\\', '/') !== 'C:/Users/dhtor/OneDrive/@Obsidian-dev/Development/just-simple-slides/qa/vault') throw Error('Wrong vault');
    await new Promise(resolve => app.workspace.onLayoutReady(resolve));
    for (const type of ['just-simple-slides', 'markdown']) for (const leaf of app.workspace.getLeavesOfType(type)) {
      if (leaf.view.file) await leaf.view.save(); await leaf.setViewState({ type: 'empty', state: {} });
    }
    const main = app.workspace.getLeavesOfType('empty').find(l => l.view.contentEl.ownerDocument === document);
    await app.workspace.revealLeaf(main); app.workspace.setActiveLeaf(main, { focus: true });
    for (const leaf of app.workspace.getLeavesOfType('empty')) if (leaf !== main) leaf.detach();
    await app.plugins.disablePlugin('just-simple-slides'); await app.plugins.loadManifests(); await app.plugins.enablePlugin('just-simple-slides');
    const plugin = app.plugins.plugins['just-simple-slides'];
    if (plugin.manifest.version !== version) throw Error('Wrong loaded version');
    plugin.updateLayout({ sidebarWidth: 208, sourceRatio: 0.3, areaIndex: 0, sorterSize: 260 });
    let file = app.vault.getAbstractFileByPath('Thumbnail fit QA.md');
    if (file) await app.vault.modify(file, fixture); else file = await app.vault.create('Thumbnail fit QA.md', fixture);
    await plugin.open(file); globalThis.jssFitLeaf = app.workspace.activeLeaf;
    globalThis.jssFitNative = app.workspace.getLeavesOfType('markdown').find(l => l.view.file === file);
    app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse();
    globalThis.jssFitMetrics = () => jssFitLeaf.view.thumbnails.filter(t => {
      const r = t.button.getBoundingClientRect(), rail = t.button.parentElement.getBoundingClientRect();
      return t.surface?.canvas && r.bottom > rail.top && r.top < rail.bottom;
    }).map(t => {
      const v = t.surface.viewport, s = t.surface.canvas;
      const expected = Math.min(v.clientWidth / 1600, v.clientHeight / 900), actual = new v.ownerDocument.defaultView.DOMMatrix(s.style.transform).a;
      return { index: Number(t.button.dataset.index), delta: Math.abs(actual - expected) * 1600,
        centerError: Math.abs(parseFloat(s.style.left) - (v.clientWidth - 1600 * expected) / 2),
        ownWindow: t.surface.win === v.ownerDocument.defaultView };
    });
  }, { fixture, version });
  for (const p of context.pages()) if (p !== page) await p.close();
  await page.setViewportSize({ width: 1340, height: 920 }); await page.bringToFront();
  await page.waitForFunction(() => jssFitLeaf.view.thumbnails.filter(t => t.surface?.canvas).length > 3);
  await page.mouse.move(5, 5); await page.locator('.notice').waitFor({ state: 'hidden' });
  check('the test opens 102 slides and renders only nearby previews', await page.locator('.jss-thumbnail').count() === 102 && await page.locator('.jss-thumb-frame .jss-slide').count() < 40);
  check('editor to sorter has the correct scale in the same UI task', precise((await toggle()).metrics));
  await page.waitForFunction(() => jssFitLeaf.view.thumbnails.filter(t => t.surface?.canvas).length > 12);
  check('sorter to editor has the correct scale in the same UI task', precise((await toggle()).metrics));
  await page.evaluate(() => {
    globalThis.jssFitCanvases = jssFitLeaf.view.thumbnails.slice(0, 4).map(t => t.surface.canvas);
    globalThis.jssFitHistory = jssFitLeaf.view.history; globalThis.jssFitEditor = jssFitLeaf.view.editor;
    for (const t of jssFitLeaf.view.thumbnails) t.surface?.observer.disconnect();
  });
  check('switching to the sorter does not wait for resize notifications', precise((await toggle()).metrics));
  check('switching back does not wait for resize notifications', precise((await toggle()).metrics));
  await page.evaluate(() => { for (const t of jssFitLeaf.view.thumbnails) t.surface?.observer.observe(t.surface.viewport); });
  for (let i = 0; i < 12; i++) assert.ok(precise((await toggle()).metrics), 'rapid toggle ' + i);
  check('rapid repeated toggles never expose a stale cached scale', true);
  check('switching views keeps existing canvases, the notes editor, and undo history', await page.evaluate(() => jssFitCanvases.every((c, i) => c === jssFitLeaf.view.thumbnails[i].surface.canvas) && jssFitHistory === jssFitLeaf.view.history && jssFitEditor === jssFitLeaf.view.editor));
  await toggle();
  for (const size of [140, 360, 220]) {
    const rows = await page.evaluate(size => {
      const slider = jssFitLeaf.view.root.querySelector('.jss-sorter-zoom input');
      slider.value = String(size); slider.dispatchEvent(new Event('input', { bubbles: true })); return jssFitMetrics();
    }, size);
    assert.ok(precise(rows), 'slider size ' + size);
  }
  check('the thumbnail-size slider updates existing scales before its input handler returns', true);
  await toggle();
  const sidebarRows = await page.evaluate(() => {
    jssFitLeaf.view.verticalDivider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); return jssFitMetrics();
  });
  check('resizing the sidebar updates every cached visible preview immediately', precise(sidebarRows));
  await page.evaluate(() => { for (const t of jssFitLeaf.view.thumbnails) if (t.surface) { const fit = t.surface.fit.bind(t.surface); t.surface.fit = () => { globalThis.jssFullFits++; fit(); }; } globalThis.jssFullFits = 0; });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.evaluate(() => { globalThis.jssFullFits = 0; });
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.waitForFunction(() => jssFitMetrics().every(m => m.delta < 1));
  check('viewport resizing needs no full content-layout pass for existing thumbnails', await page.evaluate(() => jssFullFits === 0));
  await page.evaluate(() => {
    const surface = jssFitLeaf.view.thumbnails[0].surface;
    surface.scheduleFit(); const frame = surface.frame; for (let i = 0; i < 20; i++) surface.scheduleFit();
    globalThis.jssFrameCoalesced = !!frame && frame === surface.frame;
  });
  check('repeated pending content-fit requests share the same animation frame', await page.evaluate(() => jssFrameCoalesced));
  await page.evaluate(async () => { app.workspace.moveLeafToPopout(jssFitLeaf); await app.workspace.revealLeaf(jssFitLeaf); });
  await page.waitForFunction(() => jssFitLeaf.view.contentEl.ownerDocument !== document);
  for (const p of context.pages()) if (p !== page && await p.locator('.jss-app').count()) popup = p;
  assert.ok(popup); await popup.bringToFront(); await popup.evaluate(() => window.focus());
  await popup.waitForFunction(() => activeDocument === document);
  check('floating previews reconnect to the window that owns their DOM', (await metrics()).every(m => m.ownWindow));
  check('floating editor to sorter has the correct scale immediately', precise((await toggle()).metrics));
  check('floating sorter to editor has the correct scale immediately', precise((await toggle()).metrics));
  await popup.setViewportSize({ width: 1500, height: 960 });
  await toggle(); await popup.setViewportSize({ width: 1000, height: 760 });
  await page.waitForFunction(() => jssFitMetrics().every(m => m.delta < 1));
  check('floating grid resizing keeps its visible previews fitted', precise(await metrics()));
  await popup.screenshot({ path: 'qa/thumbnail-fit-floating-grid.png' });
  await toggle(); await popup.screenshot({ path: 'qa/thumbnail-fit-floating-editor.png' });
  check('floating toggles preserve the notes document and its private content', await page.evaluate(() => jssFitLeaf.view.editor.root === jssFitLeaf.view.contentEl.ownerDocument && jssFitLeaf.view.editor.state.sliceDoc().includes('Private notes')));
  check('the source and native Markdown remain byte for byte unchanged', await page.evaluate(fixture => jssFitLeaf.view.getViewData() === fixture && jssFitNative.view.editor.getValue() === fixture, fixture));
  check('private notes stay out of thumbnail previews', !(await popup.locator('.jss-thumb-frame').allInnerTexts()).join('').includes('Private notes'));
  check('no thumbnail fitting runtime errors', errors.length === 0);
  await writeFile('qa/thumbnail-fit-results.json', JSON.stringify({ pass: true, version, checks, samples, errors }, null, 2));
} catch (error) {
  await (popup && !popup.isClosed() ? popup : page).screenshot({ path: 'qa/thumbnail-fit-failure.png' });
  await writeFile('qa/thumbnail-fit-results.json', JSON.stringify({ pass: false, error: String(error), checks, samples, errors }, null, 2));
  throw error;
} finally { await browser.close(); }
