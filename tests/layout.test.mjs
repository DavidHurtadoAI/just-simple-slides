import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampSize, DEFAULT_LAYOUT, readLayout, sidebarBounds, sourceBounds } from '../src/layout.ts';

test('saved layout accepts both modes and rejects invalid or unbounded sizes', () => {
  assert.deepEqual(readLayout(null), DEFAULT_LAYOUT);
  assert.deepEqual(readLayout({ sidebarWidth: Infinity, sourceRatio: 'large', editorMode: 'unknown' }), DEFAULT_LAYOUT);
  assert.deepEqual(readLayout({ sidebarWidth: 290, sourceRatio: 0.6, editorMode: 'area', areaIndex: 3 }), { sidebarWidth: 290, sourceRatio: 0.6, editorMode: 'area', areaIndex: 3 });
  assert.equal(readLayout({ editorMode: 'details' }).editorMode, 'area');
  for (const areaIndex of [-1, NaN, 2.5, '3', Infinity]) assert.equal(readLayout({ areaIndex }).areaIndex, 0);
  assert.equal(readLayout({ sidebarWidth: 10000 }).sidebarWidth, 520);
});

test('sidebar resizing leaves usable preview space in narrow and desktop panes', () => {
  for (const width of [280, 346, 600, 1200]) {
    const bounds = sidebarBounds(width);
    assert.ok(bounds.max >= bounds.min);
    assert.ok(width - clampSize(10000, bounds) >= 180);
    assert.equal(clampSize(-100, bounds), bounds.min);
  }
});

test('bottom resizing leaves space for both the slide preview and source editor', () => {
  for (const height of [180, 300, 600, 1000]) {
    const bounds = sourceBounds(height);
    assert.ok(bounds.max >= bounds.min);
    assert.ok(height - bounds.max >= Math.min(200, height * 0.5));
    assert.equal(clampSize(10000, bounds), bounds.max);
  }
});
