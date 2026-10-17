import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSlideAreas, slideCallout, updateSlideArea } from '../src/details.ts';
import { addSlide, parseDeck } from '../src/deck.ts';
const values = source => readSlideAreas(source).map(({ name, content }) => ({ name, content }));

test('callouts, names, bodies and any conventional fields are optional', () => {
  assert.deepEqual(values('# Just a slide'), []);
  assert.deepEqual(values('> [!slide]'), [{ name: '', content: '' }]);
  assert.deepEqual(values('> [!slide]\n> Anything at all.'), [{ name: '', content: 'Anything at all.' }]);
  assert.deepEqual(values('> [!slide] (My Name)'), [{ name: '(My Name)', content: '' }]);
});

test('reads every area in order, including repeated and missing names', () => {
  const source = '> [!slide] Notes\n> First.\n\n# Title\n\n> [!slide]\n\n> [!slide] Notes\n> Third.';
  assert.deepEqual(values(source), [
    { name: 'Notes', content: 'First.' }, { name: '', content: '' }, { name: 'Notes', content: 'Third.' },
  ]);
});

test('names preserve case, Unicode and punctuation; bodies are uninterpreted Markdown', () => {
  assert.deepEqual(values('> [!SLIDE]- Mis Notas (日本語)\r\n> Type: anything\r\n>\r\n> **Free Markdown**.\r\n\r\n# Visible'), [
    { name: 'Mis Notas (日本語)', content: 'Type: anything\n\n**Free Markdown**.' },
  ]);
  assert.equal(readSlideAreas('> [!slide]+ Title')[0].name, 'Title');
});

test('code examples, HTML comments and other callouts are not private areas', () => {
  for (const source of [
    '```md\n> [!slide] Example\n```', '~~~md\n> [!slide] Example\n~~~',
    '<!--\n> [!slide] Example\n-->',
    '> [!example]\n> ```md\n> [!slide] Example\n> ```',
    '> [!tip] Visible\n> Ordinary content.',
  ]) assert.deepEqual(values(source), []);
});

test('nested private areas can be selected and edited inside ordinary callouts', () => {
  const before = '> [!tip] Visible\n> Keep this.\n>\n';
  const after = '>\n> Keep this too.\n\n# Title';
  const source = before + '> > [!slide] Nested\n> > Private.\n' + after;
  assert.deepEqual(values(source), [{ name: 'Nested', content: 'Private.' }]);
  assert.equal(updateSlideArea(source, 0, 'Changed.\n\nMore.'), before + '> > [!slide] Nested\n> > Changed.\n> >\n> > More.\n' + after);
});

test('slide parsing keeps quoted headings and separators private without changing bytes', () => {
  const source = '> [!slide] Free name\n> # A private heading\n> ---\n> ![[private.png]]\n\n###### Visible title\n\n---\n\n# Next';
  const deck = parseDeck(source);
  assert.equal(deck.slides.length, 2);
  assert.equal(deck.slides[0].title, 'Visible title');
  assert.equal(deck.slides[0].areas[0].name, 'Free name');
  assert.ok(deck.slides[0].areas[0].content.includes('# A private heading'));
  assert.equal(deck.slides[0].markdown, source.slice(0, source.indexOf('\n---\n') + 1));
});

test('new slide examples recommend notes; duplicates keep all areas', () => {
  const source = '> [!slide] Notes\n> Type: title\n\n> [!slide] Timing\n> Two minutes.\n\n# Hello';
  const added = addSlide(source, parseDeck(source), 0);
  assert.deepEqual(values(parseDeck(added.source).slides[1].markdown), [{ name: 'Notes', content: 'Type: content\n\nPresenter notes go here.' }]);
  const duplicate = addSlide(source, parseDeck(source), 0, true);
  assert.deepEqual(values(parseDeck(duplicate.source).slides[1].markdown), values(source));
});

test('callout generation quotes arbitrary Markdown including slide separators', () => {
  const result = slideCallout('Notes', 'One.\n\n---\nTwo.', '\r\n');
  assert.equal(result, '> [!slide] Notes\r\n> One.\r\n>\r\n> ---\r\n> Two.');
  assert.equal(parseDeck(result + '\r\n\r\n# Title').slides.length, 1);
});

test('editing the second area preserves its exact header, other areas and visible source', () => {
  const before = '# Title\r\n\r\n> [!slide] First\r\n> Keep me.\r\n\r\n';
  const header = '  > [!SLIDE]-  (Second Area)  \r\n';
  const after = '\r\nText and ![[image.png]]\r\n\r\n> [!tip] Visible\r\n> Keep this.\r\n\r\n> [!slide]\r\n> Third.\r\n';
  const source = before + header + '  > Old.\r\n' + after;
  const updated = updateSlideArea(source, 1, 'New.\n\n- Pause.', '\r\n');
  assert.equal(updated, before + header + '  > New.\r\n  >\r\n  > - Pause.\r\n' + after);
});

test('clearing a body keeps the empty named or unnamed area and original header', () => {
  for (const header of ['> [!slide]', '> [!SLIDE]+ Notes']) {
    assert.equal(updateSlideArea(header + '\n> Old.\n\n# Title', 0, ''), header + '\n\n# Title');
    assert.deepEqual(values(updateSlideArea(header + '\n> Old.', 0, '')), [{ name: header.includes('Notes') ? 'Notes' : '', content: '' }]);
  }
});

test('missing area edits are no-ops and never invent metadata', () => {
  const source = '# Title\n\nPlain Markdown.';
  for (const index of [0, 2, -1]) assert.equal(updateSlideArea(source, index, 'Private.'), source);
});

test('lazy continuation stays private and its entire range is replaced', () => {
  const source = '> [!slide] Notes\n> Private first line.\nPrivate continuation.\n\n# Title\n';
  assert.equal(readSlideAreas(source)[0].content, 'Private first line.\nPrivate continuation.');
  assert.equal(updateSlideArea(source, 0, 'Replaced.'), '> [!slide] Notes\n> Replaced.\n\n# Title\n');
});

test('private body editing retains indentation and cannot create slide separators', () => {
  const source = '> [!slide]\n>     indented code\n>\n> Last line.\n\n# Title';
  assert.equal(readSlideAreas(source)[0].content, '    indented code\n\nLast line.');
  const updated = updateSlideArea(source, 0, '---\n# Still private.');
  assert.equal(parseDeck(updated).slides.length, 1);
  assert.equal(parseDeck(updated).slides[0].title, 'Title');
});

test('editing at end of file works with or without a final newline', () => {
  for (const eol of ['\n', '\r\n']) for (const terminal of ['', eol]) {
    const source = '# Title' + eol + eol + '> [!slide] Notes' + terminal;
    const updated = updateSlideArea(source, 0, 'New.', eol);
    assert.equal(updated, '# Title' + eol + eol + '> [!slide] Notes' + eol + '> New.' + terminal);
  }
});
