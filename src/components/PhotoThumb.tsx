import { useEffect, useRef } from 'react';
import { Photo } from '../types';

/** ImageBitmaps cannot be an <img> src, so thumbnails get their own small canvas. */
export default function PhotoThumb({ photo, size = 64 }: { photo: Photo; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const s = Math.max(size / photo.proxy.width, size / photo.proxy.height);
    const w = photo.proxy.width * s;
    const h = photo.proxy.height * s;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(photo.proxy, (size - w) / 2, (size - h) / 2, w, h);
  }, [photo, size]);

  return <canvas ref={ref} className="thumb-canvas" style={{ width: size, height: size }} />;
}
