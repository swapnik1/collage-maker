/**
 * Sanity + tuning harness for the layout engine. Run it after changing the
 * scoring weights in src/layout/generate.ts:
 *
 *   npx esbuild scripts/layout-check.ts --bundle --format=esm --outfile=.tmp/check.mjs && node .tmp/check.mjs
 *
 * It prints, per photo set, how long generation took, how much of each photo the
 * best layout crops away, how starved the smallest cell is, and an ASCII map of
 * the arrangement.
 */
import { generateLayouts, scoreTree } from '../src/layout/generate';
import { computeLayout, removePhoto, setRatio, signature } from '../src/layout/tree';
import { coverScale, placePhoto } from '../src/render/draw';
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

// ---------------------------------------------------------------- assertions

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('\n\nassertions');

// R5.3 — a photo always covers its cell, at any zoom and at either pan extreme.
{
  const cells = [
    { x: 0, y: 0, w: 100, h: 100 },
    { x: 10, y: 20, w: 300, h: 80 },
    { x: 0, y: 0, w: 60, h: 400 },
  ];
  const photos = [
    [1600, 1067],
    [900, 1350],
    [2400, 820],
    [1000, 1000],
  ];
  for (const cell of cells) {
    for (const [pw, ph] of photos) {
      for (const zoom of [1, 1.4, 3]) {
        for (const pan of [-0.5, -0.2, 0, 0.35, 0.5]) {
          const p = placePhoto(cell, pw, ph, { zoom, panX: pan, panY: -pan });
          const gap = Math.max(
            cell.x - p.dx,
            cell.y - p.dy,
            p.dx + p.dw - (cell.x + cell.w),
            p.dy + p.dh - (cell.y + cell.h),
          );
          check(
            'photo covers its cell',
            p.dx <= cell.x + 1e-6 &&
              p.dy <= cell.y + 1e-6 &&
              p.dx + p.dw >= cell.x + cell.w - 1e-6 &&
              p.dy + p.dh >= cell.y + cell.h - 1e-6,
            `cell ${cell.w}x${cell.h} photo ${pw}x${ph} zoom ${zoom} pan ${pan} gap ${gap.toFixed(3)}`,
          );
        }
      }
    }
  }
  console.log('  photo always covers its cell at every zoom and pan extreme');
}

// R4.3 — when a cell shrinks, the photo keeps its on-screen size and shows less.
{
  const before = { x: 0, y: 0, w: 400, h: 300 };
  const after = { x: 0, y: 0, w: 260, h: 300 };
  const [pw, ph] = [1600, 1067];
  const startZoom = 1.2;
  const absBefore = coverScale(before, pw, ph) * startZoom;
  const newZoom = Math.max(1, absBefore / coverScale(after, pw, ph));
  const absAfter = coverScale(after, pw, ph) * newZoom;
  check('shrinking a cell preserves the photo scale', Math.abs(absBefore - absAfter) < 1e-9,
    `${absBefore} vs ${absAfter}`);
  const visibleBefore = (before.w * before.h) / (pw * ph * absBefore * absBefore);
  const visibleAfter = (after.w * after.h) / (pw * ph * absAfter * absAfter);
  check('a smaller cell reveals less of the photo', visibleAfter < visibleBefore);
  console.log('  a shrinking cell keeps its photo scale and simply reveals less');
}

// R6.2/R6.3 — cropping changes the canvas shape without losing cells.
{
  const photos = [L, P, S, L, P, S, L].map((aspect, i) => ({ id: `p${i}`, aspect }));
  const root = generateLayouts(photos, 1, 1)[0];
  const square = computeLayout(root, 1, 10, 10);
  const wide = computeLayout(root, 16 / 9, 10, 10);
  check('crop keeps every cell', square.cells.length === wide.cells.length);
  check(
    'crop keeps every photo',
    square.cells.every((c, i) => c.photoId === wide.cells[i].photoId),
  );
  check('crop changes the canvas shape', Math.abs(wide.w / wide.h - 16 / 9) < 1e-9);
  console.log('  reflowing into a new shape keeps every photo');
}

// R1.4 — removing a photo collapses its split and leaves the rest untouched.
{
  const photos = [L, P, S, L, P].map((aspect, i) => ({ id: `p${i}`, aspect }));
  const root = generateLayouts(photos, 1, 1)[0];
  const trimmed = removePhoto(root, 'p2');
  const ids = trimmed ? computeLayout(trimmed, 1, 0, 0).cells.map((c) => c.photoId) : [];
  check('removing a photo drops exactly one cell', ids.length === 4, `got ${ids.length}`);
  check('removing a photo keeps the others', !ids.includes('p2') && ids.includes('p0') && ids.includes('p4'));
  const single = removePhoto({ kind: 'leaf', id: 'x', photoId: 'only' }, 'only');
  check('removing the last photo empties the tree', single === null);
  console.log('  removing a photo collapses its split and keeps the rest');
}

// R2.5 — the same photos always produce the same suggestions.
{
  const photos = [L, P, S, L, P, S, L, P, S].map((aspect, i) => ({ id: `p${i}`, aspect }));
  const a = generateLayouts(photos, 1, 5).map(signature);
  const b = generateLayouts(photos, 1, 5).map(signature);
  check('suggestions are deterministic', a.join('|') === b.join('|'));
  check('suggestions are distinct', new Set(a).size === a.length);
  console.log('  suggestions are deterministic and structurally distinct');
}

// R4.4 — an extreme seam ratio is detectable as a starved cell, so the drag can refuse it.
{
  const photos = [L, P, S, L].map((aspect, i) => ({ id: `p${i}`, aspect }));
  const root = generateLayouts(photos, 1, 1)[0];
  if (root.kind === 'split') {
    const starved = computeLayout(setRatio(root, root.id, 0.01), 1, 0, 0);
    check(
      'a starved cell is detectable',
      starved.cells.some((c) => c.rect.w < starved.w * 0.05 || c.rect.h < starved.h * 0.05),
    );
  }
  console.log('  starved cells are detectable, so seam drags can refuse them');
}

console.log(failures === 0 ? '\nall assertions passed\n' : `\n${failures} ASSERTION FAILURE(S)\n`);
if (failures > 0) process.exitCode = 1;
