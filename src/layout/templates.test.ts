import { describe, expect, it } from 'vitest';
import { templatesFor } from './templates';
import { PhotoShape } from './generate';
import { computeLayout, photoIdsOf, signature } from './tree';

const L = 3 / 2;
const P = 2 / 3;
const S = 1;
const set = (n: number): PhotoShape[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, aspect: [L, P, S][i % 3] }));

describe('templatesFor', () => {
  it('offers nothing below two photos', () => {
    expect(templatesFor([], 1)).toHaveLength(0);
    expect(templatesFor(set(1), 1)).toHaveLength(0);
  });

  it('uses every photo exactly once in every template', () => {
    for (const n of [2, 3, 4, 6, 9, 14, 20]) {
      const photos = set(n);
      const expected = photos.map((p) => p.id);
      for (const t of templatesFor(photos, 1)) {
        expect(photoIdsOf(t.root).slice().sort(), `${t.key} at n=${n}`).toEqual(expected.slice().sort());
        expect(computeLayout(t.root, 1, 10, 10).cells).toHaveLength(n);
      }
    }
  });

  it('keeps reading order except where the template moves the hero', () => {
    for (const n of [4, 6, 12]) {
      const photos = set(n);
      const expected = photos.map((p) => p.id);
      for (const t of templatesFor(photos, 1)) {
        // hero-right and hero-bottom deliberately put the first photo last.
        if (t.key === 'hero-right' || t.key === 'hero-bottom') {
          expect(photoIdsOf(t.root), t.key).toEqual([...expected.slice(1), expected[0]]);
        } else {
          expect(photoIdsOf(t.root), `${t.key} at n=${n}`).toEqual(expected);
        }
      }
    }
  });

  it('gives every template a unique key and a distinct shape', () => {
    for (const n of [3, 5, 8, 12, 20]) {
      const templates = templatesFor(set(n), 1);
      expect(new Set(templates.map((t) => t.key)).size).toBe(templates.length);
      expect(new Set(templates.map((t) => signature(t.root))).size).toBe(templates.length);
    }
  });

  it('names every template', () => {
    for (const t of templatesFor(set(8), 1)) {
      expect(t.name.length).toBeGreaterThan(0);
    }
  });

  it('offers a useful number of choices', () => {
    expect(templatesFor(set(2), 1).length).toBeGreaterThanOrEqual(2);
    expect(templatesFor(set(8), 1).length).toBeGreaterThanOrEqual(6);
  });

  it('drops side-by-side and stacked once there are too many photos for them', () => {
    const keys = (n: number) => templatesFor(set(n), 1).map((t) => t.key);
    expect(keys(4)).toContain('strip');
    expect(keys(12)).not.toContain('strip');
    expect(keys(12)).not.toContain('stack');
  });

  it('puts the first photo on the named side for hero layouts', () => {
    const photos = set(6);
    const byKey = new Map(templatesFor(photos, 1).map((t) => [t.key, t.root]));

    const cellOf = (key: string, id: string) => {
      const layout = computeLayout(byKey.get(key)!, 1, 0, 0);
      return { cell: layout.cells.find((c) => c.photoId === id)!, layout };
    };

    const left = cellOf('hero-left', 'p0');
    expect(left.cell.rect.x).toBeCloseTo(0, 6);
    expect(left.cell.rect.h).toBeCloseTo(left.layout.h, 6);

    const right = cellOf('hero-right', 'p0');
    expect(right.cell.rect.x + right.cell.rect.w).toBeCloseTo(right.layout.w, 6);

    const top = cellOf('hero-top', 'p0');
    expect(top.cell.rect.y).toBeCloseTo(0, 6);
    expect(top.cell.rect.w).toBeCloseTo(top.layout.w, 6);

    const bottom = cellOf('hero-bottom', 'p0');
    expect(bottom.cell.rect.y + bottom.cell.rect.h).toBeCloseTo(bottom.layout.h, 6);
  });

  it('builds rows of the size it advertises', () => {
    // At n=9 "Rows of 3" is the same shape as the grid and gets deduplicated,
    // so use a count where the two genuinely differ.
    const rows3 = templatesFor(set(7), 1).find((t) => t.key === 'rows3');
    expect(rows3).toBeDefined();
    const layout = computeLayout(rows3!.root, 1, 0, 0);
    const rows = new Map<number, number>();
    for (const c of layout.cells) {
      const top = Math.round(c.rect.y);
      rows.set(top, (rows.get(top) ?? 0) + 1);
    }
    expect([...rows.values()]).toEqual([3, 3, 1]);
  });

  it('adapts the grid to the canvas shape', () => {
    const photos = set(8);
    const rowsIn = (canvasAspect: number) => {
      const grid = templatesFor(photos, canvasAspect).find((t) => t.key === 'grid');
      if (!grid) return 0;
      const layout = computeLayout(grid.root, canvasAspect, 0, 0);
      return new Set(layout.cells.map((c) => Math.round(c.rect.y))).size;
    };
    // A wide canvas wants fewer, longer rows than a tall one.
    expect(rowsIn(16 / 9)).toBeLessThanOrEqual(rowsIn(9 / 16));
  });
});
