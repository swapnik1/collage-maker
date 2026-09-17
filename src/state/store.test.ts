import { describe, expect, it } from 'vitest';
import { Action, AppState, INITIAL, reducer } from './store';
import { Photo } from '../types';
import { computeLayout, findNode, photoIdsOf, signature } from '../layout/tree';

function photo(id: string, width = 1600, height = 1067): Photo {
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

const run = (state: AppState, ...actions: Action[]) => actions.reduce(reducer, state);

/** A session with `n` photos already imported and laid out. */
function loaded(n: number): AppState {
  const photos = Array.from({ length: n }, (_, i) => photo(`p${i}`, ...(i % 2 ? [900, 1350] : [1600, 1067]) as [number, number]));
  return run(INITIAL, { type: 'add-photos', photos });
}

const cellIds = (state: AppState) => photoIdsOf(state.doc.root);

describe('importing', () => {
  it('lays out the photos and selects the best suggestion', () => {
    const state = loaded(5);
    expect(state.photos).toHaveLength(5);
    expect(state.doc.order).toEqual(['p0', 'p1', 'p2', 'p3', 'p4']);
    expect(cellIds(state)).toHaveLength(5);
    expect(state.picked).toBe('s:0');
    expect(state.adjusted).toBe(false);
    expect(state.suggestions.length).toBeGreaterThan(1);
    expect(state.templates.length).toBeGreaterThan(1);
  });

  it('adds to what is already there', () => {
    const state = run(loaded(3), { type: 'add-photos', photos: [photo('x'), photo('y')] });
    expect(state.photos).toHaveLength(5);
    expect(state.doc.order.slice(-2)).toEqual(['x', 'y']);
    expect(cellIds(state)).toHaveLength(5);
  });

  it('reports skipped files without changing the layout', () => {
    const before = loaded(3);
    const after = run(before, { type: 'add-photos', photos: [], skipped: [{ name: 'notes.txt', reason: 'not an image' }] });
    expect(after.notices[0]).toContain('notes.txt');
    expect(after.doc.root).toBe(before.doc.root);
  });
});

describe('removing a photo', () => {
  it('drops one cell and keeps the others', () => {
    const state = run(loaded(5), { type: 'remove-photo', photoId: 'p2' });
    expect(state.photos.map((p) => p.id)).toEqual(['p0', 'p1', 'p3', 'p4']);
    expect(state.doc.order).toEqual(['p0', 'p1', 'p3', 'p4']);
    expect(cellIds(state)).toEqual(['p0', 'p1', 'p3', 'p4']);
  });

  it('keeps manual adjustments instead of re-running the layout', () => {
    const adjusted = run(loaded(5), { type: 'begin' });
    const root = adjusted.doc.root!;
    if (root.kind !== 'split') throw new Error('expected a split');
    const dragged = run(adjusted, { type: 'drag-seam', nodeId: root.id, ratio: 0.31 });
    const after = run(dragged, { type: 'remove-photo', photoId: 'p4' });
    const stillThere = findNode(after.doc.root!, root.id);
    // The seam the user moved is either still at their ratio or was the one collapsed.
    if (stillThere && stillThere.kind === 'split') expect(stillThere.ratio).toBeCloseTo(0.31, 9);
    expect(cellIds(after)).toHaveLength(4);
  });

  it('clears the selection when the selected photo goes', () => {
    const state = run(loaded(3), { type: 'select', photoId: 'p1' }, { type: 'remove-photo', photoId: 'p1' });
    expect(state.selected).toBeNull();
  });

  it('empties the layout when the last photo goes', () => {
    const state = run(loaded(1), { type: 'remove-photo', photoId: 'p0' });
    expect(state.doc.root).toBeNull();
    expect(state.photos).toHaveLength(0);
  });
});

describe('choosing a layout', () => {
  it('applies a suggestion and records which one', () => {
    const state = run(loaded(6), { type: 'pick-suggestion', index: 2 });
    expect(state.picked).toBe('s:2');
    expect(state.adjusted).toBe(false);
    expect(signature(state.doc.root!)).toBe(signature(state.suggestions[2]));
  });

  it('applies a template and records which one', () => {
    const base = loaded(6);
    const template = base.templates.find((t) => t.key === 'hero-left')!;
    const state = run(base, { type: 'pick-template', key: 'hero-left' });
    expect(state.picked).toBe('t:hero-left');
    expect(signature(state.doc.root!)).toBe(signature(template.root));
    expect(cellIds(state)).toHaveLength(6);
  });

  it('ignores a template or suggestion that is not there', () => {
    const base = loaded(4);
    expect(run(base, { type: 'pick-template', key: 'nope' })).toBe(base);
    expect(run(base, { type: 'pick-suggestion', index: 99 })).toBe(base);
  });

  it('auto-arrange goes back to the best suggestion', () => {
    const state = run(loaded(6), { type: 'pick-template', key: 'stack' }, { type: 'auto-arrange' });
    expect(state.picked).toBe('s:0');
    expect(state.adjusted).toBe(false);
  });

  it('re-applies the chosen template after a reorder', () => {
    const state = run(loaded(6), { type: 'pick-template', key: 'hero-left' }, { type: 'reorder', from: 0, to: 3 });
    expect(state.doc.order[3]).toBe('p0');
    expect(state.picked).toBe('t:hero-left');
    expect(cellIds(state)).toHaveLength(6);
  });
});

describe('editing the layout', () => {
  it('flips a seam and marks the layout as adjusted', () => {
    const base = loaded(5);
    const root = base.doc.root!;
    if (root.kind !== 'split') throw new Error('expected a split');
    const state = run(base, { type: 'flip-seam', nodeId: root.id });
    const flipped = state.doc.root!;
    if (flipped.kind !== 'split') throw new Error('expected a split');
    expect(flipped.dir).not.toBe(root.dir);
    expect(state.adjusted).toBe(true);
    expect(cellIds(state)).toHaveLength(5);
  });

  it('dragging a seam changes only that ratio', () => {
    const base = loaded(5);
    const root = base.doc.root!;
    if (root.kind !== 'split') throw new Error('expected a split');
    const state = run(base, { type: 'begin' }, { type: 'drag-seam', nodeId: root.id, ratio: 0.2 });
    const after = state.doc.root!;
    if (after.kind !== 'split') throw new Error('expected a split');
    expect(after.ratio).toBe(0.2);
    expect(signature(after)).toBe(signature(root));
    expect(state.adjusted).toBe(true);
  });

  it('swaps two photos between their cells', () => {
    const base = loaded(4);
    const before = cellIds(base);
    const state = run(base, { type: 'swap', a: before[0], b: before[2] });
    const after = cellIds(state);
    expect(after[0]).toBe(before[2]);
    expect(after[2]).toBe(before[0]);
  });

  it('cropping changes the canvas shape and keeps every photo', () => {
    const state = run(loaded(6), { type: 'crop', aspect: 16 / 9 });
    expect(state.doc.canvas.aspect).toBeCloseTo(16 / 9, 9);
    expect(state.adjusted).toBe(true);
    expect(computeLayout(state.doc.root, state.doc.canvas.aspect, 10, 10).cells).toHaveLength(6);
  });

  it('changing shape keeps a hand-built arrangement, with a word about it', () => {
    const base = loaded(6);
    const root = base.doc.root!;
    if (root.kind !== 'split') throw new Error('expected a split');
    const adjusted = run(base, { type: 'begin' }, { type: 'drag-seam', nodeId: root.id, ratio: 0.28 });
    const state = run(adjusted, { type: 'set-canvas', patch: { aspect: 4 / 5, aspectLabel: '4:5' } });
    expect(signature(state.doc.root!)).toBe(signature(adjusted.doc.root!));
    expect(state.notices).toHaveLength(1);
  });

  it('changing shape re-runs the layout when nothing was adjusted', () => {
    const state = run(loaded(6), { type: 'set-canvas', patch: { aspect: 16 / 9, aspectLabel: '16:9' } });
    expect(state.notices).toHaveLength(0);
    expect(cellIds(state)).toHaveLength(6);
  });

  it('spacing changes do not disturb the layout', () => {
    const base = loaded(4);
    const state = run(base, { type: 'set-canvas', patch: { gutter: 30 } });
    expect(state.doc.canvas.gutter).toBe(30);
    expect(signature(state.doc.root!)).toBe(signature(base.doc.root!));
  });
});

describe('undo and redo', () => {
  it('walks back and forward through changes', () => {
    const base = loaded(5);
    const cropped = run(base, { type: 'crop', aspect: 16 / 9 });
    const undone = run(cropped, { type: 'undo' });
    expect(undone.doc.canvas.aspect).toBe(base.doc.canvas.aspect);
    const redone = run(undone, { type: 'redo' });
    expect(redone.doc.canvas.aspect).toBeCloseTo(16 / 9, 9);
  });

  it('does nothing at either end of the history', () => {
    const base = loaded(3);
    expect(run(base, { type: 'redo' })).toBe(base);
    const emptied = run(INITIAL, { type: 'undo' });
    expect(emptied).toBe(INITIAL);
  });

  it('a whole drag gesture is one step', () => {
    const base = loaded(5);
    const root = base.doc.root!;
    if (root.kind !== 'split') throw new Error('expected a split');
    const dragged = run(
      base,
      { type: 'begin' },
      { type: 'drag-seam', nodeId: root.id, ratio: 0.3 },
      { type: 'drag-seam', nodeId: root.id, ratio: 0.35 },
      { type: 'drag-seam', nodeId: root.id, ratio: 0.4 },
      { type: 'end' },
    );
    expect(dragged.past).toHaveLength(base.past.length + 1);
    const undone = run(dragged, { type: 'undo' });
    const after = undone.doc.root!;
    if (after.kind !== 'split') throw new Error('expected a split');
    expect(after.ratio).toBe(root.ratio);
  });

  it('a gesture that changes nothing leaves no step behind', () => {
    const base = loaded(4);
    const state = run(base, { type: 'begin' }, { type: 'end' });
    expect(state.past).toHaveLength(base.past.length);
    expect(state.pending).toBeNull();
  });

  it('a new change clears the redo stack', () => {
    const base = loaded(4);
    const state = run(base, { type: 'crop', aspect: 2 }, { type: 'undo' }, { type: 'crop', aspect: 0.5 });
    expect(state.future).toHaveLength(0);
  });

  it('keeps the history bounded', () => {
    let state = loaded(3);
    for (let i = 0; i < 80; i++) state = run(state, { type: 'crop', aspect: 1 + i / 100 });
    expect(state.past.length).toBeLessThanOrEqual(50);
  });
});

describe('starting over', () => {
  it('clears the photos but keeps the canvas settings', () => {
    const state = run(loaded(4), { type: 'set-canvas', patch: { background: '#000000' } }, { type: 'clear' });
    expect(state.photos).toHaveLength(0);
    expect(state.doc.root).toBeNull();
    expect(state.doc.canvas.background).toBe('#000000');
  });

  it('restoring a session rebuilds the candidate lists', () => {
    const saved = loaded(6);
    const state = run(INITIAL, { type: 'restore', photos: saved.photos, doc: saved.doc });
    expect(state.suggestions.length).toBeGreaterThan(1);
    expect(state.templates.length).toBeGreaterThan(1);
    expect(state.past).toHaveLength(0);
    expect(cellIds(state)).toHaveLength(6);
  });
});
