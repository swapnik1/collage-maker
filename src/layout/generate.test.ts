import { describe, expect, it } from 'vitest';
import { generateLayouts, PhotoShape, scoreTree } from './generate';
import { computeLayout, signature } from './tree';

const L = 3 / 2;
const P = 2 / 3;
const S = 1;
const PANO = 3;

const set = (aspects: number[]): PhotoShape[] => aspects.map((aspect, i) => ({ id: `p${i}`, aspect }));
const lookup = (photos: PhotoShape[]) => (id: string) => photos.find((p) => p.id === id)?.aspect ?? 1;

/** Largest share of any one photo hidden by its cell. */
function worstCrop(root: Parameters<typeof signature>[0], photos: PhotoShape[], canvasAspect: number) {
  const aspectOf = lookup(photos);
  const layout = computeLayout(root, canvasAspect, 0, 0);
  return Math.max(
    ...layout.cells.map((c) => {
      const cellAspect = c.rect.w / c.rect.h;
      const photoAspect = aspectOf(c.photoId);
      return 1 - Math.min(cellAspect / photoAspect, photoAspect / cellAspect);
    }),
  );
}

describe('generateLayouts', () => {
  it('lays out every photo exactly once, at any count', () => {
    for (let n = 1; n <= 20; n++) {
      const photos = set(Array.from({ length: n }, (_, i) => [L, P, S, PANO][i % 4]));
      for (const root of generateLayouts(photos, 1, 5)) {
        const layout = computeLayout(root, 1, 10, 10);
        expect(layout.cells).toHaveLength(n);
        expect(new Set(layout.cells.map((c) => c.photoId))).toEqual(new Set(photos.map((p) => p.id)));
      }
    }
  });

  it('keeps the photos in the order they were given', () => {
    const photos = set([L, P, S, L, P]);
    const layout = computeLayout(generateLayouts(photos, 1, 1)[0], 1, 0, 0);
    expect(layout.cells.map((c) => c.photoId)).toEqual(photos.map((p) => p.id));
  });

  it('returns nothing for no photos and a single leaf for one', () => {
    expect(generateLayouts([], 1)).toHaveLength(0);
    const one = generateLayouts(set([L]), 1);
    expect(one).toHaveLength(1);
    expect(one[0].kind).toBe('leaf');
  });

  it('is deterministic (R2.5)', () => {
    const photos = set([L, P, S, L, P, S, L, P, S]);
    const first = generateLayouts(photos, 1, 5).map(signature);
    const second = generateLayouts(photos, 1, 5).map(signature);
    expect(second).toEqual(first);
  });

  it('offers structurally distinct alternatives', () => {
    const photos = set([L, P, S, L, P, S, L]);
    const sigs = generateLayouts(photos, 1, 8).map(signature);
    expect(new Set(sigs).size).toBe(sigs.length);
  });

  it('never returns more than asked for', () => {
    const photos = set([L, P, S, L]);
    expect(generateLayouts(photos, 1, 3).length).toBeLessThanOrEqual(3);
  });

  it('ranks its own suggestions best first', () => {
    const photos = set([L, P, S, L, P, S, L, P]);
    const aspectOf = lookup(photos);
    const scores = generateLayouts(photos, 1, 6).map((r) => scoreTree(r, aspectOf, 1));
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1] - 1e-9);
  });

  it('crops little on mixed sets', () => {
    const cases: [number[], number][] = [
      [[L, P, S, L, P], 0.8],
      [[L, P, S, L, P, S, L, P, S], 1],
      [[L, P, S, L, P, S, L, P, S, L, P, S], 0.8],
      [[PANO, S, S, S, S, S], 1],
    ];
    for (const [aspects, canvasAspect] of cases) {
      const photos = set(aspects);
      const best = generateLayouts(photos, canvasAspect, 1)[0];
      expect(worstCrop(best, photos, canvasAspect)).toBeLessThan(0.25);
    }
  });

  it('adapts to the canvas shape', () => {
    const photos = set([L, P, S, L, P, S]);
    for (const canvasAspect of [1, 0.8, 16 / 9, 9 / 16]) {
      const best = generateLayouts(photos, canvasAspect, 1)[0];
      expect(worstCrop(best, photos, canvasAspect)).toBeLessThan(0.3);
    }
  });

  it('gives a panorama a cell shaped like a panorama', () => {
    const photos = set([PANO, S, S, S, S, S]);
    const best = generateLayouts(photos, 1, 1)[0];
    const layout = computeLayout(best, 1, 0, 0);
    const pano = layout.cells.find((c) => c.photoId === 'p0')!;
    expect(pano.rect.w / pano.rect.h).toBeGreaterThan(1.8);
  });

  it('stays inside its time budget for 20 photos (R2.6)', () => {
    const photos = set(Array.from({ length: 20 }, (_, i) => [L, P, S, L, 0.45][i % 5]));
    const started = performance.now();
    generateLayouts(photos, 1, 12);
    expect(performance.now() - started).toBeLessThan(300);
  });
});

describe('scoreTree', () => {
  it('prefers a grid to a single row for square photos on a square canvas', () => {
    const photos = set([S, S, S, S]);
    const aspectOf = lookup(photos);
    const [grid, strip] = [
      generateLayouts(photos, 1, 1)[0],
      generateLayouts(photos, 4, 1)[0],
    ];
    expect(scoreTree(grid, aspectOf, 1)).toBeLessThan(scoreTree(strip, aspectOf, 1));
  });
});
