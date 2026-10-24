import test from 'node:test';
import assert from 'node:assert/strict';
import { changeHeading, headingValue, headingSlots, prepareSlideHeadings, EMPTY_HEADING } from '../src/slide-headings.ts';
import { parseDeck, replaceSlide, moveSlideTo, addSlide, DeckHistory } from '../src/deck.ts';
import { normalizeHeadings } from '../src/headings.ts';

test('a title edit preserves ATX markers, spacing, inline Markdown and every other source byte', () => {
  for (const eol of ['\n', '\r\n', '\r']) {
    const source = ['---', 'tags: [slides]', '---', '', '  ####\t**Old** ###', '', '###### Subtitle', '', '![[image.svg]]', '', '> [!slide] Notes', '> Private', '', '---', '', '# Next'].join(eol);
    const deck = parseDeck(source), slide = deck.slides[0];
    const markdown = changeHeading(slide.markdown, 'title', '**日本語** and `C#`');
    const result = replaceSlide(source, slide, markdown);
    assert.equal(result, source.replace('**Old**', '**日本語** and `C#`'));
    assert.equal(parseDeck(result).slides.length, 2);
  }
});

test('subtitle editing changes only the second heading, leaving later body headings intact', () => {
  const source = '## Title\n\n### Old subtitle\n\nText.\n\n#### Body\n\n# Later';
  assert.equal(changeHeading(source, 'subtitle', 'New **subtitle**'), source.replace('Old subtitle', 'New **subtitle**'));
});

test('unchanged values, cancellation equivalents and absent empty values do not rewrite source', () => {
  for (const source of ['## Title ###\r\n\r\n### Sub\r\n', 'Line  \nbreak\n=====\n', '![[image.svg]]', '']) {
    for (const role of ['title', 'subtitle']) assert.equal(changeHeading(source, role, headingValue(source, role)), source);
  }
});

test('removing a title preserves subtitle position, size role and body headings', () => {
  const source = '## Title\n\n### Subtitle\n\n#### Body\n\nContent.';
  const result = changeHeading(source, 'title', '');
  assert.equal(result, source.replace('## Title', EMPTY_HEADING));
  assert.equal(headingSlots(result)[0].heading, null);
  assert.equal(headingValue(result, 'subtitle'), 'Subtitle');
  assert.equal(parseDeck(result).slides[0].title, 'Slide 1');
  assert.equal(changeHeading(result, 'title', ''), result);
});

test('removing a subtitle and then both headings never promotes body content', () => {
  const source = '## Title\n\n### Subtitle\n\n#### Body\n\n## Another body heading';
  const sub = changeHeading(source, 'subtitle', '');
  assert.equal(headingValue(sub, 'title'), 'Title'); assert.equal(headingSlots(sub)[1].heading, null);
  const both = changeHeading(sub, 'title', '');
  assert.ok(headingSlots(both).every(slot => slot.heading === null));
  assert.ok(both.endsWith('#### Body\n\n## Another body heading'));
  assert.equal(prepareSlideHeadings(both, 'preview').includes('data-jss-header'), false);
});

test('new headers use H2/H3 and preserve the original titleless body verbatim', () => {
  for (const eol of ['\n', '\r\n', '\r']) for (const example of ['', '![[image.svg]]\n\nText.', '\n\nText.\n']) {
    const body = example.replaceAll('\n', eol);
    const title = changeHeading(body, 'title', 'New title');
    const expectedEol = body.match(/\r\n|\n|\r/)?.[0] ?? '\n';
    assert.equal(title, '## New title' + expectedEol + expectedEol + body);
    const both = changeHeading(title, 'subtitle', 'New subtitle');
    assert.equal(headingValue(both, 'subtitle'), 'New subtitle');
    assert.ok(both.endsWith(body));
  }
});

test('a subtitle can exist without a title and either removed heading can be restored independently', () => {
  const body = '![[image.svg]]\n';
  const sub = changeHeading(body, 'subtitle', 'Only subtitle');
  assert.equal(headingSlots(sub)[0].heading, null); assert.equal(headingValue(sub, 'subtitle'), 'Only subtitle');
  const both = changeHeading(sub, 'title', 'Restored');
  assert.ok(both.startsWith('## Restored\n\n### Only subtitle'));
  assert.ok(both.endsWith(body));
  assert.equal(headingValue(changeHeading(changeHeading(both, 'subtitle', ''), 'subtitle', 'Again'), 'title'), 'Restored');
});

test('Setext edits retain the underline, newline convention and untouched surrounding content', () => {
  for (const eol of ['\n', '\r\n', '\r']) {
    const source = ['Long', 'title', '=====', '', 'Subtitle', '====', '', 'Body.'].join(eol);
    assert.equal(changeHeading(source, 'title', 'New title'), ['New title', '=====', '', 'Subtitle', '====', '', 'Body.'].join(eol));
    assert.equal(changeHeading(source, 'subtitle', 'New subtitle'), source.replace('Subtitle', 'New subtitle'));
  }
});

test('empty ATX headings and missing final newlines can be edited without invalid Markdown', () => {
  assert.equal(changeHeading('##', 'title', ''), EMPTY_HEADING);
  assert.equal(changeHeading('##', 'title', 'Text'), '## Text');
  assert.equal(changeHeading('## ###', 'title', 'Text'), '## Text ###');
  assert.equal(changeHeading('## Title\n### Sub', 'subtitle', 'Changed'), '## Title\n### Changed');
});

test('code, notes, quotes, lists, HTML, math and comments do not become editable headers', () => {
  const prefix = '> [!slide] Notes\n> ## Private\n\n- List\n  ### Nested\n\n```mermaid\n---\ntitle: Internal\n---\nflowchart LR\n A-->B\n```\n\n<div>\n## HTML\n</div>\n\n%%\n## Hidden\n%%\n\n$$\n## Math\n$$\n\n';
  const source = prefix + '## Public\n\n### Subtitle';
  assert.equal(changeHeading(source, 'title', 'Changed'), prefix + '## Changed\n\n### Subtitle');
  const prepared = prepareSlideHeadings(source, 'source');
  assert.ok(prepared.startsWith(prefix));
  assert.equal((prepared.match(/data-jss-header=/g) ?? []).length, 2);
});

test('literal placeholder examples never reserve a header slot', () => {
  for (const prefix of ['```md\n' + EMPTY_HEADING + '\n```\n\n', '> ' + EMPTY_HEADING + '\n\n', '%%\n' + EMPTY_HEADING + '\n%%\n\n', '<div>\n' + EMPTY_HEADING + '\n</div>\n\n']) {
    assert.equal(headingValue(prefix + '## Real', 'title'), 'Real');
  }
});

test('normalizing headings respects independently empty header slots', () => {
  const source = changeHeading('## Title\n\n### Subtitle\n\n# Body', 'title', '');
  const result = parseDeck(normalizeHeadings(source, 'Deck')).slides[0].markdown;
  assert.equal(headingSlots(result)[0].heading, null);
  assert.equal(headingSlots(result)[1].heading.level, 3);
  assert.ok(result.includes('#### Body'));
});

test('duplicate and reorder preserve empty roles, media and private notes', () => {
  const markdown = changeHeading('## Title\n\n### Subtitle\n\n![[image.svg]]\n\n> [!slide] Notes\n> Keep', 'title', '');
  const source = markdown + '\n\n---\n\n## Next';
  const moved = moveSlideTo(source, parseDeck(source), 0, 1).source;
  assert.ok(parseDeck(moved).slides[1].markdown.includes(markdown));
  const duplicate = addSlide(source, parseDeck(source), 0, true).source;
  assert.equal(headingSlots(parseDeck(duplicate).slides[1].markdown)[0].heading, null);
  assert.ok(parseDeck(duplicate).slides[1].markdown.includes('> Keep'));
});

test('multiline input is rejected and preview markers cannot be injected through their token', () => {
  for (const value of ['One\nTwo', 'One\rTwo', '\n---\n']) assert.throws(() => changeHeading('## Title', 'title', value), /single-line/);
  assert.throws(() => prepareSlideHeadings('## Title', '" onclick="bad'), /Invalid heading marker/);
  assert.equal(prepareSlideHeadings('## **Title**\n\n### Sub\n\n#### Body', 'own'), '## <span data-jss-header="own-0"></span>**Title**\n\n### <span data-jss-header="own-1"></span>Sub\n\n#### Body');
});

test('one header operation has one reversible document history entry', () => {
  const source = '## Title\n\n### Subtitle\n\nBody';
  const history = new DeckHistory(), before = { source, index: 0, anchor: 0, head: 0 };
  history.record(before);
  const after = { ...before, source: changeHeading(source, 'title', '') };
  assert.equal(history.undo(after).source, source);
  assert.equal(history.redo(before).source, after.source);
});
