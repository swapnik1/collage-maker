import { describe, expect, it } from 'vitest';
import { Rect, Transform } from '../types';
import { coverScale, placePhoto, scaleRect } from './draw';

const cells: Rect[] = [
  { x: 0, y: 0, w: 100, h: 100 },
  { x: 10, y: 20, w: 300, h: 80 },
  { x: 0, y: 0, w: 60, h: 400 },
  { x: 5, y: 5, w: 640, h: 360 },
];
const photos: [number, number][] = [
  [1600, 1067],
  [900, 1350],
  [2400, 820],
  [1000, 1000],
];

const t = (zoom: number, panX = 0, panY = 0): Transform => ({ zoom, panX, panY });

function covers(cell: Rect, p: ReturnType<typeof placePhoto>) {
  return (
    p.dx <= cell.x + 1e-6 &&
    p.dy <= cell.y + 1e-6 &&
    p.dx + p.dw >= cell.x + cell.w - 1e-6 &&
    p.dy + p.dh >= cell.y + cell.h - 1e-6
  );
}

describe('coverScale', () => {
  it('is the scale at which the photo just covers the cell', () => {
    expect(coverScale({ x: 0, y: 0, w: 100, h: 100 }, 200, 100)).toBeCloseTo(1, 9);
    expect(coverScale({ x: 0, y: 0, w: 100, h: 50 }, 200, 200)).toBeCloseTo(0.5, 9);
  });
});

describe('placePhoto', () => {
  it('always covers the cell, at every zoom and pan extreme (R5.3)', () => {
    for (const cell of cells) {
      for (const [pw, ph] of photos) {
        for (const zoom of [1, 1.001, 1.4, 3, 5]) {
          for (const pan of [-0.5, -0.2, 0, 0.35, 0.5]) {
            const placed = placePhoto(cell, pw, ph, t(zoom, pan, -pan));
            expect(covers(cell, placed), `cell ${cell.w}x${cell.h} photo ${pw}x${ph} zoom ${zoom} pan ${pan}`).toBe(true);
          }
        }
      }
    }
  });

  it('clamps pan beyond the legal range rather than letting a gap in', () => {
    const cell = cells[0];
    const wild = placePhoto(cell, 1600, 1067, t(1.5, 9, -9));
    const edge = placePhoto(cell, 1600, 1067, t(1.5, 0.5, -0.5));
    expect(wild.dx).toBeCloseTo(edge.dx, 9);
    expect(wild.dy).toBeCloseTo(edge.dy, 9);
    expect(covers(cell, wild)).toBe(true);
  });

  it('treats a zoom below 1 as cover-fit, never smaller', () => {
    const cell = cells[1];
    const under = placePhoto(cell, 1600, 1067, t(0.2));
    const fit = placePhoto(cell, 1600, 1067, t(1));
    expect(under.dw).toBeCloseTo(fit.dw, 9);
    expect(covers(cell, under)).toBe(true);
  });

  it('centres the photo at pan zero', () => {
    const cell = cells[1];
    const p = placePhoto(cell, 2400, 820, t(1));
    expect(p.dx + p.dw / 2).toBeCloseTo(cell.x + cell.w / 2, 6);
    expect(p.dy + p.dh / 2).toBeCloseTo(cell.y + cell.h / 2, 6);
  });

  it('hides more of the photo as zoom goes up', () => {
    const cell = cells[3];
    const one = placePhoto(cell, 1600, 1067, t(1));
    const two = placePhoto(cell, 1600, 1067, t(2));
    expect(two.overflowX).toBeGreaterThan(one.overflowX);
    expect(two.overflowY).toBeGreaterThan(one.overflowY);
  });

  it('keeps the photo the same size on screen when its cell shrinks (R4.3)', () => {
    const before: Rect = { x: 0, y: 0, w: 400, h: 300 };
    const after: Rect = { x: 0, y: 0, w: 260, h: 300 };
    const [pw, ph] = [1600, 1067];
    const startZoom = 1.2;

    const absoluteBefore = coverScale(before, pw, ph) * startZoom;
    const newZoom = Math.max(1, absoluteBefore / coverScale(after, pw, ph));
    const placedBefore = placePhoto(before, pw, ph, t(startZoom));
    const placedAfter = placePhoto(after, pw, ph, t(newZoom));

    expect(placedAfter.dw).toBeCloseTo(placedBefore.dw, 6);
    expect(placedAfter.dh).toBeCloseTo(placedBefore.dh, 6);
    // Same photo size, smaller window onto it.
    expect(placedAfter.overflowX).toBeGreaterThan(placedBefore.overflowX);
  });

  it('scales with its cell, so framing survives a resolution change', () => {
    const cell: Rect = { x: 10, y: 10, w: 200, h: 150 };
    const framing = t(1.6, 0.3, -0.2);
    const small = placePhoto(cell, 1600, 1067, framing);
    const big = placePhoto(scaleRect(cell, 4), 1600, 1067, framing);
    expect(big.dx / 4).toBeCloseTo(small.dx, 6);
    expect(big.dw / 4).toBeCloseTo(small.dw, 6);
  });
});

describe('scaleRect', () => {
  it('multiplies every side', () => {
    expect(scaleRect({ x: 1, y: 2, w: 3, h: 4 }, 2.5)).toEqual({ x: 2.5, y: 5, w: 7.5, h: 10 });
  });
});
