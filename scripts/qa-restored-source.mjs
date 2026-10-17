import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
const version = JSON.parse(await readFile('manifest.json', 'utf8')).version;
const browser = await chromium.connectOverCDP('http://127.0.0.1:9234');
const page = browser.contexts()[0].pages().find(p => p.url().includes('index.html'));
try {
  await page.waitForFunction(version => app.plugins.plugins['just-simple-slides']?.manifest.version === version, version);
  const before = await page.evaluate(async () => {
    if (app.vault.adapter.basePath.replaceAll('\\', '/') !== 'C:/Users/dhtor/OneDrive/@Obsidian-dev/Development/just-simple-slides/qa/vault') throw Error('Not test vault');
    await new Promise(resolve => app.workspace.onLayoutReady(resolve));
    globalThis.jssSmokeSlides = app.workspace.getLeavesOfType('just-simple-slides')[0];
    await jssSmokeSlides.loadIfDeferred();
    await app.workspace.revealLeaf(jssSmokeSlides);
    app.workspace.setActiveLeaf(jssSmokeSlides, { focus: true });
    jssSmokeSlides.view.select(4);
    globalThis.jssSmokeNative = app.workspace.getLeavesOfType('markdown').find(l => l.getViewState().state?.file === 'Just Simple Slides - Demo.md');
    if (!jssSmokeNative) throw Error('Missing restored native tab');
    return { version: app.plugins.plugins['just-simple-slides'].manifest.version, nativeTabs: app.workspace.getLeavesOfType('markdown').length, wasDeferred: !jssSmokeNative.view.file };
  });
  assert.ok(before.wasDeferred, 'This test must exercise an actual deferred Markdown tab');
  await page.getByRole('button', { name: 'Edit selected slide in Markdown', exact: true }).click();
  await page.waitForFunction(() => app.workspace.activeLeaf === jssSmokeNative && jssSmokeNative.view.editor?.hasFocus());
  await page.waitForTimeout(350);
  const after = await page.evaluate(() => {
    const v = jssSmokeSlides.view, e = jssSmokeNative.view.editor, s = v.deck.slides[4];
    const offset = e.posToOffset(e.getCursor()), norm = x => x.replace(/\r\n|\r/g, '\n');
    return { sameNativeTab: app.workspace.activeLeaf === jssSmokeNative, nativeTabs: app.workspace.getLeavesOfType('markdown').length, slidesStillOpen: app.workspace.getLeavesOfType('just-simple-slides').includes(jssSmokeSlides), atSelectedSlide: offset >= norm(v.getViewData().slice(0, s.start)).length && offset <= norm(v.getViewData().slice(0, s.end)).length, focused: e.hasFocus(), unchanged: e.getValue() === v.getViewData() };
  });
  await writeFile(`qa/restored-source-${version}.json`, JSON.stringify({ before, after }, null, 2));
  assert.ok(after.sameNativeTab && after.nativeTabs === before.nativeTabs && after.slidesStillOpen && after.atSelectedSlide && after.focused && after.unchanged, JSON.stringify({ before, after }));
  await page.screenshot({ path: `qa/source-jump-${version}.png` });
  console.log({ before, after });
} finally { await browser.close(); }
