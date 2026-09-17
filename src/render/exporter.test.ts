import { describe, expect, it } from 'vitest';
import { Doc, Photo, UNIT } from '../types';
import { DEFAULT_CANVAS } from '../state/store';
import { generateLayouts } from '../layout/generate';
import { nativeCeiling, outputSize, upscaledAt } from './exporter';

function photo(id: string, width: number, height: number): Photo {
  return {
    id,
    name: `${id}.jpg`,
    width,
    height,
    aspect: width / height,
    proxy: { width, height, close: () => {} } as unknown as ImageBitmap,
    blob: new Blob([]),
  };
}

function docFor(photos: Photo[], aspect = 1): Doc {
  const order = photos.map((p) => p.id);
  const root = generateLayouts(
    photos.map((p) => ({ id: p.id, aspect: p.aspect })),
    aspect,
    1,
  )[0];
  return { root, order, transforms: {}, canvas: { ...DEFAULT_CANVAS, aspect } };
}

describe('outputSize', () => {
  it('puts the requested edge on the long side', () => {
    const doc = docFor([photo('a', 1000, 1000), photo('b', 1000, 1000)], 1);
    expect(outputSize(doc, 2048)).toEqual({ w: 2048, h: 2048 });
    expect(outputSize({ ...doc, canvas: { ...doc.canvas, aspect: 2 } }, 2048)).toEqual({ w: 2048, h: 1024 });
    expect(outputSize({ ...doc, canvas: { ...doc.canvas, aspect: 0.5 } }, 2048)).toEqual({ w: 1024, h: 2048 });
  });
});

describe('nativeCeiling', () => {
  it('stays within sane bounds', () => {
    const doc = docFor([photo('a', 4000, 3000), photo('b', 4000, 3000), photo('c', 4000, 3000)]);
    const ceiling = nativeCeiling(doc, [photo('a', 4000, 3000), photo('b', 4000, 3000), photo('c', 4000, 3000)]);
    expect(ceiling).toBeGreaterThanOrEqual(512);
    expect(ceiling).toBeLessThanOrEqual(8192);
  });

  it('is higher for bigger source photos', () => {
    const small = [photo('a', 800, 600), photo('b', 800, 600)];
    const large = [photo('a', 6000, 4500), photo('b', 6000, 4500)];
    expect(nativeCeiling(docFor(large), large)).toBeGreaterThan(nativeCeiling(docFor(small), small));
  });

  it('falls back to a default with no layout', () => {
    const doc: Doc = { root: null, order: [], transforms: {}, canvas: DEFAULT_CANVAS };
    expect(nativeCeiling(doc, [])).toBe(4096);
  });

  it('is the size at which nothing is upscaled yet', () => {
    const photos = [photo('a', 2000, 1500), photo('b', 1200, 1600), photo('c', 3000, 1000)];
    const doc = docFor(photos);
    const ceiling = nativeCeiling(doc, photos);
    expect(upscaledAt(doc, photos, ceiling)).toHaveLength(0);
  });
});

describe('upscaledAt', () => {
  it('names photos that would be enlarged past native resolution (R7.5)', () => {
    const photos = [photo('a', 400, 300), photo('b', 4000, 3000)];
    const doc = docFor(photos);
    // Half the canvas each, so 4000px output is comfortable for b and far too big for a.
    const flagged = upscaledAt(doc, photos, 4000);
    expect(flagged).toContain('a.jpg');
    expect(flagged).not.toContain('b.jpg');
  });

  it('flags even a large photo once the output outgrows it', () => {
    const photos = [photo('a', 4000, 3000), photo('b', 4000, 3000)];
    expect(upscaledAt(docFor(photos), photos, 8192)).toEqual(['a.jpg', 'b.jpg']);
  });

  it('flags nothing at a small output size', () => {
    const photos = [photo('a', 4000, 3000), photo('b', 4000, 3000)];
    expect(upscaledAt(docFor(photos), photos, 600)).toHaveLength(0);
  });

  it('accounts for zoom, which magnifies a photo further', () => {
    const photos = [photo('a', 1200, 900), photo('b', 1200, 900)];
    const doc = docFor(photos);
    const edge = nativeCeiling(doc, photos);
    expect(upscaledAt(doc, photos, edge)).toHaveLength(0);
    const zoomed: Doc = { ...doc, transforms: { a: { zoom: 4, panX: 0, panY: 0 } } };
    expect(upscaledAt(zoomed, photos, edge)).toContain('a.jpg');
    expect(nativeCeiling(zoomed, photos)).toBeLessThan(edge);
  });

  it('reports nothing when there is no layout', () => {
    const doc: Doc = { root: null, order: [], transforms: {}, canvas: DEFAULT_CANVAS };
    expect(upscaledAt(doc, [], UNIT)).toHaveLength(0);
  });
});
