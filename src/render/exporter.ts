import { Doc, IDENTITY, Photo, UNIT } from '../types';
import { computeLayout } from '../layout/tree';
import { placePhoto, roundRectPath, scaleRect } from './draw';
import { decodeFullSize } from '../utils/image';

export type ExportFormat = 'png' | 'jpeg';

export interface ExportOptions {
  format: ExportFormat;
  /** 0..1, JPEG only. */
  quality: number;
  longEdge: number;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Largest canvas long edge at which no photo is scaled beyond its native
 * resolution, given where each one currently sits (R7.2, R7.5).
 */
export function nativeCeiling(doc: Doc, photos: Photo[]): number {
  if (!doc.root) return 4096;
  const byId = new Map(photos.map((p) => [p.id, p]));
  const layout = computeLayout(doc.root, doc.canvas.aspect, doc.canvas.gutter, doc.canvas.margin);
  let limit = Infinity;
  for (const cell of layout.cells) {
    const photo = byId.get(cell.photoId);
    if (!photo) continue;
    const t = doc.transforms[cell.photoId] ?? IDENTITY;
    const unitCover = Math.max(cell.rect.w / photo.width, cell.rect.h / photo.height);
    const edge = UNIT / (unitCover * Math.max(1, t.zoom));
    limit = Math.min(limit, edge);
  }
  if (!Number.isFinite(limit)) return 4096;
  return Math.max(512, Math.min(8192, Math.round(limit)));
}

/** Photos that would be scaled past their native resolution at this output size. */
export function upscaledAt(doc: Doc, photos: Photo[], longEdge: number): string[] {
  if (!doc.root) return [];
  const byId = new Map(photos.map((p) => [p.id, p]));
  const layout = computeLayout(doc.root, doc.canvas.aspect, doc.canvas.gutter, doc.canvas.margin);
  const scale = longEdge / UNIT;
  const names: string[] = [];
  for (const cell of layout.cells) {
    const photo = byId.get(cell.photoId);
    if (!photo) continue;
    const t = doc.transforms[cell.photoId] ?? IDENTITY;
    const rect = scaleRect(cell.rect, scale);
    const p = placePhoto(rect, photo.width, photo.height, t);
    if (p.dw > photo.width * 1.02) names.push(photo.name);
  }
  return names;
}

export function outputSize(doc: Doc, longEdge: number): { w: number; h: number } {
  const a = doc.canvas.aspect;
  return a >= 1
    ? { w: Math.round(longEdge), h: Math.round(longEdge / a) }
    : { w: Math.round(longEdge * a), h: Math.round(longEdge) };
}

/**
 * Render at full resolution from the original files, one photo at a time so peak
 * memory stays near a single decode rather than twenty (R7.3).
 */
export async function renderExport(doc: Doc, photos: Photo[], opts: ExportOptions): Promise<Blob> {
  if (!doc.root) throw new Error('nothing to export');
  const byId = new Map(photos.map((p) => [p.id, p]));
  const layout = computeLayout(doc.root, doc.canvas.aspect, doc.canvas.gutter, doc.canvas.margin);
  const scale = opts.longEdge / UNIT;
  const size = outputSize(doc, opts.longEdge);

  const canvas = document.createElement('canvas');
  canvas.width = size.w;
  canvas.height = size.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');

  ctx.fillStyle = doc.canvas.background;
  ctx.fillRect(0, 0, size.w, size.h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const total = layout.cells.length;
  let done = 0;
  for (const cell of layout.cells) {
    const photo = byId.get(cell.photoId);
    if (photo) {
      const bitmap = await decodeFullSize(photo.blob);
      const rect = scaleRect(cell.rect, scale);
      const t = doc.transforms[cell.photoId] ?? IDENTITY;
      const p = placePhoto(rect, bitmap.width, bitmap.height, t);
      ctx.save();
      roundRectPath(ctx, rect, doc.canvas.radius * scale);
      ctx.clip();
      ctx.drawImage(bitmap, p.dx, p.dy, p.dw, p.dh);
      ctx.restore();
      bitmap.close();
    }
    done++;
    opts.onProgress?.(done, total);
    // Let the progress bar paint between photos.
    await new Promise((r) => setTimeout(r, 0));
  }

  const type = opts.format === 'png' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, opts.format === 'jpeg' ? opts.quality : undefined),
  );
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new Error('export failed');
  return blob;
}

export function suggestFilename(format: ExportFormat): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `collage-${stamp}.${format === 'png' ? 'png' : 'jpg'}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
