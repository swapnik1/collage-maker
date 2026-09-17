import { Doc, IDENTITY, Photo } from '../types';
import { computeLayout } from '../layout/tree';
import { ASPECTS } from '../state/store';
import { maxZoom } from './CanvasStage';

const SWATCHES = ['#ffffff', '#f4f1ea', '#111418', '#2b2b2b', '#e9d8c4', '#cfe3f2'];

interface Props {
  doc: Doc;
  photos: Photo[];
  selected: string | null;
  onCanvas: (patch: Partial<Doc['canvas']>) => void;
  onZoom: (photoId: string, zoom: number) => void;
  onResetPhoto: (photoId: string) => void;
  onAutoArrange: () => void;
  adjusted: boolean;
}

export default function Inspector({
  doc,
  photos,
  selected,
  onCanvas,
  onZoom,
  onResetPhoto,
  onAutoArrange,
  adjusted,
}: Props) {
  const photo = photos.find((p) => p.id === selected) ?? null;
  const layout = computeLayout(doc.root, doc.canvas.aspect, doc.canvas.gutter, doc.canvas.margin);
  const cell = photo ? layout.cells.find((c) => c.photoId === photo.id) : null;
  const t = photo ? (doc.transforms[photo.id] ?? IDENTITY) : IDENTITY;
  const zMax = photo && cell ? maxZoom(cell.rect, photo) : 5;

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Shape</h2>
      </div>
      <div className="chip-row">
        {ASPECTS.map((a) => (
          <button
            key={a.label}
            className={`chip${Math.abs(doc.canvas.aspect - a.value) < 0.001 ? ' is-active' : ''}`}
            onClick={() => onCanvas({ aspect: a.value, aspectLabel: a.label })}
          >
            {a.label}
          </button>
        ))}
      </div>
      <button className="btn subtle full" onClick={onAutoArrange}>
        Auto-arrange
      </button>
      {adjusted && <p className="note">Your adjustments are kept until you auto-arrange or pick a layout.</p>}

      <div className="panel-head">
        <h2>Spacing</h2>
      </div>
      <Slider
        label="Gutter"
        value={doc.canvas.gutter}
        min={0}
        max={60}
        step={1}
        onChange={(v) => onCanvas({ gutter: v })}
      />
      <Slider
        label="Margin"
        value={doc.canvas.margin}
        min={0}
        max={80}
        step={1}
        onChange={(v) => onCanvas({ margin: v })}
      />
      <Slider
        label="Corners"
        value={doc.canvas.radius}
        min={0}
        max={60}
        step={1}
        onChange={(v) => onCanvas({ radius: v })}
      />

      <div className="panel-head">
        <h2>Background</h2>
      </div>
      <div className="swatch-row">
        {SWATCHES.map((c) => (
          <button
            key={c}
            className={`swatch${doc.canvas.background.toLowerCase() === c ? ' is-active' : ''}`}
            style={{ background: c }}
            onClick={() => onCanvas({ background: c })}
            title={c}
          />
        ))}
        <input
          type="color"
          className="swatch color-input"
          value={doc.canvas.background}
          onChange={(e) => onCanvas({ background: e.target.value })}
          title="Custom colour"
        />
      </div>

      <div className="panel-head">
        <h2>Selected photo</h2>
      </div>
      {photo ? (
        <>
          <p className="selected-name" title={photo.name}>
            {photo.name}
          </p>
          <Slider
            label="Zoom"
            value={t.zoom}
            min={1}
            max={Math.max(1.01, zMax)}
            step={0.01}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => onZoom(photo.id, v)}
          />
          <button className="btn subtle full" onClick={() => onResetPhoto(photo.id)}>
            Fit to cell
          </button>
          <p className="note">Scroll over a photo to zoom, drag to pan, double-click to fit.</p>
        </>
      ) : (
        <p className="note">Click a photo on the canvas to adjust it.</p>
      )}
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <label className="slider">
      <span className="slider-label">
        {label}
        <b>{format ? format(value) : Math.round(value)}</b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
