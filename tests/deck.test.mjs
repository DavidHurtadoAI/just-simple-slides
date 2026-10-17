import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addSlide, DeckHistory, deleteSlide, moveSlide, moveSlideTo, parseDeck, replaceSlide, slideAt } from '../src/deck.ts';

test('keeps original source positions, CRLF and frontmatter', () => {
  const source = '---\r\ntitle: Test\r\n---\r\n\r\n###### First\r\n\r\nOne\r\n---\r\n## Second\r\n';
  const deck = parseDeck(source);
  assert.equal(deck.eol, '\r\n');
  assert.equal(deck.slides.length, 2);
  assert.deepEqual(deck.slides.map(s => s.title), ['First', 'Second']);
  for (const s of deck.slides) assert.equal(s.markdown, source.slice(s.start, s.end));
  assert.equal(replaceSlide(source, deck.slides[1], '# Changed\r\n'), source.slice(0, deck.slides[1].start) + '# Changed\r\n');
});
test('separators and headings inside fences and comments are not slides', () => {
  const source = '```md\n# Not a title\n---\n````\n<!--\n---\n# Comment\n-->\n### Real title\n\n~~~\n---\n~~~\n---\n# End';
  const deck = parseDeck(source);
  assert.deepEqual(deck.slides.map(s => s.title), ['Real title', 'End']);
});
test('allows empty, title-only, image-only and trailing empty slides', () => {
  assert.equal(parseDeck('').slides.length, 1);
  assert.equal(parseDeck('![[photo.png]]').slides[0].markdown, '![[photo.png]]');
  assert.equal(parseDeck('# A\n---\n---\n').slides.length, 3);
  assert.equal(parseDeck('Title\n=====').slides[0].title, 'Title');
});
test('indented code, thematic rules and quoted separators are preserved', () => {
  assert.equal(parseDeck('# A\n    ---\n> ---\n***\n- - -').slides.length, 1);
});
test('replacing one slide preserves all other bytes and separator after removed newline', () => {
  const source = '# First\n\nbody\n---\n# Second\n\nTail';
  const deck = parseDeck(source);
  const result = replaceSlide(source, deck.slides[0], '# New');
  assert.equal(result, '# New\n---\n# Second\n\nTail');
  assert.equal(parseDeck(result).slides.length, 2);
});
test('typed separators map cursor to the newly created slide', () => {
  const source = '# A\n---\n# B';
  const deck = parseDeck(source);
  assert.equal(slideAt(deck, source.indexOf('# B')), 1);
  assert.equal(slideAt(deck, 0), 0);
});
test('add and duplicate between slides retain following slides and metadata', () => {
  const source = '---\ntags: [slides]\n---\n# A\n---\n# B';
  const deck = parseDeck(source);
  const added = addSlide(source, deck, 0);
  assert.deepEqual(parseDeck(added.source).slides.map(s => s.title), ['A', 'New slide', 'B']);
  const copied = addSlide(source, deck, 1, true);
  assert.deepEqual(parseDeck(copied.source).slides.map(s => s.title), ['A', 'B', 'B']);
  assert.ok(copied.source.startsWith('---\ntags: [slides]\n---\n'));
});
test('delete first, middle, last and only slide safely', () => {
  const source = '---\ntitle: Deck\n---\n# A\n---\n# B\n---\n# C';
  const deck = parseDeck(source);
  for (let i = 0; i < 3; i++) {
    const result = deleteSlide(source, deck, i);
    assert.deepEqual(parseDeck(result.source).slides.map(s => s.title), ['A', 'B', 'C'].filter((_, j) => i !== j));
    assert.ok(result.source.startsWith(source.slice(0, deck.prefixEnd)));
  }
  const one = '---\ntitle: One\n---\n# A';
  assert.equal(deleteSlide(one, parseDeck(one), 0).source, '---\ntitle: One\n---\n');
});
test('reordering never merges a heading with a separator', () => {
  for (const eol of ['\n', '\r\n']) {
    const source = ['# A', '---', '# B', '---', '# C'].join(eol);
    const result = moveSlide(source, parseDeck(source), 2, -1);
    assert.deepEqual(parseDeck(result.source).slides.map(s => s.title), ['A', 'C', 'B']);
    const again = moveSlide(result.source, parseDeck(result.source), 1, -1);
    assert.deepEqual(parseDeck(again.source).slides.map(s => s.title), ['C', 'A', 'B']);
  }
});
test('undo and redo retain source, selection and slide across navigation', () => {
  const h = new DeckHistory();
  const a = { source: '# A', index: 0, anchor: 3, head: 3 };
  const b = { source: '# Aa', index: 0, anchor: 4, head: 4 };
  const c = { source: '# Aab', index: 0, anchor: 5, head: 5 };
  h.record(a, true, 1000); h.record(b, true, 1100);
  assert.deepEqual(h.undo(c), a);
  assert.deepEqual(h.redo(a), c);
  h.breakGroup(); h.record(c, true, 1300);
  const d = { source: '# Aabc', index: 1, anchor: 0, head: 0 };
  assert.deepEqual(h.undo(d), c);
});

test('moves a slide to any position with its image, type and private notes', () => {
  const bodies = ['A', 'B', 'C', 'D', 'E'].map(title => `> [!slide] content\n> Private notes ${title}.\n\n# ${title}\n\n![[${title}.png]]\n`);
  const prefix = '---\ntags: [slides]\ntitle: Keep this\n---\n';
  const source = prefix + bodies.join('---\n');
  for (let from = 0; from < bodies.length; from++) for (let to = 0; to < bodies.length; to++) {
    const result = moveSlideTo(source, parseDeck(source), from, to);
    const expected = [...bodies];
    expected.splice(to, 0, expected.splice(from, 1)[0]);
    assert.equal(result.source, prefix + expected.join('---\n'));
    assert.equal(result.index, to);
    assert.equal(parseDeck(result.source).slides[to].areas[0].content, `Private notes ${'ABCDE'[from]}.`);
  }
});

test('moving the last slide into the middle keeps separator lines valid without a final newline', () => {
  for (const eol of ['\n', '\r\n']) {
    const source = ['# A', '---', '# B', '---', '# C', '---', '# D'].join(eol);
    const result = moveSlideTo(source, parseDeck(source), 3, 1);
    assert.deepEqual(parseDeck(result.source).slides.map(slide => slide.title), ['A', 'D', 'B', 'C']);
    assert.equal(result.source.includes(eol === '\r\n' ? '\n---\n' : '\r'), false);
  }
});

test('reordering keeps unusual separator spacing and frontmatter byte for byte', () => {
  const prefix = '---\r\ntitle: Deck\r\n---\r\n';
  const source = prefix + '# A\r\n ---  \r\n# B\r\n  ---\t\r\n# C\r\n';
  const result = moveSlideTo(source, parseDeck(source), 0, 2);
  assert.equal(result.source, prefix + '# B\r\n ---  \r\n# C\r\n  ---\t\r\n# A\r\n');
});

test('empty slides can be moved without losing a slide boundary', () => {
  const source = '# A\n---\n---\n# C';
  const result = moveSlideTo(source, parseDeck(source), 1, 2);
  assert.equal(parseDeck(result.source).slides.length, 3);
  assert.deepEqual(parseDeck(result.source).slides.map(slide => slide.markdown.trim()), ['# A', '# C', '']);
});

test('same-position and invalid reorder targets do not change the source', () => {
  const source = '# A\n---\n# B';
  for (const [from, to] of [[0, 0], [0, -1], [1, 2], [-1, 0], [0, 0.5]]) {
    assert.equal(moveSlideTo(source, parseDeck(source), from, to).source, source);
  }
});
