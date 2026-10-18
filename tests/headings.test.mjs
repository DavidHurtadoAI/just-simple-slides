import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHeadings, slideHeadings } from '../src/headings.ts';
import { addSlide, deleteSlide, moveSlideTo, parseDeck } from '../src/deck.ts';
import { TITLE_MARKER } from '../src/presentation-title.ts';

test('one separate H1 leaves every slide title H2 and subtitle H3', () => {
  const source = '# First\n\n## Subtitle\n\nText.\n\n---\n\n###### Second\n\n# Another subtitle\n';
  const result = normalizeHeadings(source, 'My presentation');
  const deck = parseDeck(result);
  assert.equal(deck.presentation.title, 'My presentation');
  assert.equal(deck.slides.length, 2);
  assert.deepEqual(deck.slides.map(s => slideHeadings(s.markdown).map(h => h.level)), [[2, 3], [2, 3]]);
  assert.ok(result.startsWith(TITLE_MARKER + '\n# My presentation\n\n'));
  assert.ok(result.includes('Text.\n\n---\n\n'));
});

test('unmarked H1-only cover slides retain their existing meaning and count', () => {
  const source = '# Existing cover\n---\n# Content';
  assert.equal(parseDeck(source).slides.length, 2);
  const result = normalizeHeadings(source, 'Separate title');
  assert.equal(parseDeck(result).slides.length, 2);
  assert.deepEqual(parseDeck(result).slides.map(s => s.title), ['Existing cover', 'Content']);
});

test('repeated normalization is byte-for-byte idempotent and renaming replaces only the H1', () => {
  const result = normalizeHeadings('### First\n\n# Sub\n---\n## Second', 'One');
  assert.equal(normalizeHeadings(result, 'One'), result);
  assert.equal(normalizeHeadings(result, 'Two'), result.replace('# One\n', '# Two\n'));
  assert.equal(result.split(TITLE_MARKER).length, 2);
  const spaced = result.replace(TITLE_MARKER + '\n', TITLE_MARKER + '\n\n');
  assert.equal(parseDeck(spaced).presentation.title, 'One');
  assert.equal(normalizeHeadings(spaced, 'One'), spaced);
});

test('frontmatter, BOM, CRLF, separator formatting and missing final newline are preserved', () => {
  for (const e of ['\n', '\r\n', '\r']) {
    const prefix = '\uFEFF' + ['---', 'title: Keep original YAML', 'tags: [slides]', '---', ''].join(e);
    const source = prefix + ['### A', '', '###### Sub', ' ---  ', '##### B'].join(e);
    const result = normalizeHeadings(source, 'Deck');
    assert.ok(result.startsWith(prefix));
    assert.ok(result.includes(e + ' ---  ' + e));
    assert.ok(result.endsWith('## B'));
    const deck = parseDeck(result);
    assert.equal(deck.eol, e);
    assert.equal(deck.slides.length, 2);
    assert.equal(normalizeHeadings(result, 'Deck'), result);
    assert.equal(result.replaceAll(e, '').includes('\n'), false);
  }
  assert.equal(parseDeck(normalizeHeadings('---\ntags: []\n---', 'Deck')).slides.length, 1);
  assert.equal(parseDeck(normalizeHeadings('\uFEFF# A', 'Deck')).slides[0].title, 'A');
});

test('private areas, ordinary callouts, fenced/indented code, lists and HTML are not rewritten', () => {
  const protectedSource = '> [!slide] Notes\n> # Private H1\n> ## Private H2\n\n> [!tip] Visible\n> # Quoted heading\n\n```md\n# Example\n## Another\n```\n\n    # Indented example\n\n- Item\n  # Nested heading\n\n<div>\n# HTML content\n</div>\n\n<!--\n# Hidden example\n-->\n\n';
  const source = protectedSource + '###### Real title\n\n# Real subtitle';
  const result = normalizeHeadings(source, 'Deck');
  assert.ok(result.includes(protectedSource));
  assert.deepEqual(slideHeadings(parseDeck(result).slides[0].markdown).map(h => h.level), [2, 3]);
  assert.deepEqual(parseDeck(result).slides[0].areas.map(a => a.content), parseDeck(source).slides[0].areas.map(a => a.content));
});

test('Obsidian comments and display math protect headings without masking later content', () => {
  const hidden = '%%\n# Comment\n$$\n%%\n\n$$\n# Math\n%% LaTeX comment\n$$\n\n';
  const source = hidden + '# Visible %% Inline comment %%\n\n###### Subtitle';
  const result = normalizeHeadings(source, 'Deck');
  assert.ok(result.includes(hidden));
  assert.ok(result.includes('## Visible %% Inline comment %%\n\n### Subtitle'));
  assert.equal(slideHeadings('`%%`\n\n# Visible').length, 1);
  assert.equal(slideHeadings('%%\n# Hidden').length, 0);
});

test('body headings retain relative depth below titles and subtitles', () => {
  const result = normalizeHeadings('###### A\n\n# Sub\n\n## Body\n\n### Nested\n\n#### Deeper\n\n###### Deepest', 'Deck');
  assert.deepEqual(slideHeadings(parseDeck(result).slides[0].markdown).map(h => h.level), [2, 3, 4, 5, 6, 6]);
  assert.equal(normalizeHeadings(result, 'Deck'), result);
});

test('Setext headings become ATX headings without changing the number of slides', () => {
  const source = 'First\n=====\n\nLong\nsubtitle\n-----\n\n---\n\nSecond\n==\n';
  const result = normalizeHeadings(source, 'Deck');
  assert.ok(result.includes('## First\n\n### Long subtitle\n\n---\n\n## Second\n'));
  assert.equal(parseDeck(result).slides.length, 2);
  assert.ok(normalizeHeadings('Line  \nbreak\n=====', 'Deck').endsWith('## Line<br>break'));
});

test('ATX spacing, closing markers, inline formatting and Unicode remain intact', () => {
  const result = normalizeHeadings('  ####\t**日本語** and `C#` ###\n\n######\tSub ###', '世界');
  assert.ok(result.includes('  ##\t**日本語** and `C#` ###\n\n###\tSub ###'));
  assert.equal(parseDeck(result).presentation.title, '世界');
});

test('image-only, empty and titleless slides get no invented titles or new slide boundaries', () => {
  for (const source of ['', '![[image.png]]', 'Plain text\n\n---\n\n![[image.png]]\n---\n']) {
    const result = normalizeHeadings(source, 'Deck');
    assert.equal(parseDeck(result).slides.length, parseDeck(source).slides.length);
    assert.equal(slideHeadings(parseDeck(result).slides[0].markdown).length, 0);
    assert.equal(normalizeHeadings(result, 'Deck'), result);
  }
});

test('all slide operations retain the independent title prefix', () => {
  let source = normalizeHeadings('# A\n---\n# B\n---\n# C', 'Independent');
  const title = source.slice(0, parseDeck(source).prefixEnd);
  for (const operation of [
    (s, d) => moveSlideTo(s, d, 0, 2), (s, d) => addSlide(s, d, 0),
    (s, d) => addSlide(s, d, 1, true), (s, d) => deleteSlide(s, d, 0),
  ]) {
    source = operation(source, parseDeck(source)).source;
    assert.ok(source.startsWith(title));
    assert.equal(parseDeck(source).presentation.title, 'Independent');
  }
  const one = normalizeHeadings('# Only', 'Independent');
  assert.equal(parseDeck(deleteSlide(one, parseDeck(one), 0).source).presentation.title, 'Independent');
});

test('empty/multiline title input is rejected without mutating the document', () => {
  for (const title of ['', '  ', 'One\nTwo', 'One\rTwo']) assert.throws(() => normalizeHeadings('# A', title));
});
