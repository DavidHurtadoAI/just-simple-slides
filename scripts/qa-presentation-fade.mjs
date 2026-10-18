// Optional real-app QA. Only the repository's disposable Obsidian vault is used.
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9234');
const context = browser.contexts()[0], page = context.pages().find(p => p.url().includes('index.html'));
const version = JSON.parse(await readFile('manifest.json', 'utf8')).version;
const checks = [], errors = [], samples = [];
const fixture = Array.from({ length: 6 }, (_, i) => `## Fade slide ${i + 1}\n\n### A simple transition\n\nVisible content ${i + 1}. [A link](https://example.com)\n\n![[slides-demo.svg]]\n\n> [!slide] Notes\n> PRIVATE_FADE_NOTES_${i + 1}\n\n> [!info] Visible callout\n> Still visible.`).join('\n\n---\n\n');
const check = (name, ok) => { assert.ok(ok, name); checks.push(name); console.log('PASS ' + name); };
for (const p of context.pages()) p.on('pageerror', e => errors.push(e.message));
context.on('page', p => p.on('pageerror', e => errors.push(e.message)));
let target = page, popup;
const idle = () => target.waitForFunction(() => {
  const root = document.querySelector('.jss-presentation');
  return root?.querySelectorAll('.jss-slide').length === 1 && root.getAnimations({ subtree: true }).length === 0;
});
const start = async () => { await target.getByRole('button', { name: 'Present from this slide (F5)', exact: true }).click(); await idle(); };
const exit = async () => { await target.keyboard.press('Escape'); await target.locator('.jss-presentation').waitFor({ state: 'detached' }); };
const fade = async (key, title) => {
  await target.keyboard.press(key);
  await target.waitForFunction(title => {
    const root = document.querySelector('.jss-presentation');
    return root?.getAnimations({ subtree: true }).length === 1 && root.lastElementChild && root.querySelector('.jss-slide:not([inert]) .jss-title')?.textContent === title;
  }, title);
};
const sample = () => target.evaluate(() => {
  const root = document.querySelector('.jss-presentation'), slides = [...root.querySelectorAll('.jss-slide')];
  const incoming = slides.find(el => !el.hasAttribute('inert')), outgoing = slides.find(el => el.hasAttribute('inert'));
  const animation = incoming.getAnimations()[0]; animation.pause(); animation.currentTime = 350;
  const result = { duration: animation.effect.getTiming().duration, opacity: Number(getComputedStyle(incoming).opacity),
    previousOpacity: Number(getComputedStyle(outgoing).opacity), hidden: outgoing.getAttribute('aria-hidden'),
    frames: animation.effect.getKeyframes().map(frame => Number(frame.opacity)),
    backgrounds: slides.map(el => getComputedStyle(el).backgroundColor), stageBackground: getComputedStyle(root).backgroundColor,
    titles: slides.map(el => el.querySelector('.jss-title').textContent), privateVisible: root.textContent.includes('PRIVATE_FADE_NOTES'),
    info: incoming.querySelector('.callout[data-callout="info"]')?.textContent.includes('Still visible') };
  globalThis.jssFadeAnimation = animation; return result;
});
try {
  const trust = page.getByRole('button', { name: 'Confiar en el autor y activar complementos', exact: true });
  if (await trust.count()) { await trust.click(); await page.waitForFunction(() => app.plugins.plugins['just-simple-slides']); }
  await page.evaluate(async ({ fixture, version }) => {
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
    let file = app.vault.getAbstractFileByPath('Presentation fade QA.md');
    if (file) await app.vault.modify(file, fixture); else file = await app.vault.create('Presentation fade QA.md', fixture);
    await plugin.open(file); globalThis.jssFadeLeaf = app.workspace.activeLeaf;
    app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse();
  }, { fixture, version });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 1340, height: 920 }); await page.bringToFront();
  await page.mouse.move(5, 5); await page.locator('.notice').waitFor({ state: 'hidden' });
  await start();
  check('the first slide appears immediately without a fade', await page.locator('.jss-presentation .jss-title').innerText() === 'Fade slide 1');
  check('native fullscreen is active', await page.evaluate(() => document.fullscreenElement?.classList.contains('jss-presentation')));
  await target.keyboard.press('Home');
  check('a boundary key does not rerender the current slide', await page.evaluate(() => jssFadeLeaf.view.player.sequence === 1));
  await fade('ArrowRight', 'Fade slide 2');
  const middle = await sample(); samples.push(middle);
  check('Fade has exactly 700 ms duration and opacity keyframes 0 to 1', middle.duration === 700 && JSON.stringify(middle.frames) === '[0,1]');
  check('both slides remain visible halfway through the dissolve', middle.opacity > 0.49 && middle.opacity < 0.51 && middle.previousOpacity === 1);
  check('the outgoing slide is inert and hidden from assistive technology', middle.hidden === 'true');
  check('the dissolve keeps the theme background without an empty frame', middle.backgrounds.every(color => color === middle.stageBackground));
  check('private slide areas stay hidden while ordinary callouts remain visible', !middle.privateVisible && middle.info);
  await page.screenshot({ path: 'qa/presentation-fade-midpoint.png' });
  await page.evaluate(() => jssFadeAnimation.finish()); await idle();
  check('completion removes the outgoing canvas and component', await page.evaluate(() => {
    const s = jssFadeLeaf.view.player.surface; return !s.outgoing && !s.finishTransition && s._children.length === 1;
  }));
  await fade('ArrowLeft', 'Fade slide 1'); await sample();
  check('backward navigation uses the same Fade', await page.locator('.jss-presentation .jss-slide').count() === 2);
  await page.evaluate(() => jssFadeAnimation.play()); await idle();
  check('a running fade completes naturally without a timer fallback', await page.evaluate(() => jssFadeAnimation.playState === 'idle') && await page.locator('.jss-presentation .jss-title').innerText() === 'Fade slide 1');
  await fade('End', 'Fade slide 6'); await sample();
  await page.keyboard.press('End'); await page.keyboard.press('ArrowDown');
  check('repeated boundary keys preserve an ongoing fade', await page.evaluate(() => jssFadeLeaf.view.player.surface.canvas.getAnimations()[0] === jssFadeAnimation));
  await fade('Home', 'Fade slide 1');
  check('a new destination replaces an unfinished fade with at most two visible slides', await page.locator('.jss-presentation .jss-slide:not(.jss-preparing)').count() === 2);
  await page.evaluate(() => {
    const p = jssFadeLeaf.view.player;
    for (let i = 0; i < 30; i++) p.show(i % 6);
    p.show(4);
  });
  await idle();
  check('rapid navigation discards superseded renders and lands on the final request', await page.locator('.jss-presentation .jss-title').innerText() === 'Fade slide 5' && await page.evaluate(() => jssFadeLeaf.view.player.surface._children.length === 1));
  await fade('ArrowRight', 'Fade slide 6'); await sample();
  await page.evaluate(() => {
    const root = document.querySelector('.jss-presentation');
    root.style.width = '880px'; root.style.height = '620px'; jssFadeLeaf.view.player.refit();
  });
  check('both layers stay fitted and aligned during presentation resizing', await page.evaluate(() => {
    const s = jssFadeLeaf.view.player.surface, expected = Math.min(s.viewport.clientWidth / 1600, s.viewport.clientHeight / 900);
    return [s.canvas, s.outgoing].every(el => Math.abs(new DOMMatrix(el.style.transform).a - expected) < 0.00001)
      && s.canvas.style.left === s.outgoing.style.left && s.canvas.style.top === s.outgoing.style.top;
  }));
  await page.getByRole('button', { name: 'Exit presentation (Esc)' }).focus(); await page.keyboard.press('Tab');
  check('the focus trap skips outgoing links', await page.evaluate(() => document.activeElement.closest('.jss-slide') === jssFadeLeaf.view.player.surface.canvas));
  await page.evaluate(() => { globalThis.jssFadeStoppedSurface = jssFadeLeaf.view.player.surface; });
  await exit();
  check('Escape during a fade cancels animations and removes the presentation', await page.evaluate(() => !jssFadeStoppedSurface.finishTransition && !jssFadeStoppedSurface.viewport.isConnected && !document.fullscreenElement));
  check('Escape returns to the selected slide in the editor', await page.evaluate(() => !jssFadeLeaf.view.player && jssFadeLeaf.view.index === 5));
  await page.evaluate(() => jssFadeLeaf.view.select(0));
  await page.waitForFunction(() => jssFadeLeaf.view.surface.canvas?.querySelector('.jss-title')?.textContent === 'Fade slide 1');
  check('editor and thumbnails do not inherit presentation animations', await page.evaluate(() => jssFadeLeaf.view.root.getAnimations({ subtree: true }).filter(a => a.effect.target.closest('.jss-viewport')).length === 0));
  await start();
  await page.evaluate(() => {
    globalThis.jssFadeDelayEnabled = true;
    globalThis.jssFadeRestoreRenderer = () => { globalThis.jssFadeDelayEnabled = false; };
    app.plugins.plugins['just-simple-slides'].registerMarkdownPostProcessor(async el => {
      if (jssFadeDelayEnabled && el.closest('.jss-presentation') && el.textContent.includes('Fade slide 2')) {
        await new Promise(resolve => { globalThis.jssFadeReleaseRender = resolve; });
      }
    });
    jssFadeLeaf.view.player.show(1); jssFadeLeaf.view.player.show(2);
  });
  await page.waitForFunction(() => jssFadeLeaf.view.player.surface.canvas?.querySelector('.jss-title')?.textContent === 'Fade slide 3');
  await page.evaluate(() => jssFadeReleaseRender()); await idle();
  check('a delayed older render cannot replace a newer requested slide', await page.locator('.jss-presentation .jss-title').innerText() === 'Fade slide 3');
  await page.evaluate(() => { jssFadeReleaseRender = null; jssFadeLeaf.view.player.show(1); });
  await page.waitForFunction(() => !!jssFadeReleaseRender);
  await page.evaluate(() => { globalThis.jssFadePendingSurface = jssFadeLeaf.view.player.surface; });
  await exit();
  await page.evaluate(async () => { jssFadeRestoreRenderer(); jssFadeReleaseRender(); await new Promise(resolve => setTimeout(resolve, 50)); });
  check('exiting while Markdown is rendering cannot revive the player or a fade', await page.evaluate(() => !jssFadeLeaf.view.player && !jssFadePendingSurface.viewport.isConnected && !jssFadePendingSurface.finishTransition && !jssFadePendingSurface.viewport.querySelector('.jss-preparing') && !jssFadePendingSurface.viewport.getAnimations({ subtree: true }).length));
  await page.evaluate(() => jssFadeLeaf.view.select(0));
  await page.emulateMedia({ reducedMotion: 'reduce' }); await start(); await page.keyboard.press('ArrowRight'); await idle();
  check('system reduced motion changes slides immediately without an animation', await page.locator('.jss-presentation .jss-title').innerText() === 'Fade slide 2');
  await exit(); await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => { document.body.classList.remove('theme-light'); document.body.classList.add('theme-dark'); app.workspace.trigger('css-change'); });
  await start(); await fade('ArrowRight', 'Fade slide 3'); const dark = await sample(); samples.push(dark);
  check('dark-theme fades use the same 700 ms transition and solid themed layers', dark.duration === 700 && dark.backgrounds.every(color => color === dark.stageBackground));
  await exit();
  await page.evaluate(async () => { app.workspace.moveLeafToPopout(jssFadeLeaf); await app.workspace.revealLeaf(jssFadeLeaf); });
  await page.waitForFunction(() => jssFadeLeaf.view.contentEl.ownerDocument !== document);
  for (const p of context.pages()) if (p !== page && await p.locator('.jss-app').count()) popup = p;
  assert.ok(popup); target = popup; await popup.emulateMedia({ reducedMotion: 'no-preference' });
  await popup.bringToFront(); await popup.evaluate(() => window.focus()); await popup.waitForFunction(() => activeDocument === document);
  await start(); await fade('ArrowRight', 'Fade slide 4'); const floating = await sample(); samples.push(floating);
  check('the same Fade works in a floating presentation window', floating.duration === 700 && floating.opacity > 0 && floating.opacity < 1);
  await exit();
  check('floating Escape cleans up the player and retains notes in the correct document', await page.evaluate(() => {
    const v = jssFadeLeaf.view; return !v.player && v.index === 3 && v.editor.state.doc.toString().includes('PRIVATE_FADE_NOTES_4') && v.editor.dom.ownerDocument === v.contentEl.ownerDocument;
  }));
  await page.evaluate(async () => { await jssFadeLeaf.view.save(); });
  check('presentation leaves the Markdown unchanged byte for byte', await readFile('qa/vault/Presentation fade QA.md', 'utf8') === fixture);
  check('no presentation runtime errors', errors.length === 0);
  await writeFile('qa/presentation-fade-results.json', JSON.stringify({ pass: true, version, checks, samples, errors }, null, 2));
} catch (error) {
  await page.evaluate(() => { globalThis.jssFadeRestoreRenderer?.(); globalThis.jssFadeReleaseRender?.(); });
  await target.screenshot({ path: 'qa/presentation-fade-failure.png' });
  await writeFile('qa/presentation-fade-results.json', JSON.stringify({ pass: false, version, error: String(error), checks, samples, errors }, null, 2));
  throw error;
} finally { await browser.close(); }
