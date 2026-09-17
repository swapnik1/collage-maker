import { describe, expect, it } from 'vitest';
import { UNIT } from '../types';
import {
  canvasSize,
  cellAt,
  chain,
  computeLayout,
  findNode,
  flipSplit,
  fromComposition,
  leaf,
  naturalAspect,
  optimiseRatios,
  photoIdsOf,
  removePhoto,
  seamAt,
  setRatio,
  signature,
  split,
  swapPhotos,
} from './tree';

const square = () => 1;
const shapes: Record<string, number> = { a: 3 / 2, b: 2 / 3, c: 1, d: 16 / 9 };
const aspectOf = (id: string) => shapes[id] ?? 1;

describe('canvasSize', () => {
  it('puts UNIT on the long edge', () => {
    expect(canvasSize(1)).toEqual({ w: UNIT, h: UNIT });
    expect(canvasSize(2)).toEqual({ w: UNIT, h: UNIT / 2 });
    expect(canvasSize(0.5)).toEqual({ w: UNIT / 2, h: UNIT });
  });
});

describe('computeLayout', () => {
  it('gives a lone photo the whole canvas inside the margin', () => {
    const layout = computeLayout(leaf('a'), 1, 0, 40);
    expect(layout.cells).toHaveLength(1);
    expect(layout.cells[0].rect).toEqual({ x: 40, y: 40, w: UNIT - 80, h: UNIT - 80 });
  });

  it('produces one cell per photo, however deep the tree', () => {
    for (const n of [1, 2, 3, 5, 8, 13, 20]) {
      const ids = Array.from({ length: n }, (_, i) => `p${i}`);
      const layout = computeLayout(chain(ids, 'row'), 1, 10, 10);
      expect(layout.cells).toHaveLength(n);
      expect(new Set(layout.cells.map((c) => c.photoId)).size).toBe(n);
    }
  });

  it('leaves exactly one gutter between neighbours and one margin at the edge', () => {
    const gutter = 20;
    const margin = 30;
    const layout = computeLayout(split('row', leaf('a'), leaf('b'), 0.5), 1, gutter, margin);
    const [left, right] = layout.cells;
    expect(right.rect.x - (left.rect.x + left.rect.w)).toBeCloseTo(gutter, 6);
    expect(left.rect.x).toBeCloseTo(margin + gutter / 2, 6);
    expect(right.rect.x + right.rect.w).toBeCloseTo(UNIT - margin - gutter / 2, 6);
  });

  it('never overlaps two cells', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const layout = computeLayout(fromComposition(ids, [2, 2], 'row'), 1, 8, 8);
    for (let i = 0; i < layout.cells.length; i++) {
      for (let j = i + 1; j < layout.cells.length; j++) {
        const p = layout.cells[i].rect;
        const q = layout.cells[j].rect;
        const apart = p.x + p.w <= q.x + 1e-9 || q.x + q.w <= p.x + 1e-9 || p.y + p.h <= q.y + 1e-9 || q.y + q.h <= p.y + 1e-9;
        expect(apart).toBe(true);
      }
    }
  });

  it('reports a seam for every split, positioned between its children', () => {
    const tree = split('row', leaf('a'), split('col', leaf('b'), leaf('c'), 0.5), 0.6);
    const layout = computeLayout(tree, 1, 10, 0);
    expect(layout.seams).toHaveLength(2);
    const vertical = layout.seams.find((s) => s.dir === 'row')!;
    expect(vertical.rect.x).toBeGreaterThan(0);
    expect(vertical.rect.x).toBeLessThan(UNIT);
    const a = layout.cells.find((c) => c.photoId === 'a')!;
    expect(a.rect.x + a.rect.w).toBeLessThanOrEqual(vertical.rect.x + vertical.rect.w + 1e-9);
  });

  it('returns an empty layout for no tree', () => {
    const layout = computeLayout(null, 1, 10, 10);
    expect(layout.cells).toHaveLength(0);
    expect(layout.seams).toHaveLength(0);
  });
});

describe('hit testing', () => {
  const tree = split('row', leaf('a'), leaf('b'), 0.5);
  const layout = computeLayout(tree, 1, 10, 0);

  it('finds the cell under a point', () => {
    expect(cellAt(layout, 100, 500)?.photoId).toBe('a');
    expect(cellAt(layout, 900, 500)?.photoId).toBe('b');
  });

  it('finds a seam within tolerance and not outside it', () => {
    expect(seamAt(layout, UNIT / 2, 500, 8)).not.toBeNull();
    expect(seamAt(layout, UNIT / 2 - 200, 500, 8)).toBeNull();
  });
});

describe('natural aspect', () => {
  it('adds widths across a row', () => {
    const tree = split('row', leaf('a'), leaf('d'));
    expect(naturalAspect(tree, aspectOf)).toBeCloseTo(3 / 2 + 16 / 9, 9);
  });

  it('adds heights down a column', () => {
    const tree = split('col', leaf('a'), leaf('d'));
    expect(naturalAspect(tree, aspectOf)).toBeCloseTo(1 / (1 / (3 / 2) + 1 / (16 / 9)), 9);
  });
});

describe('optimiseRatios', () => {
  it('crops nothing when the canvas matches the tree', () => {
    const tree = optimiseRatios(fromComposition(['a', 'b', 'c', 'd'], [2, 2], 'row'), aspectOf);
    const canvasAspect = naturalAspect(tree, aspectOf);
    const layout = computeLayout(tree, canvasAspect, 0, 0);
    for (const cell of layout.cells) {
      const cellAspect = cell.rect.w / cell.rect.h;
      expect(cellAspect / aspectOf(cell.photoId)).toBeCloseTo(1, 4);
    }
  });

  it('keeps ratios inside the clamp', () => {
    const lopsided = { e: 20, f: 0.05 };
    const tree = optimiseRatios(split('row', leaf('e'), leaf('f')), (id) => lopsided[id as 'e' | 'f']);
    if (tree.kind !== 'split') throw new Error('expected a split');
    expect(tree.ratio).toBeGreaterThanOrEqual(0.05);
    expect(tree.ratio).toBeLessThanOrEqual(0.95);
  });
});

describe('editing the tree', () => {
  const inner = split('col', leaf('b'), leaf('c'), 0.4);
  const base = split('row', leaf('a'), inner, 0.6);

  it('setRatio changes one node and leaves the rest alone', () => {
    const next = setRatio(base, base.id, 0.25);
    if (next.kind !== 'split') throw new Error('expected a split');
    expect(next.ratio).toBe(0.25);
    expect(signature(next)).toBe(signature(base));
    expect(photoIdsOf(next)).toEqual(photoIdsOf(base));
    const untouched = findNode(next, inner.id);
    expect(untouched?.kind).toBe('split');
    if (untouched?.kind === 'split') expect(untouched.ratio).toBe(0.4);
  });

  it('flipSplit turns a row into a column and re-solves the ratio', () => {
    const flipped = flipSplit(base, base.id, aspectOf);
    if (flipped.kind !== 'split') throw new Error('expected a split');
    expect(flipped.dir).toBe('col');
    expect(flipped.ratio).not.toBe(base.ratio);
    expect(photoIdsOf(flipped)).toEqual(photoIdsOf(base));
    const back = flipSplit(flipped, base.id, aspectOf);
    if (back.kind !== 'split') throw new Error('expected a split');
    expect(back.dir).toBe('row');
  });

  it('swapPhotos exchanges two photos and touches nothing else', () => {
    const swapped = swapPhotos(base, 'a', 'c');
    expect(photoIdsOf(swapped)).toEqual(['c', 'b', 'a']);
    expect(signature(swapped)).toBe(signature(base));
  });

  it('removePhoto collapses the split and promotes the sibling', () => {
    const trimmed = removePhoto(base, 'b');
    expect(trimmed).not.toBeNull();
    expect(photoIdsOf(trimmed)).toEqual(['a', 'c']);
  });

  it('removePhoto empties the tree when the last photo goes', () => {
    expect(removePhoto(leaf('a'), 'a')).toBeNull();
  });

  it('removePhoto ignores an id that is not there', () => {
    expect(photoIdsOf(removePhoto(base, 'zz'))).toEqual(['a', 'b', 'c']);
  });
});

describe('fromComposition', () => {
  it('groups photos in the order given', () => {
    const tree = fromComposition(['a', 'b', 'c', 'd', 'e'], [3, 2], 'row');
    expect(photoIdsOf(tree)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('stacks rows down the canvas', () => {
    const tree = optimiseRatios(fromComposition(['a', 'b', 'c', 'd'], [2, 2], 'row'), square);
    const layout = computeLayout(tree, 1, 0, 0);
    const [first, second, third, fourth] = layout.cells;
    expect(first.rect.y).toBeCloseTo(second.rect.y, 6);
    expect(third.rect.y).toBeGreaterThan(first.rect.y);
    expect(third.rect.y).toBeCloseTo(fourth.rect.y, 6);
  });
});
