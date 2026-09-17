/**
 * Sanity + tuning harness for the layout engine. Run it after changing the
 * scoring weights in src/layout/generate.ts:
 *
 *   npx esbuild scripts/layout-check.ts --bundle --format=esm --outfile=.tmp/check.mjs && node .tmp/check.mjs
 *
 * It prints, per photo set, how long generation took, how much of each photo the
 * best layout crops away, how starved the smallest cell is, and an ASCII map of
 * the arrangement. It is a report for judging layout quality by eye; the
 * pass/fail checks live in the test suite (`npm test`).
 */
import { generateLayouts, scoreTree } from '../src/layout/generate';
import { computeLayout } from '../src/layout/tree';
import { Node } from '../src/types';

interface Set {
  name: string;
  aspects: number[];
  canvas: number;
}

const L = 3 / 2; // landscape
const P = 2 / 3; // portrait
const S = 1; // square
const PANO = 3;
const TALL = 0.45;

const sets: Set[] = [
  { name: '2 landscape, square canvas', aspects: [L, L], canvas: 1 },
  { name: '3 mixed, square canvas', aspects: [L, P, L], canvas: 1 },
  { name: '4 portrait, square canvas', aspects: [P, P, P, P], canvas: 1 },
  { name: '5 mixed, 4:5 canvas', aspects: [L, P, S, L, P], canvas: 0.8 },
  { name: '6 landscape, 16:9 canvas', aspects: [L, L, L, L, L, L], canvas: 16 / 9 },
  { name: '7 mixed, square canvas', aspects: [L, P, S, L, P, S, L], canvas: 1 },
  { name: '9 mixed, square canvas', aspects: [L, P, S, L, P, S, L, P, S], canvas: 1 },
  { name: '12 mixed, 4:5 canvas', aspects: [L, P, S, L, P, S, L, P, S, L, P, S], canvas: 0.8 },
  { name: '20 mixed, square canvas', aspects: Array.from({ length: 20 }, (_, i) => [L, P, S, L, TALL][i % 5]), canvas: 1 },
  { name: 'panorama + 5 squares', aspects: [PANO, S, S, S, S, S], canvas: 1 },
  { name: '1 photo', aspects: [L], canvas: 1 },
];

function report(set: Set) {
  const photos = set.aspects.map((aspect, i) => ({ id: `p${i}`, aspect }));
  const aspectOf = (id: string) => photos.find((p) => p.id === id)!.aspect;

  const t0 = performance.now();
  const layouts = generateLayouts(photos, set.canvas, 5);
  const ms = performance.now() - t0;

  const best = layouts[0];
  const layout = computeLayout(best, set.canvas, 0, 0);
  const n = layout.cells.length;

  let worstCrop = 0;
  let minShare = Infinity;
  for (const c of layout.cells) {
    const cellAspect = c.rect.w / c.rect.h;
    const pa = aspectOf(c.photoId);
    worstCrop = Math.max(worstCrop, 1 - Math.min(cellAspect / pa, pa / cellAspect));
    minShare = Math.min(minShare, (c.rect.w * c.rect.h) / ((layout.w * layout.h) / n));
  }

  const ok = n === photos.length;
  console.log(
    `\n${set.name}\n  ${ms.toFixed(0)}ms · ${layouts.length} suggestions · cells ${n}${ok ? '' : ' <-- WRONG CELL COUNT'}` +
      `\n  worst crop ${(worstCrop * 100).toFixed(1)}% · smallest cell ${(minShare * 100).toFixed(0)}% of fair share` +
      `\n  scores ${layouts.map((l) => scoreTree(l, aspectOf, set.canvas).toFixed(3)).join('  ')}`,
  );
  console.log(ascii(best, set.canvas));
}

/** Rough character map of the arrangement, one letter per photo. */
function ascii(root: Node, canvasAspect: number, cols = 44): string {
  const layout = computeLayout(root, canvasAspect, 0, 0);
  const rows = Math.max(6, Math.round((cols * layout.h) / layout.w / 2.1));
  const letters = 'ABCDEFGHIJKLMNOPQRST';
  const index = new Map(layout.cells.map((c, i) => [c.photoId, letters[i] ?? '?']));
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    let line = '  |';
    for (let c = 0; c < cols; c++) {
      const x = ((c + 0.5) / cols) * layout.w;
      const y = ((r + 0.5) / rows) * layout.h;
      const cell = layout.cells.find(
        (k) => x >= k.rect.x && x <= k.rect.x + k.rect.w && y >= k.rect.y && y <= k.rect.y + k.rect.h,
      );
      line += cell ? index.get(cell.photoId) : ' ';
    }
    lines.push(line + '|');
  }
  return lines.join('\n');
}

sets.forEach(report);
