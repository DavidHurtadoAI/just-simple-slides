import { test } from 'node:test';
import assert from 'node:assert/strict';
import { thumbnailBoundary, thumbnailColumns } from '../src/sorter.ts';

const grid = Array.from({ length: 8 }, (_, i) => ({ left: 20 + (i % 3) * 240, top: 10 + Math.floor(i / 3) * 170, width: 220, height: 150 }));

test('grid insertion uses both axes, including the last incomplete row', () => {
  for (let i = 0; i < grid.length; i++) {
    const rect = grid[i];
    assert.equal(thumbnailBoundary(grid, rect.left + 5, rect.top + 60, true), i);
    assert.equal(thumbnailBoundary(grid, rect.left + rect.width - 5, rect.top + 60, true), i + 1);
  }
  assert.equal(thumbnailBoundary(grid, 1000, 400, true), 8);
  assert.equal(thumbnailBoundary(grid, -10, 220, true), 3);
  assert.equal(thumbnailBoundary(grid, 1000, -10, true), 0);
  assert.equal(thumbnailBoundary(grid, -10, 600, true), 8);
});

test('row gaps and horizontal gaps give stable insertion boundaries', () => {
  assert.equal(thumbnailBoundary(grid, 245, 50, true), 1);
  assert.equal(thumbnailBoundary(grid, 10, 165, true), 0);
  assert.equal(thumbnailBoundary(grid, 10, 175, true), 3);
  assert.equal(thumbnailBoundary(grid, 1000, 165, true), 3);
  assert.equal(thumbnailBoundary(grid, 1000, 175, true), 6);
});

test('insertion works after scrolling and when the grid becomes a single column', () => {
  const scrolled = grid.map(rect => ({ ...rect, top: rect.top - 210 }));
  assert.equal(thumbnailBoundary(scrolled, 30, -20, true), 3);
  const column = grid.map((rect, i) => ({ ...rect, left: 10, top: i * 170 }));
  assert.equal(thumbnailColumns(column), 1);
  assert.equal(thumbnailBoundary(column, 20, 200, true), 1);
  assert.equal(thumbnailBoundary(column, 220, 200, true), 2);
});

test('the original vertical rail still inserts by height alone', () => {
  const column = grid.map((rect, i) => ({ ...rect, left: 10, top: i * 170 }));
  for (let i = 0; i < column.length; i++) {
    assert.equal(thumbnailBoundary(column, 999, i * 170 + 10, false), i);
    assert.equal(thumbnailBoundary(column, -999, i * 170 + 140, false), i + 1);
  }
});

test('column measurement follows responsive reflow and handles empty/single decks', () => {
  assert.equal(thumbnailColumns(grid), 3);
  assert.equal(thumbnailColumns(grid.slice(0, 2)), 2);
  assert.equal(thumbnailColumns([grid[0]]), 1);
  assert.equal(thumbnailColumns([]), 1);
  assert.equal(thumbnailBoundary([], 0, 0, true), 0);
  assert.equal(thumbnailBoundary([grid[0]], 1000, 50, true), 1);
});
