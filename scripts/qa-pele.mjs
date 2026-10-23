// Actual Obsidian integration QA; refuses every vault except this disposable one.
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { contrastRatio } from '../src/diagram-renderer.ts';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9234');
const context = browser.contexts()[0];
const page = context.pages().find(p => p.url().includes('index.html'));
const checks = [], errors = [], requests = [];
for (const p of context.pages()) p.on('pageerror', error => errors.push(error.message));
context.on('page', p => p.on('pageerror', error => errors.push(error.message)));
context.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
const check = (name, pass) => { assert.ok(pass, name); checks.push(name); console.log('PASS ' + name); };
const demo = await readFile('demo/Pele diagrams.md', 'utf8');
const source = demo + '\n\n---\n\n# Video regression\n\n![[Pele test clip.webm]]\n';
const note = 'Pele integration QA.md';
const select = async (index, target = page) => {
  await target.evaluate(index => peleLeaf.view.select(index), index);
  await target.waitForFunction(index => {
    const view = peleLeaf.view, canvas = view.surface.canvas;
    return view.index === index && canvas && !canvas.classList.contains('jss-preparing')
      && canvas.querySelector('.jss-title')?.textContent === view.deck.slides[index].title;
  }, index);
  await target.waitForTimeout(80);
};
const state = (target = page) => target.evaluate(() => {
  const canvas = peleLeaf.view.surface.canvas;
  return { layout: canvas.dataset.layout, media: canvas.querySelectorAll('.jss-media-cell').length,
    diagrams: canvas.querySelectorAll('.jss-diagram').length, svg: canvas.querySelectorAll('.jss-diagram > svg.pele').length,
    errors: canvas.querySelectorAll('.jss-diagram-error').length, native: canvas.querySelectorAll('.mermaid, .block-language-mermaid').length,
    viewBoxes: [...canvas.querySelectorAll('.jss-diagram > svg')].map(svg => svg.getAttribute('viewBox')),
    types: [...canvas.querySelectorAll('.jss-diagram')].map(host => host.dataset.diagramType),
    disabledZoom: canvas.querySelectorAll('.jss-diagram button, .jss-diagram input, .pele-zoom').length === 0 };
});
let popup;
try {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(async ({ source, note }) => {
    if (app.vault.adapter.basePath.replaceAll('\\', '/') !== 'C:/Users/dhtor/OneDrive/@Obsidian-dev/Development/just-simple-slides/qa/vault') throw Error('Refusing non-test vault');
    await new Promise(resolve => app.workspace.onLayoutReady(resolve));
    for (const type of ['just-simple-slides', 'markdown']) for (const leaf of app.workspace.getLeavesOfType(type)) {
      await leaf.loadIfDeferred(); if (leaf.view.file) await leaf.view.save(); await leaf.setViewState({ type: 'empty', state: {} });
    }
    const main = app.workspace.getLeavesOfType('empty').find(leaf => leaf.view.contentEl.ownerDocument === document);
    await app.workspace.revealLeaf(main); app.workspace.setActiveLeaf(main, { focus: true });
    for (const leaf of app.workspace.getLeavesOfType('empty')) if (leaf !== main) leaf.detach();
    await app.plugins.disablePlugin('just-simple-slides'); await app.plugins.loadManifests(); await app.plugins.enablePlugin('just-simple-slides');
    globalThis.pelePlugin = app.plugins.plugins['just-simple-slides'];
    let file = app.vault.getAbstractFileByPath(note);
    if (file) await app.vault.modify(file, source); else file = await app.vault.create(note, source);
    // Generate a tiny local video fixture without fetching a remote asset.
    if (!app.vault.getAbstractFileByPath('Pele test clip.webm')) {
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#4385be'; ctx.fillRect(0, 0, 320, 180);
      const stream = canvas.captureStream(5), chunks = [];
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
      recorder.ondataavailable = event => chunks.push(event.data);
      const stopped = new Promise(resolve => recorder.onstop = resolve);
      recorder.start(); await new Promise(resolve => setTimeout(resolve, 350)); recorder.stop(); await stopped;
      stream.getTracks().forEach(track => track.stop());
      await app.vault.createBinary('Pele test clip.webm', await new Blob(chunks).arrayBuffer());
    }
    globalThis.peleNative = app.workspace.getLeaf('tab');
    await peleNative.openFile(file, { state: { mode: 'source', source: true }, active: true });
    app.workspace.setActiveLeaf(peleNative, { focus: true });
    await pelePlugin.open(file); globalThis.peleLeaf = app.workspace.activeLeaf;
    app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse();
    document.body.classList.remove('theme-dark'); document.body.classList.add('theme-light'); app.workspace.trigger('css-change');
  }, { source, note });
  check('diagram-internal frontmatter does not split the nine-slide fixture', await page.evaluate(() => peleLeaf.view.deck.slides.length === 9));
  const expected = [[0, 'image', 0, 0, 1], [1, 'split', 1, 1, 2], [2, 'image', 1, 1, 1], [3, 'image', 1, 1, 1], [4, 'image', 1, 1, 1], [5, 'image', 2, 2, 2], [6, 'image', 1, 0, 1], [7, 'text', 0, 0, 0]];
  for (const [index, layout, diagrams, svg, media] of expected) {
    await select(index); const s = await state();
    check(`slide ${index + 1} has ${layout} composition, ${diagrams} diagram(s), and no duplicate native rendering`, s.layout === layout && s.diagrams === diagrams && s.svg === svg && s.media === media && s.native === 0);
    check(`slide ${index + 1} keeps zoom controls out of the slide`, s.disabledZoom);
    if (index === 1) check('mixed text, image and diagram leave readable logical labels', await page.evaluate(() => !peleLeaf.view.surface.diagrams[0].dense));
    if ([1, 3, 4, 5, 6].includes(index)) await page.screenshot({ path: `qa/pele-slide-${index + 1}.png` });
  }
  check('syntax failure displays a comprehensible error without an old SVG', (await state()).errors === 0 && await page.evaluate(() => {
    const canvas = peleLeaf.view.thumbnails[6].surface?.canvas;
    return !canvas || canvas.querySelectorAll('.jss-diagram svg').length === 0;
  }));
  await select(6);
  check('the error slide shows a line number and no diagram', (await state()).errors === 1 && (await state()).svg === 0 && await page.evaluate(() => /line \d+/.test(peleLeaf.view.surface.canvas.querySelector('.jss-diagram-error').textContent)));
  await page.evaluate(() => peleNative.view.editor.setValue(peleNative.view.getViewData().replace('flowchart LR\n  A -->\n```', 'flowchart LR\n  A[Fixed] --> B[Ready]\n```')));
  await page.waitForFunction(() => peleLeaf.view.surface.canvas?.querySelector('.jss-diagram[data-diagram-type="flowchart"] svg'));
  check('correcting invalid source replaces the error with a new diagram', (await state()).errors === 0 && (await state()).svg === 1);
  await page.evaluate(source => peleNative.view.editor.setValue(source), source);
  await page.waitForFunction(() => peleLeaf.view.surface.canvas?.querySelector('.jss-diagram-error'));
  check('a later syntax error removes the previous successful SVG', (await state()).errors === 1 && (await state()).svg === 0);
  check('a superseded asynchronous render cannot restore an older valid diagram over a new error', await page.evaluate(async () => {
    pelePlugin.registerMarkdownCodeBlockProcessor('jss-pele-wait', async () => { await new Promise(resolve => setTimeout(resolve, 80)); });
    const surface = peleLeaf.view.surface;
    const older = surface.render('## Older diagram\n\n```jss-pele-wait\nwait\n```\n\n```mermaid\nflowchart LR\n A-->B\n```', peleLeaf.view.file.path);
    const latest = surface.render('## Latest error\n\n```mermaid\nflowchart LR\n A -->\n```', peleLeaf.view.file.path);
    await Promise.all([older, latest]);
    const correct = surface.canvas.querySelector('.jss-title').textContent === 'Latest error' && !!surface.canvas.querySelector('.jss-diagram-error') && !surface.canvas.querySelector('.jss-diagram svg');
    await surface.render(peleLeaf.view.deck.slides[peleLeaf.view.index].markdown, peleLeaf.view.file.path);
    return correct;
  }));
  await select(8);
  await page.waitForFunction(() => peleLeaf.view.surface.canvas?.querySelector('video')?.readyState >= 1);
  check('existing video embeds still load their metadata and controls', await page.evaluate(() => { const video = peleLeaf.view.surface.canvas.querySelector('video'); return video.videoWidth === 320 && video.controls; }));
  await select(2);
  check('a title and diagram use the full visual width', await page.evaluate(() => peleLeaf.view.surface.canvas.querySelector('.jss-media').clientWidth > 1300));
  check('the renderer uses Obsidian’s own Pele instance', await page.evaluate(() => peleLeaf.view.surface.diagrams[0].engine === window.pele));
  const full = (await state()).viewBoxes;
  await page.evaluate(() => peleLeaf.view.setSorter(true));
  await page.waitForFunction(() => peleLeaf.view.thumbnails[2].surface?.canvas?.querySelector('.jss-diagram svg'));
  check('sorter thumbnail and editor use the same logical diagram geometry', await page.evaluate(full => JSON.stringify([...peleLeaf.view.thumbnails[2].surface.canvas.querySelectorAll('.jss-diagram svg')].map(svg => svg.getAttribute('viewBox'))) === JSON.stringify(full), full));
  await page.evaluate(() => { peleLeaf.view.root.style.setProperty('--jss-sorter-size', '140px'); peleLeaf.view.fitViewports(); });
  await page.waitForTimeout(150);
  check('making thumbnails smaller does not recompose the diagram', await page.evaluate(full => JSON.stringify([...peleLeaf.view.thumbnails[2].surface.canvas.querySelectorAll('.jss-diagram svg')].map(svg => svg.getAttribute('viewBox'))) === JSON.stringify(full), full));
  await page.evaluate(() => peleLeaf.view.setSorter(false));
  await page.setViewportSize({ width: 600, height: 800 }); await page.waitForTimeout(150);
  check('narrow editor scaling preserves diagram direction and geometry', JSON.stringify((await state()).viewBoxes) === JSON.stringify(full));
  await page.setViewportSize({ width: 1280, height: 900 });
  check('measured and visible diagram font families agree', await page.evaluate(() => {
    const host = peleLeaf.view.surface.canvas.querySelector('.jss-diagram'), svg = host.querySelector('svg');
    return getComputedStyle(host).fontFamily === getComputedStyle(svg).fontFamily && svg.style.getPropertyValue('--pele-font') === getComputedStyle(host).fontFamily;
  }));
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.body.classList.toggle('theme-dark', theme === 'dark'); document.body.classList.toggle('theme-light', theme === 'light'); app.workspace.trigger('css-change'); }, theme);
    await page.waitForTimeout(150);
    const palette = await page.evaluate(() => { const style = getComputedStyle(peleLeaf.view.surface.canvas.querySelector('.jss-diagram')); return { bg: style.getPropertyValue('--background-primary').trim(), fg: style.color, series: Array.from({ length: 8 }, (_, i) => style.getPropertyValue(`--pele-series-${i + 1}`).trim()) }; });
    check(`${theme} theme diagram labels and chart series have sufficient contrast`, contrastRatio(palette.bg, palette.fg) >= 4.5 && palette.series.every(color => contrastRatio(color, palette.bg) >= 4.5));
    await page.screenshot({ path: `qa/pele-${theme}.png` });
  }
  check('speaker notes stay out of every rendered slide', await page.evaluate(() => ![...document.querySelectorAll('.jss-slide')].some(slide => slide.textContent.includes('These notes stay private'))));
  check('simultaneous previews have no conflicting SVG IDs', await page.evaluate(() => { const ids = [...document.querySelectorAll('.jss-diagram svg [id]')].map(el => el.id); return ids.length > 0 && new Set(ids).size === ids.length; }));
  const adjacent = await page.evaluate(async () => {
    const view = peleLeaf.view, host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:-10000px;width:920px;height:520px'; document.body.append(host);
    const surface = view.addChild(new view.surface.constructor(app, host, 'Adjacent Markdown QA'));
    let formatted = true, privateNotes = false;
    try {
      for (const [prefix, continuation] of [['', ''], ['> ', '> '], ['- ', '  '], ['> 1. ', '>    ']]) {
        const source = prefix + '```mermaid\n' + continuation + 'flowchart LR\n' + continuation + ' A-->B\n' + continuation + '```\n' + continuation + 'After **bold**';
        await surface.render(source, view.file.path);
        formatted &&= surface.canvas.querySelectorAll('strong').length === 1 && surface.canvas.querySelectorAll('.jss-diagram svg').length === 1;
      }
      await surface.render('# Public\n\n> [!slide] Notes\n> ```mermaid\n> flowchart LR\n> A-->B\n> ```\n> Private **bold**', view.file.path);
      privateNotes = !surface.canvas.textContent.includes('Private') && !surface.canvas.querySelector('.jss-diagram, strong');
    } finally { view.removeChild(surface); host.remove(); }
    return { formatted, privateNotes };
  });
  check('Markdown directly after Mermaid keeps formatting in paragraphs, quotes and lists', adjacent.formatted);
  check('a private callout stays private after an adjacent Mermaid fence', adjacent.privateNotes);
  const hidden = await page.evaluate(async () => {
    const view = peleLeaf.view, host = document.createElement('div');
    host.style.cssText = 'display:none;position:absolute;left:-10000px;width:920px;height:520px'; document.body.append(host);
    const surface = view.addChild(new view.surface.constructor(app, host, 'Hidden Pele QA'));
    globalThis.peleHidden = { host, surface };
    await surface.render(view.deck.slides[2].markdown, view.file.path);
    const deferred = !surface.viewport.querySelector('.jss-diagram svg'); host.style.display = 'block';
    return deferred;
  });
  await page.waitForFunction(() => peleHidden.surface.viewport.querySelector('.jss-diagram svg'));
  check('an initially hidden surface renders on first reveal', hidden);
  await page.evaluate(() => { peleHidden.host.style.display = 'none'; peleHidden.host.style.setProperty('--font-text', 'Courier New'); peleHidden.surface.scheduleFit(); });
  await page.waitForTimeout(80);
  await page.evaluate(() => peleHidden.host.style.display = 'block');
  await page.waitForFunction(() => peleHidden.surface.viewport.querySelector('.jss-diagram svg')?.style.getPropertyValue('--pele-font').includes('Courier'));
  check('font updates made while hidden are measured when revealed', true);
  check('surface cleanup disconnects resize/mutation observers and the font listener', await page.evaluate(() => {
    const { surface, host } = peleHidden; let resized = false, mutated = false, fonts = false;
    const resize = surface.observer.disconnect.bind(surface.observer), mutation = surface.mutation.disconnect.bind(surface.mutation);
    surface.observer.disconnect = () => { resized = true; resize(); }; surface.mutation.disconnect = () => { mutated = true; mutation(); };
    const set = surface.fontDocument.fonts, remove = set.removeEventListener;
    set.removeEventListener = function(type, callback, ...args) { if (type === 'loadingdone' && callback === surface.fontsChanged) fonts = true; return remove.call(this, type, callback, ...args); };
    try { peleLeaf.view.removeChild(surface); surface.scheduleFit(); }
    finally { set.removeEventListener = remove; host.remove(); }
    return resized && mutated && fonts && surface.disposed && surface.frame === 0 && !surface.viewport.isConnected;
  }));
  await page.getByRole('button', { name: 'Present from this slide (F5)', exact: true }).click();
  await page.waitForSelector('.jss-presentation .jss-diagram svg');
  await page.waitForFunction(() => document.fullscreenElement?.classList.contains('jss-presentation'));
  check('fullscreen player uses the same diagram geometry', await page.evaluate(full => !!document.fullscreenElement && JSON.stringify([...document.querySelectorAll('.jss-presentation .jss-diagram svg')].map(svg => svg.getAttribute('viewBox'))) === JSON.stringify(full), full));
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('.jss-player-counter')?.textContent === '4 / 9');
  check('player arrows navigate slides rather than diagram zoom', true);
  await page.keyboard.press('Escape'); await page.waitForSelector('.jss-presentation', { state: 'detached' });
  await select(2);
  await page.evaluate(async () => { app.workspace.moveLeafToPopout(peleLeaf); await app.workspace.revealLeaf(peleLeaf); });
  await page.waitForFunction(() => peleLeaf.view.contentEl.ownerDocument !== document);
  for (const candidate of context.pages()) if (candidate !== page && await candidate.locator('.jss-app').count()) popup = candidate;
  assert.ok(popup, 'floating slide window');
  await popup.waitForLoadState('domcontentloaded');
  await page.evaluate(async () => { await peleLeaf.view.contentEl.ownerDocument.fonts.ready; peleLeaf.view.onResize(); });
  await popup.waitForFunction(() => document.querySelector('.jss-stage .jss-diagram svg'));
  check('floating window reconnects the surface to its own document and fonts', await page.evaluate(() => peleLeaf.view.surface.win === peleLeaf.view.contentEl.ownerDocument.defaultView && peleLeaf.view.surface.fontDocument === peleLeaf.view.contentEl.ownerDocument));
  const floatingBox = await popup.locator('.jss-stage .jss-diagram svg').getAttribute('viewBox');
  check('floating diagram retains the same logical composition', floatingBox === full[0]);
  await popup.screenshot({ path: 'qa/pele-floating.png' });
  await popup.getByRole('button', { name: 'Present from this slide (F5)', exact: true }).click();
  await popup.waitForSelector('.jss-presentation .jss-diagram svg');
  check('floating player renders its diagram and keeps zoom disabled', await popup.locator('.jss-presentation .jss-diagram button').count() === 0);
  await popup.keyboard.press('ArrowRight'); await popup.waitForFunction(() => document.querySelector('.jss-player-counter')?.textContent === '4 / 9');
  await popup.keyboard.press('Escape'); await popup.waitForSelector('.jss-presentation', { state: 'detached' });
  // Freshly load the plugin offline, using Obsidian's local engine rather than a cached SVG.
  await context.setOffline(true);
  const requestCount = requests.length;
  await page.evaluate(async () => {
    for (const leaf of app.workspace.getLeavesOfType('just-simple-slides')) { await leaf.view.save(); await leaf.setViewState({ type: 'empty', state: {} }); }
    await app.plugins.disablePlugin('just-simple-slides'); await app.plugins.loadManifests(); await app.plugins.enablePlugin('just-simple-slides');
    await app.workspace.revealLeaf(peleNative); app.workspace.setActiveLeaf(peleNative, { focus: true });
    const main = peleNative.view.contentEl.ownerDocument;
    if (main !== document) throw Error('Native test leaf left the main window');
    await app.plugins.plugins['just-simple-slides'].open(peleNative.view.file); globalThis.peleLeaf = app.workspace.activeLeaf;
  });
  for (const [index, type] of [[2, 'flowchart'], [3, 'sequence'], [4, 'xychart']]) {
    await select(index);
    check(`fresh native Pele ${type} rendering works offline`, (await state()).svg === 1 && (await state()).errors === 0);
  }
  await select(0);
  await page.waitForFunction(() => { const image = peleLeaf.view.surface.canvas?.querySelector('.jss-media img'); return image?.complete && image.naturalWidth > 0; });
  check('existing local Markdown images still load offline', true);
  await select(8);
  await page.waitForFunction(() => peleLeaf.view.surface.canvas?.querySelector('video')?.readyState >= 1);
  check('local video metadata still loads offline', true);
  check('offline diagram rendering requests no HTTP assets', requests.length === requestCount);
  await context.setOffline(false);
  await page.evaluate(async () => peleLeaf.view.save());
  check('all viewing operations preserve the Markdown source exactly', await readFile(`qa/vault/${note}`, 'utf8') === source);
  check('no Pele integration runtime errors', errors.length === 0);
  await writeFile('qa/pele-results.json', JSON.stringify({ pass: true, checks, errors, requests }, null, 2));
} catch (error) {
  await page.screenshot({ path: 'qa/pele-failure.png' }).catch(() => {});
  await writeFile('qa/pele-results.json', JSON.stringify({ pass: false, checks, errors, error: String(error) }, null, 2));
  throw error;
} finally { await context.setOffline(false).catch(() => {}); await browser.close(); }
