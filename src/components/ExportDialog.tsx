import { useMemo, useState } from 'react';
import { Doc, Photo } from '../types';
import {
  ExportFormat,
  downloadBlob,
  nativeCeiling,
  outputSize,
  renderExport,
  suggestFilename,
  upscaledAt,
} from '../render/exporter';

export default function ExportDialog({ doc, photos, onClose }: { doc: Doc; photos: Photo[]; onClose: () => void }) {
  const ceiling = useMemo(() => nativeCeiling(doc, photos), [doc, photos]);
  const presets = useMemo(() => {
    const list: { label: string; value: number }[] = [
      { label: '1080 px', value: 1080 },
      { label: '2048 px', value: 2048 },
      { label: '4096 px', value: 4096 },
      { label: `Max (${ceiling} px)`, value: ceiling },
    ];
    return list;
  }, [ceiling]);

  const [format, setFormat] = useState<ExportFormat>('jpeg');
  const [quality, setQuality] = useState(0.92);
  const [longEdge, setLongEdge] = useState(Math.min(2048, Math.max(1080, ceiling)));
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const size = outputSize(doc, longEdge);
  const upscaled = useMemo(() => upscaledAt(doc, photos, longEdge), [doc, photos, longEdge]);

  const run = async () => {
    setBusy(true);
    setError(null);
    setProgress(0);
    try {
      const blob = await renderExport(doc, photos, {
        format,
        quality,
        longEdge,
        onProgress: (done, total) => setProgress(done / total),
      });
      downloadBlob(blob, suggestFilename(format));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'export failed');
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Export</h2>

        <div className="field">
          <span className="field-label">Format</span>
          <div className="chip-row">
            <button className={`chip${format === 'jpeg' ? ' is-active' : ''}`} onClick={() => setFormat('jpeg')}>
              JPEG
            </button>
            <button className={`chip${format === 'png' ? ' is-active' : ''}`} onClick={() => setFormat('png')}>
              PNG
            </button>
          </div>
        </div>

        {format === 'jpeg' && (
          <label className="slider">
            <span className="slider-label">
              Quality<b>{Math.round(quality * 100)}</b>
            </span>
            <input
              type="range"
              min={0.5}
              max={1}
              step={0.01}
              value={quality}
              onChange={(e) => setQuality(Number(e.target.value))}
            />
          </label>
        )}

        <div className="field">
          <span className="field-label">Size</span>
          <div className="chip-row">
            {presets.map((p) => (
              <button
                key={p.label}
                className={`chip${longEdge === p.value ? ' is-active' : ''}`}
                onClick={() => setLongEdge(p.value)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <p className="note">
          Output: {size.w} × {size.h} px
        </p>

        {upscaled.length > 0 && (
          <p className="warn">
            {upscaled.length} photo{upscaled.length > 1 ? 's' : ''} will be enlarged past native resolution and may
            look soft: {upscaled.slice(0, 3).join(', ')}
            {upscaled.length > 3 ? '…' : ''}
          </p>
        )}

        {error && <p className="warn">{error}</p>}

        {busy ? (
          <div className="progress">
            <div className="progress-bar" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        ) : (
          <div className="modal-actions">
            <button className="btn subtle" onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary" onClick={run}>
              Export
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
