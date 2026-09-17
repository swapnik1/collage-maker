import { IDENTITY, Layout, Rect, Transform } from '../types';

export interface PhotoSource {
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

/** Scale at which the photo exactly covers the cell with nothing left over. */
export function coverScale(cell: Rect, pw: number, ph: number): number {
  return Math.max(cell.w / pw, cell.h / ph);
}

export interface Placement {
  dx: number;
  dy: number;
  dw: number;
  dh: number;
  /** Hidden pixels along each axis, at the current zoom. */
  overflowX: number;
  overflowY: number;
}

/**
 * Where a photo sits inside its cell. Pan is normalised to the hidden overflow,
 * so the visible framing survives the cell changing size, and it is impossible
 * to pan empty space into view (R5.3).
 */
export function placePhoto(cell: Rect, pw: number, ph: number, t: Transform = IDENTITY): Placement {
  const scale = coverScale(cell, pw, ph) * Math.max(1, t.zoom);
  const dw = pw * scale;
  const dh = ph * scale;
  const overflowX = Math.max(0, dw - cell.w);
  const overflowY = Math.max(0, dh - cell.h);
  const px = Math.min(0.5, Math.max(-0.5, t.panX));
  const py = Math.min(0.5, Math.max(-0.5, t.panY));
  return {
    dx: cell.x - overflowX * (0.5 + px),
    dy: cell.y - overflowY * (0.5 + py),
    dw,
    dh,
    overflowX,
    overflowY,
  };
}

export function roundRectPath(ctx: CanvasRenderingContext2D, r: Rect, radius: number): void {
  const rad = Math.max(0, Math.min(radius, r.w / 2, r.h / 2));
  ctx.beginPath();
  if (rad === 0) {
    ctx.rect(r.x, r.y, r.w, r.h);
    return;
  }
  ctx.moveTo(r.x + rad, r.y);
  ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, rad);
  ctx.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, rad);
  ctx.arcTo(r.x, r.y + r.h, r.x, r.y, rad);
  ctx.arcTo(r.x, r.y, r.x + r.w, r.y, rad);
  ctx.closePath();
}

export const scaleRect = (r: Rect, s: number): Rect => ({ x: r.x * s, y: r.y * s, w: r.w * s, h: r.h * s });

export interface DrawOptions {
  scale: number;
  radius: number;
  background: string;
  transforms: Record<string, Transform>;
  getPhoto: (photoId: string) => PhotoSource | undefined;
}

/** One renderer for both the live preview and the export pass, so what you see ships. */
export function drawCollage(ctx: CanvasRenderingContext2D, layout: Layout, opts: DrawOptions): void {
  const { scale } = opts;
  ctx.save();
  ctx.fillStyle = opts.background;
  ctx.fillRect(0, 0, layout.w * scale, layout.h * scale);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  for (const cell of layout.cells) {
    const photo = opts.getPhoto(cell.photoId);
    const rect = scaleRect(cell.rect, scale);
    if (!photo) {
      ctx.save();
      roundRectPath(ctx, rect, opts.radius * scale);
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fill();
      ctx.restore();
      continue;
    }
    const t = opts.transforms[cell.photoId] ?? IDENTITY;
    const p = placePhoto(rect, photo.width, photo.height, t);
    ctx.save();
    roundRectPath(ctx, rect, opts.radius * scale);
    ctx.clip();
    ctx.drawImage(photo.bitmap, p.dx, p.dy, p.dw, p.dh);
    ctx.restore();
  }
  ctx.restore();
}
