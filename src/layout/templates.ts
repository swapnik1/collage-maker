import { Dir, Node } from '../types';
import { chain, chainOf, fromComposition, optimiseRatios, signature, split, leaf } from './tree';
import { PhotoShape } from './generate';

export interface Template {
  key: string;
  name: string;
  root: Node;
}

/** Parts as equal as possible: 7 into 3 gives [3, 2, 2]. */
function balanced(n: number, k: number): number[] {
  const base = Math.floor(n / k);
  const rem = n % k;
  return Array.from({ length: k }, (_, i) => base + (i < rem ? 1 : 0));
}

/** Fixed-size groups with the remainder trailing: 7 by 3 gives [3, 3, 1]. */
function chunks(n: number, size: number): number[] {
  const out: number[] = [];
  for (let left = n; left > 0; left -= size) out.push(Math.min(size, left));
  return out;
}

/** The first photo takes one whole side; the rest arrange themselves beside it. */
function hero(ids: string[], where: 'left' | 'right' | 'top' | 'bottom'): Node {
  const rest = ids.slice(1);
  const big = leaf(ids[0]);
  const beside = where === 'left' || where === 'right';

  let restTree: Node;
  if (rest.length === 1) {
    restTree = leaf(rest[0]);
  } else if (beside) {
    // A column running down one side: one photo per row until that gets too thin.
    restTree = fromComposition(rest, chunks(rest.length, rest.length > 5 ? 2 : 1), 'row');
  } else {
    // A band across the canvas: a single row until that gets too thin.
    restTree = fromComposition(rest, balanced(rest.length, rest.length > 6 ? 2 : 1), 'row');
  }

  const dir: Dir = beside ? 'row' : 'col';
  return where === 'left' || where === 'top' ? split(dir, big, restTree) : split(dir, restTree, big);
}

/**
 * Named structures the user can reach for directly, when none of the scored
 * suggestions is the shape they had in mind. Only the ones that make sense for
 * this many photos are offered.
 */
export function templatesFor(photos: PhotoShape[], canvasAspect: number): Template[] {
  const ids = photos.map((p) => p.id);
  const n = ids.length;
  if (n < 2) return [];

  const aspects = new Map(photos.map((p) => [p.id, p.aspect]));
  const aspectOf = (id: string) => aspects.get(id) ?? 1;
  const out: Template[] = [];
  const add = (key: string, name: string, root: Node) => out.push({ key, name, root });

  // As square a grid as the canvas shape allows.
  const cols = Math.max(1, Math.round(Math.sqrt(n * canvasAspect)));
  const rows = Math.max(1, Math.ceil(n / cols));
  if (rows > 1 && rows < n) add('grid', 'Grid', fromComposition(ids, balanced(n, rows), 'row'));

  if (n <= 6) {
    add('strip', 'Side by side', chain(ids, 'row'));
    add('stack', 'Stacked', chain(ids, 'col'));
  }

  for (const k of [2, 3, 4]) {
    if (n > k && Math.ceil(n / k) > 1) {
      add(`rows${k}`, `Rows of ${k}`, fromComposition(ids, chunks(n, k), 'row'));
      add(`cols${k}`, `Columns of ${k}`, fromComposition(ids, chunks(n, k), 'col'));
    }
  }

  if (n >= 3) {
    add('hero-left', 'Hero left', hero(ids, 'left'));
    add('hero-right', 'Hero right', hero(ids, 'right'));
    add('hero-top', 'Hero top', hero(ids, 'top'));
    add('hero-bottom', 'Hero bottom', hero(ids, 'bottom'));
  }

  // Two nested bands, which reads differently from a plain grid at higher counts.
  if (n >= 6) {
    const half = Math.ceil(n / 2);
    add(
      'bands',
      'Two bands',
      chainOf(
        [
          fromComposition(ids.slice(0, half), chunks(half, Math.ceil(half / 2)), 'row'),
          fromComposition(ids.slice(half), chunks(n - half, Math.ceil((n - half) / 2)), 'row'),
        ],
        'col',
      ),
    );
  }

  const seen = new Set<string>();
  return out
    .map((t) => ({ ...t, root: optimiseRatios(t.root, aspectOf) }))
    .filter((t) => {
      const sig = signature(t.root);
      if (seen.has(sig)) return false;
      seen.add(sig);
      return true;
    });
}
