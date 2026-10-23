// Real older-host regression: no Pele dependency or host runtime is required.
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9234');
const context = browser.contexts()[0], page = context.pages().find(p => p.url().includes('index.html'));
const checks = [], errors = [], requests = [];
page.on('pageerror', error => errors.push(error.message));
context.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
const check = (name, value) => { assert.ok(value, name); checks.push(name); console.log('PASS ' + name); };
const note = 'Optional Pele QA.md';
const source = '# Native fallback\n\n![[slides-demo.svg]]\n\n---\n\n# Ordinary Markdown\n\nKeep **bold** text.\n\n```mermaid\nflowchart LR\n A-->B\n```\n\n> [!slide] Notes\n> Private fallback notes\n';
try {
  await context.setOffline(true);
  const version = await page.evaluate(async ({ note, source }) => {
    if (app.vault.adapter.basePath.replaceAll('\\', '/') !== 'C:/Users/dhtor/OneDrive/@Obsidian-dev/Development/just-simple-slides/qa/vault') throw Error('Refusing non-test vault');
    if (window.pele) throw Error('This suite requires an older host without Pele');
    for (const type of ['just-simple-slides', 'markdown']) for (const leaf of app.workspace.getLeavesOfType(type)) {
      await leaf.loadIfDeferred(); if (leaf.view.file) await leaf.view.save(); await leaf.setViewState({ type: 'empty', state: {} });
    }
    const main = app.workspace.getLeavesOfType('empty').find(leaf => leaf.view.contentEl.ownerDocument === document);
    await app.workspace.revealLeaf(main); app.workspace.setActiveLeaf(main, { focus: true });
    for (const leaf of app.workspace.getLeavesOfType('empty')) if (leaf !== main) leaf.detach();
    await app.plugins.disablePlugin('just-simple-slides'); await app.plugins.loadManifests(); await app.plugins.enablePlugin('just-simple-slides');
    let file = app.vault.getAbstractFileByPath(note);
    if (file) await app.vault.modify(file, source); else file = await app.vault.create(note, source);
    await app.plugins.plugins['just-simple-slides'].open(file); globalThis.optionalLeaf = app.workspace.activeLeaf;
    return window.appVersion ?? 'host without Pele';
  }, { note, source });
  check('plugin loads offline on a host without Pele', await page.evaluate(() => !window.pele && !!optionalLeaf.view.surface.canvas));
  check('minimum Obsidian version remains 1.7.2', await page.evaluate(() => app.plugins.manifests['just-simple-slides'].minAppVersion === '1.7.2'));
  await page.waitForFunction(() => { const img = optionalLeaf.view.surface.canvas.querySelector('img'); return img?.complete && img.naturalWidth > 0; });
  check('existing images load without Pele', true);
  await page.evaluate(() => optionalLeaf.view.select(1));
  await page.waitForFunction(() => optionalLeaf.view.surface.canvas?.querySelector('strong')?.textContent === 'bold');
  check('ordinary text retains Markdown formatting', true);
  check('no Pele placeholders or errors appear when the host has no Pele', await page.evaluate(() => !window.pele && !optionalLeaf.view.surface.canvas.querySelector('.jss-diagram-slot, .jss-diagram-error') && optionalLeaf.view.surface.diagrams.length === 0));
  check('notes stay private with native rendering', await page.evaluate(() => !optionalLeaf.view.surface.canvas.textContent.includes('Private fallback notes')));
  check('native Mermaid output or its ordinary source fallback remains available', await page.evaluate(() => !!optionalLeaf.view.surface.canvas.querySelector('svg') || optionalLeaf.view.surface.canvas.textContent.includes('flowchart LR')));
  await page.getByRole('button', { name: 'Present from this slide (F5)', exact: true }).click();
  await page.waitForSelector('.jss-presentation');
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => document.querySelector('.jss-player-counter')?.textContent === '1 / 2');
  check('player keyboard navigation works without Pele', true);
  await page.keyboard.press('Escape'); await page.waitForSelector('.jss-presentation', { state: 'detached' });
  await page.evaluate(() => optionalLeaf.view.save());
  check('fallback viewing preserves the complete Markdown file', await readFile(`qa/vault/${note}`, 'utf8') === source);
  check('fallback loads no HTTP resources', requests.length === 0);
  check('no older-host runtime errors', errors.length === 0);
  await writeFile('qa/pele-optional-results.json', JSON.stringify({ pass: true, version, checks, errors, requests }, null, 2));
} catch (error) {
  await writeFile('qa/pele-optional-results.json', JSON.stringify({ pass: false, checks, errors, error: String(error) }, null, 2));
  throw error;
} finally { await context.setOffline(false).catch(() => {}); await browser.close(); }
