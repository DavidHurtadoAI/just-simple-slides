import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampSize, DEFAULT_LAYOUT, readLayout, sidebarBounds, sourceBounds } from '../src/layout.ts';

test('saved layout retains area selection and ignores the retired source mode', () => {
  assert.deepEqual(readLayout(null), DEFAULT_LAYOUT);
  assert.deepEqual(readLayout({ sidebarWidth: Infinity, sourceRatio: 'large', editorMode: 'unknown' }), DEFAULT_LAYOUT);
  assert.deepEqual(readLayout({ sidebarWidth: 290, sourceRatio: 0.6, editorMode: 'area', areaIndex: 3 }), { sidebarWidth: 290, sourceRatio: 0.6, areaIndex: 3, sorterSize: 220 });
  assert.deepEqual(readLayout({ editorMode: 'markdown' }), DEFAULT_LAYOUT);
  for (const areaIndex of [-1, NaN, 2.5, '3', Infinity]) assert.equal(readLayout({ areaIndex }).areaIndex, 0);
  assert.equal(readLayout({ sidebarWidth: 10000 }).sidebarWidth, 520);
});

test('sorter thumbnail size survives old settings and rejects invalid values', () => {
  assert.equal(readLayout({ sorterSize: 300 }).sorterSize, 300);
  assert.equal(readLayout({ sorterSize: 0 }).sorterSize, 140);
  assert.equal(readLayout({ sorterSize: 10000 }).sorterSize, 360);
  for (const sorterSize of [NaN, Infinity, '220', null]) assert.equal(readLayout({ sorterSize }).sorterSize, 220);
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
