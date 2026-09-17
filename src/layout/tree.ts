import { Cell, Dir, Layout, LeafNode, Node, Rect, Seam, SplitNode, UNIT } from '../types';

let counter = 0;
export const uid = (prefix = 'n'): string => `${prefix}${(counter++).toString(36)}`;

export const leaf = (photoId: string): LeafNode => ({ kind: 'leaf', id: uid('l'), photoId });

export const split = (dir: Dir, a: Node, b: Node, ratio = 0.5): SplitNode => ({
  kind: 'split',
  id: uid('s'),
  dir,
  ratio,
  a,
  b,
});

/** Canvas size in layout units for a given aspect ratio. */
export function canvasSize(aspect: number): { w: number; h: number } {
  return aspect >= 1 ? { w: UNIT, h: UNIT / aspect } : { w: UNIT * aspect, h: UNIT };
}

const inset = (r: Rect, d: number): Rect => ({
  x: r.x + d,
  y: r.y + d,
  w: Math.max(1, r.w - 2 * d),
  h: Math.max(1, r.h - 2 * d),
});

/**
 * Turn a tree into concrete rectangles. Gutters are applied by insetting each
 * leaf half a gutter on every side, so spacing is even everywhere and a gutter
 * of 0 gives a seamless collage.
 */
export function computeLayout(
  root: Node | null,
  aspect: number,
  gutter: number,
  margin: number,
): Layout {
  const { w, h } = canvasSize(aspect);
  const cells: Cell[] = [];
  const seams: Seam[] = [];
  if (!root) return { w, h, cells, seams };

  const region: Rect = { x: margin, y: margin, w: Math.max(1, w - 2 * margin), h: Math.max(1, h - 2 * margin) };

  const walk = (node: Node, r: Rect): void => {
    if (node.kind === 'leaf') {
      cells.push({ leafId: node.id, photoId: node.photoId, rect: inset(r, gutter / 2) });
      return;
    }
    if (node.dir === 'row') {
      const aw = r.w * node.ratio;
      seams.push({
        nodeId: node.id,
        dir: node.dir,
        rect: { x: r.x + aw - gutter / 2, y: r.y, w: Math.max(gutter, 1), h: r.h },
        parent: r,
      });
      walk(node.a, { x: r.x, y: r.y, w: aw, h: r.h });
      walk(node.b, { x: r.x + aw, y: r.y, w: r.w - aw, h: r.h });
    } else {
      const ah = r.h * node.ratio;
      seams.push({
        nodeId: node.id,
        dir: node.dir,
        rect: { x: r.x, y: r.y + ah - gutter / 2, w: r.w, h: Math.max(gutter, 1) },
        parent: r,
      });
      walk(node.a, { x: r.x, y: r.y, w: r.w, h: ah });
      walk(node.b, { x: r.x, y: r.y + ah, w: r.w, h: r.h - ah });
    }
  };

  walk(root, region);
  return { w, h, cells, seams };
}

export function cellAt(layout: Layout, x: number, y: number): Cell | null {
  for (const c of layout.cells) {
    if (x >= c.rect.x && x <= c.rect.x + c.rect.w && y >= c.rect.y && y <= c.rect.y + c.rect.h) return c;
  }
  return null;
}

/** Seams win over cells when hit-testing, with `tol` units of slop either side. */
export function seamAt(layout: Layout, x: number, y: number, tol: number): Seam | null {
  let best: Seam | null = null;
  let bestDist = Infinity;
  for (const s of layout.seams) {
    const cx = s.rect.x + s.rect.w / 2;
    const cy = s.rect.y + s.rect.h / 2;
    const half = s.dir === 'row' ? Math.max(s.rect.w / 2, tol) : Math.max(s.rect.h / 2, tol);
    const along =
      s.dir === 'row'
        ? y >= s.rect.y - tol && y <= s.rect.y + s.rect.h + tol
        : x >= s.rect.x - tol && x <= s.rect.x + s.rect.w + tol;
    const across = s.dir === 'row' ? Math.abs(x - cx) : Math.abs(y - cy);
    if (along && across <= half && across < bestDist) {
      best = s;
      bestDist = across;
    }
  }
  return best;
}

export function mapNode(root: Node, id: string, fn: (n: Node) => Node): Node {
  if (root.id === id) return fn(root);
  if (root.kind === 'leaf') return root;
  const a = mapNode(root.a, id, fn);
  const b = mapNode(root.b, id, fn);
  return a === root.a && b === root.b ? root : { ...root, a, b };
}

export function setRatio(root: Node, nodeId: string, ratio: number): Node {
  return mapNode(root, nodeId, (n) => (n.kind === 'split' ? { ...n, ratio } : n));
}

export function leavesOf(root: Node | null): Node[] {
  if (!root) return [];
  return root.kind === 'leaf' ? [root] : [...leavesOf(root.a), ...leavesOf(root.b)];
}

export function photoIdsOf(root: Node | null): string[] {
  return leavesOf(root).map((n) => (n.kind === 'leaf' ? n.photoId : ''));
}

export function swapPhotos(root: Node, x: string, y: string): Node {
  const sub = (n: Node): Node => {
    if (n.kind === 'leaf') {
      if (n.photoId === x) return { ...n, photoId: y };
      if (n.photoId === y) return { ...n, photoId: x };
      return n;
    }
    return { ...n, a: sub(n.a), b: sub(n.b) };
  };
  return sub(root);
}

/** Drop a photo and collapse the split that held it, promoting its sibling. */
export function removePhoto(root: Node, photoId: string): Node | null {
  if (root.kind === 'leaf') return root.photoId === photoId ? null : root;
  const a = removePhoto(root.a, photoId);
  const b = removePhoto(root.b, photoId);
  if (!a) return b;
  if (!b) return a;
  return a === root.a && b === root.b ? root : { ...root, a, b };
}

/** Natural aspect of a subtree if nothing were cropped: widths add across a row,
 *  heights add down a column. This is what lets us pick ratios that crop nothing. */
export function naturalAspect(node: Node, aspectOf: (photoId: string) => number): number {
  if (node.kind === 'leaf') return aspectOf(node.photoId);
  const a = naturalAspect(node.a, aspectOf);
  const b = naturalAspect(node.b, aspectOf);
  return node.dir === 'row' ? a + b : 1 / (1 / a + 1 / b);
}

/** Rewrite every ratio so each cell matches its photo's shape as closely as the
 *  structure allows. The only cropping left is the global squeeze into the canvas. */
export function optimiseRatios(node: Node, aspectOf: (photoId: string) => number): Node {
  if (node.kind === 'leaf') return node;
  const a = optimiseRatios(node.a, aspectOf);
  const b = optimiseRatios(node.b, aspectOf);
  const aa = naturalAspect(a, aspectOf);
  const ab = naturalAspect(b, aspectOf);
  const total = aa + ab;
  const ratio = node.dir === 'row' ? aa / total : ab / total;
  return { ...node, a, b, ratio: clamp(ratio, 0.05, 0.95) };
}

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Structure fingerprint, used to keep the suggestion list visually varied. */
export function signature(node: Node): string {
  if (node.kind === 'leaf') return '.';
  return `(${node.dir === 'row' ? '|' : '-'}${signature(node.a)}${signature(node.b)})`;
}

/** A left-leaning chain of photos, which optimiseRatios turns into a justified row. */
export function chain(photoIds: string[], dir: Dir): Node {
  let node: Node = leaf(photoIds[0]);
  for (let i = 1; i < photoIds.length; i++) node = split(dir, node, leaf(photoIds[i]));
  return node;
}

/** The same, over ready-made subtrees. */
export function chainOf(nodes: Node[], dir: Dir): Node {
  let node = nodes[0];
  for (let i = 1; i < nodes.length; i++) node = split(dir, node, nodes[i]);
  return node;
}

/** Groups of consecutive photos become justified rows (or columns). */
export function fromComposition(ids: string[], parts: number[], groupDir: Dir): Node {
  const stackDir: Dir = groupDir === 'row' ? 'col' : 'row';
  const groups: Node[] = [];
  let i = 0;
  for (const size of parts) {
    groups.push(chain(ids.slice(i, i + size), groupDir));
    i += size;
  }
  return chainOf(groups, stackDir);
}

/**
 * Turn a row of photos into a column, or the other way round. The ratio is
 * re-solved from the children afterwards, because a ratio that balanced two
 * widths means something different once it is dividing heights.
 */
export function flipSplit(root: Node, nodeId: string, aspectOf: (photoId: string) => number): Node {
  return mapNode(root, nodeId, (n) => {
    if (n.kind !== 'split') return n;
    const dir: Dir = n.dir === 'row' ? 'col' : 'row';
    const aa = naturalAspect(n.a, aspectOf);
    const ab = naturalAspect(n.b, aspectOf);
    const ratio = clamp(dir === 'row' ? aa / (aa + ab) : ab / (aa + ab), 0.05, 0.95);
    return { ...n, dir, ratio };
  });
}

export function findNode(root: Node, id: string): Node | null {
  if (root.id === id) return root;
  if (root.kind === 'leaf') return null;
  return findNode(root.a, id) ?? findNode(root.b, id);
}
