import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parser } from '@lezer/markdown';
import { prepareDiagrams } from '../src/markdown-blocks.ts';
import { parseDeck, moveSlideTo } from '../src/deck.ts';
import { normalizeHeadings } from '../src/headings.ts';
import { renderDiagram, diagramError, contrastRatio, seriesColor, readPele, optionalPele } from '../src/diagram-renderer.ts';

const metrics = { width: 1400, fontFamily: 'Arial', fontFamilyMono: 'Courier New', idPrefix: 'test-a' };
const flow = 'flowchart LR\n A[Draft] --> B[Review] --> C[Ready]';
const fence = source => '```mermaid\n' + source + '\n```';
class HostPeleError extends Error { line = 2; column = 4; }
const hostEngine = (render = () => ({ svg: '<svg/>', width: 100, height: 80, type: 'flowchart' })) => ({ render, parse() {}, supports() {}, PeleError: HostPeleError });

test('source extraction precedes the native processor, preserves outside bytes and internal YAML', () => {
  for (const eol of ['\n', '\r\n', '\r']) {
    const code = ['---', 'title: Diagram title', 'config:', '  theme: dark', '---', flow].join('\n').replaceAll('\n', eol);
    const source = '# Title' + eol + eol + '```mermaid' + eol + code + eol + '```' + eol + eol + '![[existing.svg]]';
    const prepared = prepareDiagrams(source, 'slide-a');
    assert.equal(prepared.diagrams.length, 1);
    assert.equal(prepared.diagrams[0].source, code);
    assert.equal(prepared.markdown, '# Title' + eol + eol + '<div class="jss-diagram-slot" data-jss-diagram="slide-a-0"></div>' + eol + eol + eol + '![[existing.svg]]');
    assert.equal(parseDeck(source).slides.length, 1);
    assert.equal(parseDeck(source + eol + eol + '---' + eol + eol + '# Next').slides.length, 2);
  }
});

test('literal fences, inline/indented code, HTML and Obsidian comments remain literal', () => {
  for (const source of [
    '````markdown\n' + fence(flow) + '\n````',
    '~~~markdown\n' + fence(flow) + '\n~~~',
    '    ```mermaid\n    flowchart LR\n    A-->B\n    ```',
    '` ```mermaid `', '<!--\n' + fence(flow) + '\n-->',
    'text <!--\n' + fence(flow) + '\n-->',
    '%% Private example\n' + fence(flow) + '\n%%',
    '<pre>\n' + fence(flow) + '\n</pre>',
  ]) {
    const result = prepareDiagrams(source, 'literal');
    assert.equal(result.markdown, source, source); assert.equal(result.diagrams.length, 0, source);
  }
});

test('genuine fences after comments are extracted; Mermaid comments are not Markdown comments', () => {
  const source = '<!--\nnot a diagram\n-->\n\n' + fence('%%{init: {"theme": "base"}}%%\n' + flow + '\n%% A comment');
  const result = prepareDiagrams(source, 'comments');
  assert.equal(result.diagrams.length, 1); assert.match(result.diagrams[0].source, /^%%\{init/);
  assert.match(result.diagrams[0].source, /%% A comment$/);
});

test('tilde fences and case-insensitive Mermaid info work; longer literal fences do not nest', () => {
  const source = '~~~MERMAID\n' + flow + '\n~~~\n\n' + fence('sequenceDiagram\n A->>B: Hello');
  assert.equal(prepareDiagrams(source, 'multiple').diagrams.length, 2);
  assert.equal(prepareDiagrams('````mermaid\n' + flow + '\n```\n````', 'long').diagrams[0].source, flow + '\n```');
});

test('quote and list prefixes are removed from diagram source without changing enclosing Markdown', () => {
  for (const [prefix, continuation] of [['> ', '> '], ['- ', '  ']]) {
    const source = prefix + '```mermaid\n' + continuation + 'flowchart LR\n' + continuation + ' A-->B\n' + continuation + '```';
    const result = prepareDiagrams(source, 'nested');
    assert.equal(result.diagrams[0].source, 'flowchart LR\n A-->B');
    assert.equal(result.markdown, prefix + '<div class="jss-diagram-slot" data-jss-diagram="nested-0"></div>\n' + continuation);
  }
});

test('Markdown immediately after a fence keeps formatting and its quote/list container', () => {
  for (const [prefix, continuation] of [['', ''], ['> ', '> '], ['- ', '  '], ['> 1. ', '>    ']]) {
    const source = prefix + '```mermaid\n' + continuation + flow.replaceAll('\n', '\n' + continuation) + '\n' + continuation + '```\n' + continuation + 'After **bold**';
    const prepared = prepareDiagrams(source, 'adjacent');
    assert.ok(prepared.markdown.endsWith('</div>\n' + continuation + '\n' + continuation + 'After **bold**'));
    if (!prefix.includes('>')) {
      const tree = parser.parse(prepared.markdown);
      assert.match(tree.toString(), /StrongEmphasis/);
      const html = []; tree.iterate({ enter(node) { if (node.name === 'HTMLBlock') html.push(prepared.markdown.slice(node.from, node.to)); } });
      assert.equal(html.length, 1); assert.ok(!html[0].includes('After'));
    }
  }
});

test('diagram frontmatter, longer fences and invalid closing fences cannot create slides', () => {
  for (const code of [fence('---\ntitle: Keep\n---\n' + flow), '````mermaid\n' + flow + '\n```\n---\n````', '```mermaid\n' + flow + '\n```not-a-close\n---\n```']) {
    const source = '# First\n\n' + code + '\n\n---\n\n# Last\n';
    assert.equal(parseDeck(source).slides.length, 2, code);
    const moved = moveSlideTo(source, parseDeck(source), 0, 1);
    assert.equal(parseDeck(moved.source).slides.length, 2);
    assert.ok(moved.source.includes(code));
    assert.ok(normalizeHeadings(source, 'Deck').includes(code));
  }
  const literal = parseDeck('```mermaid\nflowchart LR\n```not-a-close\n# Literal code\n---\n```');
  assert.equal(literal.slides.length, 1); assert.equal(literal.slides[0].title, 'Slide 1');
});

test('the adapter passes logical size, fonts and measurement to the supplied host engine', () => {
  const measurer = { width: (text, size) => text.length * size / 2 };
  const engine = hostEngine((source, options) => {
    assert.equal(source, flow); assert.equal(options.fontFamily, metrics.fontFamily);
    assert.equal(options.fontFamilyMono, metrics.fontFamilyMono); assert.equal(options.maxWidth, metrics.width);
    assert.equal(options.measurer, measurer); assert.equal(options.fontSize, 32);
    assert.equal(options.idPrefix, 'test-a'); assert.equal(options.autoDirection, false);
    assert.equal(options.responsive, false); assert.equal(options.links, false); assert.equal(options.images, false);
    return { svg: '<svg/>', width: 1400, height: 400, type: 'flowchart' };
  });
  assert.equal(renderDiagram(engine, flow, { ...metrics, measurer }).width, 1400);
});

test('host detection requires Pele capabilities without a version gate', () => {
  const engine = hostEngine(); assert.equal(readPele(engine), engine);
  for (const missing of [null, undefined, {}, { render() {} }, { ...engine, parse: null }]) assert.equal(readPele(missing), null);
});

test('optional loading handles native availability, absence, changed APIs and failed loads', async () => {
  const engine = hostEngine(); let loaded = false;
  assert.equal(await optionalPele(async () => { loaded = true; }, () => { assert.ok(loaded); return engine; }), engine);
  assert.equal(await optionalPele(async () => {}, () => undefined), null);
  assert.equal(await optionalPele(async () => {}, () => ({ render() {} })), null);
  assert.equal(await optionalPele(async () => { throw Error('Unavailable'); }, () => engine), null);
  assert.equal(await optionalPele(() => { throw Error('Older host'); }, () => engine), null);
  assert.equal(await optionalPele(async () => {}, () => { throw Error('Removed global'); }), null);
});

test('a private-area Mermaid block stays inside its callout marker and cannot split the deck', () => {
  const notes = '> [!slide] Notes\n> ```mermaid\n> ---\n> title: Private\n> ---\n> flowchart LR\n>  Private-->Hidden\n> ```\n';
  const source = '# Public\n\n' + notes + '\n---\n\n# Next';
  assert.equal(parseDeck(source).slides.length, 2);
  const prepared = prepareDiagrams(source, 'private');
  assert.ok(prepared.markdown.includes('> [!slide] Notes\n> <div class="jss-diagram-slot"'));
  assert.match(prepared.diagrams[0].source, /title: Private/);
});

test('incompatible native results are rejected rather than inserted as valid diagrams', () => {
  for (const result of [undefined, {}, { svg: '<svg/>', type: 'flowchart', width: NaN, height: 50 }, { svg: '<svg/>', type: 'flowchart', width: 50, height: 0 }]) {
    assert.throws(() => renderDiagram(hostEngine(() => result), flow, metrics), /Unsupported diagram result/);
  }
});

test('invalid syntax produces a positioned, text-only error instead of a result', () => {
  let error;
  const engine = hostEngine(() => { throw new HostPeleError('Incomplete edge'); });
  try { renderDiagram(engine, 'flowchart LR\n A -->', metrics); } catch (caught) { error = caught; }
  assert.ok(error); assert.match(diagramError(error, engine), /Could not render Mermaid diagram/);
  assert.match(diagramError(error, engine), /line 2, column 4/);
  assert.match(diagramError(Error('private internals'), engine), /Check its syntax/);
});

test('series text has at least 4.5:1 contrast against theme backgrounds', () => {
  for (const [background, foreground] of [['#ffffff', '#222222'], ['#202020', '#dddddd'], ['rgb(245, 242, 230)', '#100f0f']]) {
    for (const color of ['#eeee00', '#4c78a8', '#54a24b', '#e45756', '#202020', '#ffffff']) {
      assert.ok(contrastRatio(seriesColor(color, background, foreground), background) >= 4.5, `${color} on ${background}`);
    }
  }
});

test('Pele is not a dependency and the plugin retains its existing minimum Obsidian version', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url)));
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url)));
  assert.equal(pkg.devDependencies.pele, undefined); assert.equal(pkg.dependencies?.pele, undefined);
  assert.equal(lock.packages['node_modules/pele'], undefined); assert.equal(manifest.minAppVersion, '1.7.2');
});
