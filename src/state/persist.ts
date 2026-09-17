import { CanvasSettings, Doc, Node, Photo, Transform } from '../types';

const DB_NAME = 'collage-maker';
const DB_VERSION = 1;
const STORE = 'session';
const KEY = 'current';

interface SavedPhoto {
  id: string;
  name: string;
  width: number;
  height: number;
  blob: Blob;
}

export interface SavedSession {
  root: Node | null;
  order: string[];
  transforms: Record<string, Transform>;
  canvas: CanvasSettings;
  photos: SavedPhoto[];
  savedAt: number;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** Autosave so a stray refresh does not cost the whole session (R9.1). */
export async function saveSession(doc: Doc, photos: Photo[]): Promise<void> {
  const payload: SavedSession = {
    root: doc.root,
    order: doc.order,
    transforms: doc.transforms,
    canvas: doc.canvas,
    photos: photos.map((p) => ({ id: p.id, name: p.name, width: p.width, height: p.height, blob: p.blob })),
    savedAt: Date.now(),
  };
  await withStore('readwrite', (s) => s.put(payload, KEY) as IDBRequest<IDBValidKey>);
}

export async function loadSession(): Promise<SavedSession | null> {
  try {
    const saved = await withStore<SavedSession | undefined>('readonly', (s) => s.get(KEY));
    return saved ?? null;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  try {
    await withStore('readwrite', (s) => s.delete(KEY) as unknown as IDBRequest<undefined>);
  } catch {
    /* nothing to clear */
  }
}
