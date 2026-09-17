import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { IDENTITY, MAX_PHOTOS, Photo, Rect } from './types';
import { INITIAL, reducer } from './state/store';
import { clearSession, loadSession, saveSession } from './state/persist';
import { importFiles, photoFromBlob } from './utils/image';
import CanvasStage from './components/CanvasStage';
import PhotoList from './components/PhotoList';
import Inspector from './components/Inspector';
import Suggestions from './components/Suggestions';
import ExportDialog from './components/ExportDialog';

export default function App() {
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const [cropping, setCropping] = useState(false);
  const [cropRect, setCropRect] = useState<Rect | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [busy, setBusy] = useState<string | null>('Restoring your last session…');
  const [confirmAsk, setConfirmAsk] = useState<{ text: string; onYes: () => void } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const restored = useRef(false);

  const { photos, doc } = state;
  const hasPhotos = photos.length > 0;

  // Restore whatever was open last time (R9.1).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await loadSession();
      if (cancelled) return;
      if (!saved || saved.photos.length === 0) {
        setBusy(null);
        restored.current = true;
        return;
      }
      try {
        const rebuilt: Photo[] = [];
        for (const p of saved.photos) rebuilt.push(await photoFromBlob(p.id, p.name, p.blob));
        if (cancelled) return;
        dispatch({
          type: 'restore',
          photos: rebuilt,
          doc: { root: saved.root, order: saved.order, transforms: saved.transforms, canvas: saved.canvas },
        });
      } catch {
        await clearSession();
      } finally {
        setBusy(null);
        restored.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Autosave, debounced so dragging a seam does not hammer IndexedDB.
  useEffect(() => {
    if (!restored.current) return;
    const id = window.setTimeout(() => {
      if (photos.length === 0) void clearSession();
      else void saveSession(doc, photos);
    }, 800);
    return () => window.clearTimeout(id);
  }, [doc, photos]);

  const addFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const go = async () => {
        setBusy('Reading photos…');
        const { photos: added, skipped } = await importFiles(files, state.photos.length);
        dispatch({ type: 'add-photos', photos: added, skipped });
        setBusy(null);
      };
      if (state.adjusted && state.photos.length > 0) {
        setConfirmAsk({
          text: 'Adding photos re-runs the layout, which will discard the adjustments you have made. Continue?',
          onYes: () => void go(),
        });
      } else {
        await go();
      }
    },
    [state.adjusted, state.photos.length],
  );

  // Drag photos anywhere onto the window.
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      setDropping(true);
    };
    const leave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDropping(false);
    };
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      setDropping(false);
      void addFiles(Array.from(e.dataTransfer.files));
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [addFiles]);

  // Keyboard: undo/redo, delete, escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /input|textarea/i.test(target.tagName)) return;
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? 'redo' : 'undo' });
      } else if (meta && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        dispatch({ type: 'redo' });
      } else if (e.key === 'Escape') {
        setCropping(false);
        setCropRect(null);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && state.selected) {
        e.preventDefault();
        dispatch({ type: 'remove-photo', photoId: state.selected });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.selected]);

  const applyCrop = () => {
    if (cropRect && cropRect.w > 4 && cropRect.h > 4) {
      dispatch({ type: 'crop', aspect: cropRect.w / cropRect.h });
    }
    setCropping(false);
    setCropRect(null);
  };

  const cropLabel = cropRect && cropRect.h > 0 ? ratioLabel(cropRect.w / cropRect.h) : null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          <div>
            <h1>Collage Maker</h1>
            <p>Photos never leave this device</p>
          </div>
        </div>

        <div className="toolbar">
          <button className="btn" disabled={state.past.length === 0} onClick={() => dispatch({ type: 'undo' })}>
            Undo
          </button>
          <button className="btn" disabled={state.future.length === 0} onClick={() => dispatch({ type: 'redo' })}>
            Redo
          </button>
          {hasPhotos &&
            (cropping ? (
              <>
                <span className="crop-status">{cropLabel ? `New shape ${cropLabel}` : 'Drag a shape'}</span>
                <button className="btn primary" onClick={applyCrop}>
                  Apply
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    setCropping(false);
                    setCropRect(null);
                  }}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button className="btn" onClick={() => setCropping(true)}>
                Crop
              </button>
            ))}
          <button className="btn primary" disabled={!hasPhotos || cropping} onClick={() => setShowExport(true)}>
            Export
          </button>
          {hasPhotos && (
            <button
              className="btn subtle"
              onClick={() =>
                setConfirmAsk({
                  text: 'Remove all photos and start over?',
                  onYes: () => {
                    dispatch({ type: 'clear' });
                    void clearSession();
                  },
                })
              }
            >
              Start over
            </button>
          )}
        </div>
      </header>

      {state.notices.length > 0 && (
        <div className="notice" onClick={() => dispatch({ type: 'dismiss-notice' })}>
          {state.notices.join(' ')}
          <span className="notice-x">✕</span>
        </div>
      )}

      {hasPhotos ? (
        <main className="workspace">
          <aside className="rail left">
            <PhotoList
              photos={photos}
              order={doc.order}
              selected={state.selected}
              onSelect={(id) => dispatch({ type: 'select', photoId: id })}
              onRemove={(id) => dispatch({ type: 'remove-photo', photoId: id })}
              onReorder={(from, to) => dispatch({ type: 'reorder', from, to })}
              onAdd={(files) => void addFiles(files)}
            />
          </aside>

          <section className="centre">
            <CanvasStage
              state={state}
              dispatch={dispatch}
              cropping={cropping}
              cropRect={cropRect}
              onCropRect={setCropRect}
            />
            {cropping ? (
              <p className="stage-hint">
                Drag the shape you want. Photos reflow to fill it, so nothing is lost.
              </p>
            ) : (
              <Suggestions
                suggestions={state.suggestions}
                activeIndex={state.suggestionIndex}
                adjusted={state.adjusted}
                photos={photos}
                canvas={doc.canvas}
                transforms={doc.transforms}
                onPick={(i) => dispatch({ type: 'pick-suggestion', index: i })}
              />
            )}
          </section>

          <aside className="rail right">
            <Inspector
              doc={doc}
              photos={photos}
              selected={state.selected}
              adjusted={state.adjusted}
              onCanvas={(patch) => dispatch({ type: 'set-canvas', patch })}
              onZoom={(photoId, zoom) => {
                dispatch({ type: 'begin' });
                dispatch({
                  type: 'set-transform',
                  photoId,
                  transform: { ...(doc.transforms[photoId] ?? IDENTITY), zoom },
                });
                dispatch({ type: 'end' });
              }}
              onResetPhoto={(photoId) => {
                dispatch({ type: 'begin' });
                dispatch({ type: 'set-transform', photoId, transform: IDENTITY });
                dispatch({ type: 'end' });
              }}
              onAutoArrange={() => dispatch({ type: 'auto-arrange' })}
            />
          </aside>
        </main>
      ) : (
        <main className="empty">
          <div className="dropzone" onClick={() => fileInput.current?.click()}>
            <div className="dropzone-art" aria-hidden>
              <span />
              <span />
              <span />
              <span />
            </div>
            <h2>Drop up to {MAX_PHOTOS} photos</h2>
            <p>Any size, any shape. A layout gets picked for you — adjust it however you like.</p>
            <button className="btn primary">Choose photos</button>
          </div>
        </main>
      )}

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          void addFiles(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />

      {dropping && <div className="drop-overlay">Drop to add</div>}
      {busy && (
        <div className="modal-backdrop">
          <div className="modal small">
            <div className="spinner" />
            <p>{busy}</p>
          </div>
        </div>
      )}
      {confirmAsk && (
        <div className="modal-backdrop" onClick={() => setConfirmAsk(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <p className="confirm-text">{confirmAsk.text}</p>
            <div className="modal-actions">
              <button className="btn subtle" onClick={() => setConfirmAsk(null)}>
                Cancel
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  confirmAsk.onYes();
                  setConfirmAsk(null);
                }}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}
      {showExport && <ExportDialog doc={doc} photos={photos} onClose={() => setShowExport(false)} />}
    </div>
  );
}

/** Nearest tidy name for a ratio, for the crop readout. */
function ratioLabel(a: number): string {
  const known: [string, number][] = [
    ['1:1', 1],
    ['4:5', 0.8],
    ['5:4', 1.25],
    ['2:3', 2 / 3],
    ['3:2', 1.5],
    ['9:16', 0.5625],
    ['16:9', 16 / 9],
    ['3:4', 0.75],
    ['4:3', 4 / 3],
  ];
  for (const [label, value] of known) if (Math.abs(a - value) < 0.02) return label;
  return a >= 1 ? `${a.toFixed(2)}:1` : `1:${(1 / a).toFixed(2)}`;
}
