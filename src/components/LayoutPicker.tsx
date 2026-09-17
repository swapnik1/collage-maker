import { useEffect, useRef, useState } from 'react';
import { CanvasSettings, Node, Photo, Transform } from '../types';
import { Template } from '../layout/templates';
import { computeLayout } from '../layout/tree';
import { drawCollage } from '../render/draw';

const BOX = 104;

function Thumb({
  root,
  photos,
  canvas,
  transforms,
}: {
  root: Node;
  photos: Photo[];
  canvas: CanvasSettings;
  transforms: Record<string, Transform>;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const layout = computeLayout(root, canvas.aspect, canvas.gutter, canvas.margin);
    const scale = Math.min(BOX / layout.w, BOX / layout.h);
    const w = layout.w * scale;
    const h = layout.h * scale;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    el.width = Math.round(w * dpr);
    el.height = Math.round(h * dpr);
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const byId = new Map(photos.map((p) => [p.id, p]));
    drawCollage(ctx, layout, {
      scale,
      radius: canvas.radius,
      background: canvas.background,
      transforms,
      getPhoto: (id) => {
        const p = byId.get(id);
        return p ? { bitmap: p.proxy, width: p.proxy.width, height: p.proxy.height } : undefined;
      },
    });
  }, [root, photos, canvas, transforms]);

  return <canvas ref={ref} />;
}

interface Props {
  suggestions: Node[];
  templates: Template[];
  picked: string | null;
  adjusted: boolean;
  photos: Photo[];
  canvas: CanvasSettings;
  transforms: Record<string, Transform>;
  onPickSuggestion: (index: number) => void;
  onPickTemplate: (key: string) => void;
}

export default function LayoutPicker({
  suggestions,
  templates,
  picked,
  adjusted,
  photos,
  canvas,
  transforms,
  onPickSuggestion,
  onPickTemplate,
}: Props) {
  const [tab, setTab] = useState<'suggested' | 'templates'>('suggested');
  if (suggestions.length <= 1 && templates.length === 0) return null;

  const isActive = (key: string) => !adjusted && picked === key;
  const thumb = (root: Node) => (
    <Thumb root={root} photos={photos} canvas={canvas} transforms={transforms} />
  );

  return (
    <div className="picker">
      <div className="picker-head">
        <div className="tabs">
          <button
            className={`tab${tab === 'suggested' ? ' is-active' : ''}`}
            onClick={() => setTab('suggested')}
          >
            Suggested
          </button>
          <button
            className={`tab${tab === 'templates' ? ' is-active' : ''}`}
            onClick={() => setTab('templates')}
            disabled={templates.length === 0}
          >
            Templates
          </button>
        </div>
        <span className="hint">
          {tab === 'suggested'
            ? 'ranked by how well they fit your photos'
            : 'pick a shape, whatever the photos are'}
        </span>
      </div>

      {tab === 'suggested' ? (
        <div className="picker-row">
          {suggestions.map((root, i) => (
            <button
              key={root.id}
              className={`tile${isActive(`s:${i}`) ? ' is-active' : ''}`}
              onClick={() => onPickSuggestion(i)}
              title={i === 0 ? 'Best match for these photos' : `Alternative ${i}`}
            >
              {thumb(root)}
              {i === 0 && <span className="tile-label">Best fit</span>}
            </button>
          ))}
        </div>
      ) : (
        <div className="picker-row">
          {templates.map((t) => (
            <button
              key={t.key}
              className={`tile${isActive(`t:${t.key}`) ? ' is-active' : ''}`}
              onClick={() => onPickTemplate(t.key)}
              title={t.name}
            >
              {thumb(t.root)}
              <span className="tile-label">{t.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
