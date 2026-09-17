import { useEffect, useRef } from 'react';
import { CanvasSettings, Node, Photo, Transform } from '../types';
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
  activeIndex: number;
  adjusted: boolean;
  photos: Photo[];
  canvas: CanvasSettings;
  transforms: Record<string, Transform>;
  onPick: (index: number) => void;
}

export default function Suggestions({
  suggestions,
  activeIndex,
  adjusted,
  photos,
  canvas,
  transforms,
  onPick,
}: Props) {
  if (suggestions.length <= 1) return null;
  return (
    <div className="suggestions">
      <div className="suggestions-label">
        Layouts
        <span className="hint">ranked best first</span>
      </div>
      <div className="suggestions-row">
        {suggestions.map((root, i) => (
          <button
            key={root.id}
            className={`suggestion${i === activeIndex && !adjusted ? ' is-active' : ''}`}
            onClick={() => onPick(i)}
            title={i === 0 ? 'Best match for these photos' : `Alternative ${i}`}
          >
            <Thumb root={root} photos={photos} canvas={canvas} transforms={transforms} />
          </button>
        ))}
      </div>
    </div>
  );
}
