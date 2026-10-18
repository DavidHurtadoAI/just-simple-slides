// Optional real-app QA, restricted to this repository's disposable vault.
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9234');
const context = browser.contexts()[0], page = context.pages().find(p => p.url().includes('index.html'));
const version = JSON.parse(await readFile('manifest.json', 'utf8')).version;
const fixture = Array.from({ length: 8 }, (_, i) => `## Progress slide ${i + 1}\n\nOne simple idea.\n\n> [!slide] Notes\n> PRIVATE_PROGRESS_${i + 1}`).join('\n\n---\n\n');
const checks = [], errors = [];
const check = (name, ok) => { assert.ok(ok, name); checks.push(name); console.log('PASS ' + name); };
for (const p of context.pages()) p.on('pageerror', e => errors.push(e.message));
context.on('page', p => p.on('pageerror', e => errors.push(e.message)));
let target = page, popup;
const state = () => target.evaluate(() => {
  const root = document.querySelector('.jss-presentation'), bar = root.querySelector('.jss-player-progress'), fill = bar.firstElementChild;
  const b = bar.getBoundingClientRect(), r = root.getBoundingClientRect(), css = getComputedStyle(bar);
  return { now: Number(bar.getAttribute('aria-valuenow')), max: Number(bar.getAttribute('aria-valuemax')),
    text: bar.getAttribute('aria-valuetext'), ratio: new DOMMatrix(getComputedStyle(fill).transform).a,
    width: b.width, height: b.height, bottomError: Math.abs(b.bottom - r.bottom), fullWidth: r.width,
    opacity: Number(css.opacity), pointerEvents: css.pointerEvents, transition: getComputedStyle(fill).transitionDuration,
    fillColor: getComputedStyle(fill).backgroundColor, animations: fill.getAnimations().length };
});
const settled = () => target.waitForFunction(() => {
  const root = document.querySelector('.jss-presentation');
  return root?.querySelectorAll('.jss-slide').length === 1 && root.getAnimations({ subtree: true }).length === 0;
});
const start = async () => { await target.getByRole('button', { name: 'Present from this slide (F5)', exact: true }).click(); await settled(); };
const exit = async () => { await target.keyboard.press('Escape'); await target.locator('.jss-presentation').waitFor({ state: 'detached' }); };
const press = async key => { await target.keyboard.press(key); await settled(); return state(); };
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
    if (app.plugins.plugins['just-simple-slides']) await app.plugins.disablePlugin('just-simple-slides');
    await app.plugins.loadManifests(); await app.plugins.enablePlugin('just-simple-slides');
    const plugin = app.plugins.plugins['just-simple-slides']; if (plugin.manifest.version !== version) throw Error('Wrong loaded version');
    let file = app.vault.getAbstractFileByPath('Presentation progress QA.md');
    if (file) await app.vault.modify(file, fixture); else file = await app.vault.create('Presentation progress QA.md', fixture);
    await plugin.open(file); globalThis.jssProgressLeaf = app.workspace.activeLeaf;
    app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse();
    document.body.classList.remove('theme-dark'); document.body.classList.add('theme-light'); app.workspace.trigger('css-change');
  }, { fixture, version });
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.setViewportSize({ width: 1340, height: 920 });
  await page.bringToFront(); await page.mouse.move(5, 5); await page.locator('.notice').waitFor({ state: 'hidden' });
  check('progress is absent from the editor and thumbnail previews', await page.locator('.jss-player-progress').count() === 0);
  await start(); const first = await state();
  check('the first slide shows one eighth of an eight-slide deck', first.now === 1 && first.max === 8 && first.ratio === 0.125);
  check('the bar is 2px high and spans the bottom edge', first.height === 2 && Math.abs(first.width - first.fullWidth) < 1 && first.bottomError < 1);
  check('progress stays subtle with low opacity and smooth 700 ms motion', first.opacity === 0.45 && first.transition === '0.7s');
  check('screen readers receive a named progressbar and current slide text', await target.getByRole('progressbar', { name: 'Presentation progress' }).count() === 1 && first.text === 'Slide 1 of 8');
  check('the bar cannot capture clicks or keyboard focus', first.pointerEvents === 'none' && await page.locator('.jss-player-progress').evaluate(el => !el.hasAttribute('tabindex') && !document.elementFromPoint(20, innerHeight - 1)?.closest('.jss-player-progress')));
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('.jss-player-progress-fill').getAnimations().length === 1);
  const midpoint = await page.evaluate(() => {
    const fill = document.querySelector('.jss-player-progress-fill'), a = fill.getAnimations()[0];
    a.pause(); a.currentTime = 350;
    const result = { duration: a.effect.getTiming().duration, ratio: new DOMMatrix(getComputedStyle(fill).transform).a };
    a.finish(); return result;
  });
  check('the fill visibly advances between positions instead of jumping', midpoint.duration === 700 && Math.abs(midpoint.ratio - 0.1875) < 0.001);
  await settled(); check('next-slide navigation reaches the correct position', (await state()).ratio === 0.25 && (await state()).now === 2);
  check('previous-slide navigation moves the bar back', (await press('ArrowLeft')).ratio === 0.125);
  check('End fills the bar completely on the last slide', (await press('End')).ratio === 1 && (await state()).now === 8);
  check('advancing beyond the last slide keeps progress at 100%', (await press('ArrowDown')).ratio === 1);
  check('Home returns the fill to the first slide position', (await press('Home')).ratio === 0.125);
  await page.getByRole('button', { name: 'Next slide', exact: true }).click(); await settled();
  check('existing navigation buttons update progress normally', (await state()).ratio === 0.25);
  await page.evaluate(() => { for (let i = 0; i < 25; i++) jssProgressLeaf.view.player.show(i % 8); jssProgressLeaf.view.player.show(3); });
  await settled(); check('rapid navigation settles at the latest slide position', (await state()).now === 4 && (await state()).ratio === 0.5);
  await page.locator('.jss-presentation').focus(); await page.mouse.move(5, 5);
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.jss-player-controls')).opacity) < 0.5);
  check('progress remains visible when navigation controls are dimmed', await page.evaluate(() => Number(getComputedStyle(document.querySelector('.jss-player-controls')).opacity) < 0.5 && getComputedStyle(document.querySelector('.jss-player-progress')).opacity === '0.45'));
  await page.screenshot({ path: 'qa/presentation-progress-light.png' });
  const fit = await page.evaluate(() => {
    const bar = document.querySelector('.jss-player-progress'), stage = document.querySelector('.jss-player-stage');
    const before = stage.getBoundingClientRect().height; bar.style.display = 'none'; const after = stage.getBoundingClientRect().height; bar.style.removeProperty('display');
    return before === after;
  });
  check('the bar consumes no slide or control space', fit);
  await exit(); await page.evaluate(() => jssProgressLeaf.view.select(5)); await start();
  check('starting presentation midway begins at the selected slide position', (await state()).now === 6 && (await state()).ratio === 0.75);
  await exit(); await page.emulateMedia({ reducedMotion: 'reduce' }); await start();
  await page.keyboard.press('ArrowLeft');
  check('reduced motion updates progress without a transition', (await state()).ratio === 0.625 && (await state()).transition === '0s' && (await state()).animations === 0);
  await exit(); await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => { document.body.classList.remove('theme-light'); document.body.classList.add('theme-dark'); document.body.style.setProperty('--interactive-accent', 'rgb(120, 150, 190)'); app.workspace.trigger('css-change'); });
  await start();
  check('the subtle bar inherits the current theme accent in dark mode', (await state()).fillColor === 'rgb(120, 150, 190)' && (await state()).opacity === 0.45);
  await page.screenshot({ path: 'qa/presentation-progress-dark.png' });
  await exit(); await page.evaluate(() => document.body.style.removeProperty('--interactive-accent'));
  for (const [name, content] of [['Single slide progress QA.md', '## Only slide'], ['Empty slide progress QA.md', '']]) {
    await page.evaluate(async ({ name, content }) => {
      const file = app.vault.getAbstractFileByPath(name) ?? await app.vault.create(name, content);
      await app.plugins.plugins['just-simple-slides'].open(file);
    }, { name, content });
    await start(); check(name + ' has finite full progress', (await state()).now === 1 && (await state()).max === 1 && (await state()).ratio === 1); await exit();
  }
  await page.evaluate(async () => { await app.workspace.revealLeaf(jssProgressLeaf); app.workspace.moveLeafToPopout(jssProgressLeaf); await app.workspace.revealLeaf(jssProgressLeaf); });
  await page.waitForFunction(() => jssProgressLeaf.view.contentEl.ownerDocument !== document);
  for (const p of context.pages()) if (p !== page && await p.locator('.jss-app').count()) popup = p;
  assert.ok(popup); target = popup; await popup.emulateMedia({ reducedMotion: 'no-preference' });
  await popup.bringToFront(); await popup.evaluate(() => window.focus()); await popup.waitForFunction(() => activeDocument === document);
  await start(); check('floating presentations start at the correct progress', (await state()).now === 5 && (await state()).ratio === 0.625);
  await popup.keyboard.press('ArrowRight'); await settled(); check('floating navigation advances progress', (await state()).now === 6 && (await state()).ratio === 0.75);
  await popup.setViewportSize({ width: 480, height: 650 });
  check('the bar stays aligned in a narrow floating window', (await state()).height === 2 && (await state()).bottomError < 1 && Math.abs((await state()).width - (await state()).fullWidth) < 1);
  await exit(); check('Escape removes the progress bar and restores the selected slide', await popup.locator('.jss-player-progress').count() === 0 && await page.evaluate(() => jssProgressLeaf.view.index === 5 && !jssProgressLeaf.view.player));
  await page.evaluate(async () => { await jssProgressLeaf.view.save(); });
  check('progress leaves the source Markdown unchanged byte for byte', await readFile('qa/vault/Presentation progress QA.md', 'utf8') === fixture);
  check('no presentation progress runtime errors', errors.length === 0);
  await writeFile('qa/presentation-progress-results.json', JSON.stringify({ pass: true, version, checks, errors }, null, 2));
} catch (error) {
  await target.screenshot({ path: 'qa/presentation-progress-failure.png' });
  await writeFile('qa/presentation-progress-results.json', JSON.stringify({ pass: false, version, error: String(error), checks, errors }, null, 2));
  throw error;
} finally { await browser.close(); }
