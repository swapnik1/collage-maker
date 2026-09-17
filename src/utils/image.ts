import { MAX_PHOTOS, Photo } from '../types';

/** Editing works on proxies this big; full resolution is only touched at export (R8.1). */
export const PROXY_MAX = 2048;

export const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];

/** Decode with EXIF orientation applied, so phone photos are never sideways (R1.3). */
async function decodeOriented(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('could not decode image'));
        img.src = url;
      });
      // Drawing an <img> applies its orientation, which gives us the same result.
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas unavailable');
      ctx.drawImage(img, 0, 0);
      return await createImageBitmap(canvas);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

async function scaleBitmap(src: ImageBitmap, max: number): Promise<ImageBitmap> {
  const scale = Math.min(1, max / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  try {
    return await createImageBitmap(src, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
  } catch {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, w, h);
    return await createImageBitmap(canvas);
  }
}

/** Full-resolution decode, used by the export pass only. */
export async function decodeFullSize(blob: Blob): Promise<ImageBitmap> {
  return decodeOriented(blob);
}

let seq = 0;

export async function loadPhoto(file: File): Promise<Photo> {
  const full = await decodeOriented(file);
  const width = full.width;
  const height = full.height;
  let proxy = full;
  if (Math.max(width, height) > PROXY_MAX) {
    proxy = await scaleBitmap(full, PROXY_MAX);
    full.close();
  }
  return {
    id: `p${(seq++).toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    name: file.name || 'image',
    width,
    height,
    aspect: width / height,
    proxy,
    blob: file,
  };
}

/** Rebuild a photo from a restored session, keeping its original id. */
export async function photoFromBlob(id: string, name: string, blob: Blob): Promise<Photo> {
  const full = await decodeOriented(blob);
  const width = full.width;
  const height = full.height;
  let proxy = full;
  if (Math.max(width, height) > PROXY_MAX) {
    proxy = await scaleBitmap(full, PROXY_MAX);
    full.close();
  }
  return { id, name, width, height, aspect: width / height, proxy, blob };
}

export interface ImportResult {
  photos: Photo[];
  skipped: { name: string; reason: string }[];
}

/** Import a batch, skipping what cannot be read rather than failing the whole drop (R1.5). */
export async function importFiles(files: File[], existingCount: number): Promise<ImportResult> {
  const photos: Photo[] = [];
  const skipped: { name: string; reason: string }[] = [];
  let room = MAX_PHOTOS - existingCount;

  for (const file of files) {
    // Type first, so a stray text file is never blamed on the photo limit.
    if (!file.type.startsWith('image/')) {
      skipped.push({ name: file.name, reason: 'not an image' });
      continue;
    }
    if (room <= 0) {
      skipped.push({ name: file.name, reason: `over the ${MAX_PHOTOS} photo limit` });
      continue;
    }
    try {
      photos.push(await loadPhoto(file));
      room--;
    } catch {
      const hint = /heic|heif/i.test(file.type + file.name)
        ? 'HEIC is not supported yet — convert to JPEG'
        : 'could not be read';
      skipped.push({ name: file.name, reason: hint });
    }
  }
  return { photos, skipped };
}
