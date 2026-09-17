import { Dir, Node } from '../types';
import { chain, clamp, computeLayout, fromComposition, leaf, optimiseRatios, signature, split } from './tree';

export interface PhotoShape {
  id: string;
  aspect: number;
}

/**
 * Scoring weights. This function is the product: whether the first suggestion is
 * good enough to accept untouched lives entirely here. Tune against real sets.
 */
const W = {
  /** Average share of each photo hidden by its cell. */
  cropMean: 1.0,
  /** The worst-treated photo, so one mangled photo cannot hide behind a good average. */
  cropWorst: 0.6,
  /** Spread of cell areas. Low weight, so a hero photo is allowed, just not preferred. */
  balance: 0.45,
  /** Starved cells. Heavy, because a postage-stamp cell ruins a collage. */
  starved: 1.6,
  /** Sliver-shaped cells, which look wrong even when the photo happens to fit. */
  extreme: 0.15,
};

const MAX_CANDIDATES = 12000;

/** Deterministic PRNG so the same photos always produce the same suggestions (R2.5). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function scoreTree(
  root: Node,
  aspectOf: (photoId: string) => number,
  canvasAspect: number,
): number {
  const layout = computeLayout(root, canvasAspect, 0, 0);
  const n = layout.cells.length;
  if (n === 0) return Infinity;

  let cropSum = 0;
  let cropWorst = 0;
  let extreme = 0;
  const areas: number[] = [];

  for (const c of layout.cells) {
    const cellAspect = c.rect.w / c.rect.h;
    const photoAspect = aspectOf(c.photoId);
    // Cover-fitting keeps the smaller of the two ratios; the rest is cropped away.
    const visible = Math.min(cellAspect / photoAspect, photoAspect / cellAspect);
    const loss = 1 - visible;
    cropSum += loss;
    if (loss > cropWorst) cropWorst = loss;
    const shape = Math.max(cellAspect, 1 / cellAspect);
    if (shape > 2.8) extreme += (shape - 2.8) * W.extreme;
    areas.push(c.rect.w * c.rect.h);
  }

  const fairShare = (layout.w * layout.h) / n;
  const shares = areas.map((a) => a / fairShare);
  const variance = shares.reduce((s, v) => s + (v - 1) ** 2, 0) / n;
  const starved = Math.max(0, 0.45 - Math.min(...shares));

  return (
    W.cropMean * (cropSum / n) +
    W.cropWorst * cropWorst +
    W.balance * Math.sqrt(variance) +
    W.starved * starved +
    extreme
  );
}

function compositions(n: number, k: number, rnd: () => number, samples: number): number[][] {
  const seen = new Set<string>();
  const out: number[][] = [];
  const push = (c: number[]) => {
    const key = c.join('-');
    if (!seen.has(key)) {
      seen.add(key);
      out.push(c);
    }
  };

  const base = Math.floor(n / k);
  const rem = n % k;
  for (let shift = 0; shift < k; shift++) {
    const c: number[] = [];
    for (let i = 0; i < k; i++) c.push(base + (((i + shift) % k) < rem ? 1 : 0));
    push(c);
  }

  const maxPer = Math.min(n, Math.max(2, Math.ceil(n / k) + 2));
  for (let t = 0; t < samples; t++) {
    const c = new Array<number>(k).fill(1);
    let left = n - k;
    let guard = 0;
    while (left > 0 && guard++ < 500) {
      const i = Math.floor(rnd() * k);
      if (c[i] < maxPer) {
        c[i]++;
        left--;
      }
    }
    if (left === 0) push(c);
  }
  return out;
}

function randomTree(ids: string[], rnd: () => number): Node {
  if (ids.length === 1) return leaf(ids[0]);
  const mid = ids.length / 2;
  const k = Math.round(clamp(mid + (rnd() - 0.5) * ids.length * 0.7, 1, ids.length - 1));
  const dir: Dir = rnd() < 0.5 ? 'row' : 'col';
  return split(dir, randomTree(ids.slice(0, k), rnd), randomTree(ids.slice(k), rnd));
}

function allTrees(ids: string[], budget: { left: number }): Node[] {
  if (ids.length === 1) return [leaf(ids[0])];
  const out: Node[] = [];
  for (let k = 1; k < ids.length && budget.left > 0; k++) {
    const lefts = allTrees(ids.slice(0, k), budget);
    const rights = allTrees(ids.slice(k), budget);
    for (const l of lefts) {
      for (const r of rights) {
        out.push(split('row', l, r), split('col', l, r));
        budget.left -= 2;
        if (budget.left <= 0) return out;
      }
    }
  }
  return out;
}

/** Candidate structures, before ratios are optimised. */
function candidateTrees(ids: string[], rnd: () => number): Node[] {
  const n = ids.length;
  if (n === 1) return [leaf(ids[0])];
  if (n === 2) {
    return [split('row', leaf(ids[0]), leaf(ids[1])), split('col', leaf(ids[0]), leaf(ids[1]))];
  }

  if (n <= 6) {
    // Small sets are cheap to enumerate exhaustively, and that is where the good
    // asymmetric arrangements come from: one big photo with two stacked beside it.
    return allTrees(ids, { left: MAX_CANDIDATES });
  }

  const trees: Node[] = [];

  // Rows of photos, and the transpose.
  for (let k = 2; k <= Math.min(7, n - 1); k++) {
    for (const parts of compositions(n, k, rnd, 120)) {
      trees.push(fromComposition(ids, parts, 'row'));
      trees.push(fromComposition(ids, parts, 'col'));
    }
  }

  // Hero arrangements: one photo takes a whole side, the rest grid up beside it.
  for (const heroIdx of [0, n - 1]) {
    const hero = leaf(ids[heroIdx]);
    const rest = ids.filter((_, i) => i !== heroIdx);
    for (let k = 1; k <= Math.min(5, rest.length); k++) {
      for (const parts of compositions(rest.length, k, rnd, 8)) {
        for (const inner of ['row', 'col'] as Dir[]) {
          const restTree = fromComposition(rest, parts, inner);
          for (const dir of ['row', 'col'] as Dir[]) {
            trees.push(heroIdx === 0 ? split(dir, hero, restTree) : split(dir, restTree, hero));
          }
        }
      }
    }
  }

  // Seeded random trees, for structures the families above never produce.
  for (let i = 0; i < 600; i++) trees.push(randomTree(ids, rnd));

  return trees.slice(0, MAX_CANDIDATES);
}

/**
 * Ranked layout suggestions for these photos at this canvas aspect. Photo order
 * is preserved; the cells adapt their shape to the photos rather than the other
 * way round, which is what keeps portraits out of landscape slots.
 */
export function generateLayouts(photos: PhotoShape[], canvasAspect: number, count = 5): Node[] {
  if (photos.length === 0) return [];
  const aspects = new Map(photos.map((p) => [p.id, p.aspect]));
  const aspectOf = (id: string) => aspects.get(id) ?? 1;
  const ids = photos.map((p) => p.id);
  if (ids.length === 1) return [leaf(ids[0])];

  const rnd = mulberry32(0x5eed);
  const scored = candidateTrees(ids, rnd)
    .map((t) => {
      const root = optimiseRatios(t, aspectOf);
      return { root, score: scoreTree(root, aspectOf, canvasAspect), sig: signature(root) };
    })
    .sort((x, y) => x.score - y.score);

  const picked: Node[] = [];
  const seen = new Set<string>();
  for (const cand of scored) {
    if (seen.has(cand.sig)) continue;
    seen.add(cand.sig);
    picked.push(cand.root);
    if (picked.length >= count) break;
  }

  if (picked.length === 0) picked.push(optimiseRatios(chain(ids, 'row'), aspectOf));
  return picked;
}
