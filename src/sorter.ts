export interface ThumbnailRect { left: number; top: number; width: number; height: number }

/** An insertion boundary (0…length), shared by the vertical rail and slide sorter. */
export function thumbnailBoundary(rects: readonly ThumbnailRect[], x: number, y: number, grid: boolean): number {
  if (!rects.length) return 0;
  if (!grid) {
    const next = rects.findIndex(rect => y < rect.top + rect.height / 2);
    return next < 0 ? rects.length : next;
  }
  const rows: { start: number; end: number; middle: number }[] = [];
  for (const [index, rect] of rects.entries()) {
    const previous = rects[index - 1];
    if (!previous || Math.abs(rect.top - previous.top) > 1) {
      rows.push({ start: index, end: index + 1, middle: rect.top + rect.height / 2 });
    } else rows[rows.length - 1]!.end = index + 1;
  }
  if (y < rects[0]!.top) return 0;
  const last = rects[rects.length - 1]!;
  if (y > last.top + last.height) return rects.length;
  const row = rows.reduce((nearest, candidate) => Math.abs(candidate.middle - y) < Math.abs(nearest.middle - y) ? candidate : nearest);
  for (let index = row.start; index < row.end; index++) {
    const rect = rects[index]!;
    if (x < rect.left + rect.width / 2) return index;
  }
  return row.end;
}

export function thumbnailColumns(rects: readonly ThumbnailRect[]): number {
  if (!rects.length) return 1;
  const end = rects.findIndex(rect => Math.abs(rect.top - rects[0]!.top) > 1);
  return end < 0 ? rects.length : end;
}
