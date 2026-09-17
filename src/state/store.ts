import { CanvasSettings, Doc, IDENTITY, Node, Photo, Transform } from '../types';
import { generateLayouts } from '../layout/generate';
import { removePhoto, setRatio, swapPhotos } from '../layout/tree';

export const ASPECTS: { label: string; value: number }[] = [
  { label: '1:1', value: 1 },
  { label: '4:5', value: 4 / 5 },
  { label: '5:4', value: 5 / 4 },
  { label: '2:3', value: 2 / 3 },
  { label: '3:2', value: 3 / 2 },
  { label: '9:16', value: 9 / 16 },
  { label: '16:9', value: 16 / 9 },
];

export const DEFAULT_CANVAS: CanvasSettings = {
  aspect: 1,
  aspectLabel: '1:1',
  gutter: 10,
  margin: 10,
  radius: 0,
  background: '#ffffff',
};

export const EMPTY_DOC: Doc = {
  root: null,
  order: [],
  transforms: {},
  canvas: DEFAULT_CANVAS,
};

export interface AppState {
  photos: Photo[];
  doc: Doc;
  past: Doc[];
  future: Doc[];
  /** Snapshot taken at the start of a drag, pushed only if the drag changes something. */
  pending: Doc | null;
  selected: string | null;
  suggestions: Node[];
  suggestionIndex: number;
  /** True once the user has moved a seam or cropped, so we know when a re-layout costs work. */
  adjusted: boolean;
  notices: string[];
}

export const INITIAL: AppState = {
  photos: [],
  doc: EMPTY_DOC,
  past: [],
  future: [],
  pending: null,
  selected: null,
  suggestions: [],
  suggestionIndex: 0,
  adjusted: false,
  notices: [],
};

export type Action =
  | { type: 'add-photos'; photos: Photo[]; skipped?: { name: string; reason: string }[] }
  | { type: 'remove-photo'; photoId: string }
  | { type: 'reorder'; from: number; to: number }
  | { type: 'pick-suggestion'; index: number }
  | { type: 'auto-arrange' }
  | { type: 'set-canvas'; patch: Partial<CanvasSettings> }
  | { type: 'begin' }
  | { type: 'end' }
  | { type: 'drag-seam'; nodeId: string; ratio: number; transforms?: Record<string, Transform> }
  | { type: 'set-transform'; photoId: string; transform: Transform }
  | { type: 'swap'; a: string; b: string }
  | { type: 'crop'; aspect: number }
  | { type: 'select'; photoId: string | null }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'clear' }
  | { type: 'restore'; photos: Photo[]; doc: Doc }
  | { type: 'notice'; text: string }
  | { type: 'dismiss-notice' };

const HISTORY_LIMIT = 50;

/** Push the current doc onto the undo stack (R9.2). */
function commit(state: AppState, doc: Doc): AppState {
  return {
    ...state,
    doc,
    past: [...state.past, state.doc].slice(-HISTORY_LIMIT),
    future: [],
    pending: null,
  };
}

/** Mid-drag update: the first change of a gesture pushes the pre-drag snapshot. */
function transient(state: AppState, doc: Doc): AppState {
  if (state.pending) {
    return {
      ...state,
      doc,
      past: [...state.past, state.pending].slice(-HISTORY_LIMIT),
      future: [],
      pending: null,
    };
  }
  return { ...state, doc };
}

function shapesOf(photos: Photo[], order: string[]) {
  const byId = new Map(photos.map((p) => [p.id, p]));
  return order
    .map((id) => byId.get(id))
    .filter((p): p is Photo => !!p)
    .map((p) => ({ id: p.id, aspect: p.aspect }));
}

export function suggestFor(photos: Photo[], doc: Doc): Node[] {
  return generateLayouts(shapesOf(photos, doc.order), doc.canvas.aspect, 5);
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'add-photos': {
      if (action.photos.length === 0) {
        return action.skipped?.length ? { ...state, notices: skipNotices(action.skipped) } : state;
      }
      const photos = [...state.photos, ...action.photos];
      const order = [...state.doc.order, ...action.photos.map((p) => p.id)];
      const doc = { ...state.doc, order };
      const suggestions = suggestFor(photos, doc);
      return {
        ...commit(state, { ...doc, root: suggestions[0] ?? null }),
        photos,
        suggestions,
        suggestionIndex: 0,
        adjusted: false,
        notices: action.skipped?.length ? skipNotices(action.skipped) : state.notices,
      };
    }

    case 'remove-photo': {
      const photos = state.photos.filter((p) => p.id !== action.photoId);
      const order = state.doc.order.filter((id) => id !== action.photoId);
      // Collapsing the split keeps every other adjustment intact, which beats
      // re-running the layout and throwing the user's work away.
      const root = state.doc.root ? removePhoto(state.doc.root, action.photoId) : null;
      const doc: Doc = { ...state.doc, order, root };
      const next = commit(state, doc);
      const gone = state.photos.find((p) => p.id === action.photoId);
      gone?.proxy.close();
      return {
        ...next,
        photos,
        suggestions: suggestFor(photos, doc),
        selected: state.selected === action.photoId ? null : state.selected,
      };
    }

    case 'reorder': {
      const order = [...state.doc.order];
      const [moved] = order.splice(action.from, 1);
      order.splice(action.to, 0, moved);
      const doc = { ...state.doc, order };
      const suggestions = suggestFor(state.photos, doc);
      return {
        ...commit(state, { ...doc, root: suggestions[0] ?? doc.root }),
        suggestions,
        suggestionIndex: 0,
        adjusted: false,
      };
    }

    case 'pick-suggestion': {
      const root = state.suggestions[action.index];
      if (!root) return state;
      return {
        ...commit(state, { ...state.doc, root }),
        suggestionIndex: action.index,
        adjusted: false,
      };
    }

    case 'auto-arrange': {
      const suggestions = suggestFor(state.photos, state.doc);
      return {
        ...commit(state, { ...state.doc, root: suggestions[0] ?? state.doc.root }),
        suggestions,
        suggestionIndex: 0,
        adjusted: false,
      };
    }

    case 'set-canvas': {
      const canvas = { ...state.doc.canvas, ...action.patch };
      const doc = { ...state.doc, canvas };
      const aspectChanged = action.patch.aspect !== undefined && action.patch.aspect !== state.doc.canvas.aspect;
      if (!aspectChanged) return commit(state, doc);
      const suggestions = suggestFor(state.photos, doc);
      if (state.adjusted) {
        // Keep the arrangement they built; the cells just reflow into the new shape.
        return {
          ...commit(state, doc),
          suggestions,
          notices: ['Kept your arrangement. Use Auto-arrange for a layout suited to the new shape.'],
        };
      }
      return {
        ...commit(state, { ...doc, root: suggestions[0] ?? doc.root }),
        suggestions,
        suggestionIndex: 0,
      };
    }

    case 'begin':
      return { ...state, pending: state.doc };

    case 'end':
      return state.pending ? { ...state, pending: null } : state;

    case 'drag-seam': {
      if (!state.doc.root) return state;
      const root = setRatio(state.doc.root, action.nodeId, action.ratio);
      const transforms = action.transforms
        ? { ...state.doc.transforms, ...action.transforms }
        : state.doc.transforms;
      return { ...transient(state, { ...state.doc, root, transforms }), adjusted: true };
    }

    case 'set-transform': {
      const transforms = { ...state.doc.transforms, [action.photoId]: action.transform };
      return transient(state, { ...state.doc, transforms });
    }

    case 'swap': {
      if (!state.doc.root || action.a === action.b) return state;
      return commit(state, { ...state.doc, root: swapPhotos(state.doc.root, action.a, action.b) });
    }

    case 'crop': {
      const canvas = { ...state.doc.canvas, aspect: action.aspect, aspectLabel: 'Custom' };
      return { ...commit(state, { ...state.doc, canvas }), adjusted: true };
    }

    case 'select':
      return { ...state, selected: action.photoId };

    case 'undo': {
      if (state.past.length === 0) return state;
      const doc = state.past[state.past.length - 1];
      return {
        ...state,
        doc,
        past: state.past.slice(0, -1),
        future: [state.doc, ...state.future].slice(0, HISTORY_LIMIT),
        suggestions: suggestFor(state.photos, doc),
        pending: null,
      };
    }

    case 'redo': {
      if (state.future.length === 0) return state;
      const doc = state.future[0];
      return {
        ...state,
        doc,
        past: [...state.past, state.doc].slice(-HISTORY_LIMIT),
        future: state.future.slice(1),
        suggestions: suggestFor(state.photos, doc),
        pending: null,
      };
    }

    case 'clear': {
      state.photos.forEach((p) => p.proxy.close());
      return { ...INITIAL, doc: { ...EMPTY_DOC, canvas: state.doc.canvas } };
    }

    case 'restore': {
      return {
        ...INITIAL,
        photos: action.photos,
        doc: action.doc,
        suggestions: suggestFor(action.photos, action.doc),
      };
    }

    case 'notice':
      return { ...state, notices: [action.text] };

    case 'dismiss-notice':
      return { ...state, notices: [] };

    default:
      return state;
  }
}

function skipNotices(skipped: { name: string; reason: string }[]): string[] {
  return [skipped.map((s) => `${s.name}: ${s.reason}`).join(' · ')];
}

export const transformOf = (doc: Doc, photoId: string): Transform => doc.transforms[photoId] ?? IDENTITY;
