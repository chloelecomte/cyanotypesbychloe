// Straighten & edit: the settings kept with a photo, and turning them into the finished image.
import { applyEdit, NO_EDIT, type Edit } from './tone';
import { measureRatio, outputRatio, outputSize, warp, wholeImage, type Pixels, type Quad, type RatioId } from './straighten';

export type Fix = {
  /** The paper's corners in the original photo's pixels; null keeps the whole photo as it is. */
  quad: Quad | null;
  ratio: RatioId;
  /** The share cut off each edge, 0–0.05. */
  trim: number;
  edit: Edit;
};

export const DEFAULT_FIX: Fix = { quad: null, ratio: 'auto', trim: 0.006, edit: NO_EDIT };

/** The image as it was before any straightening or editing, kept so a fix can be changed or undone. */
export type Original = { src: CanvasImageSource; w: number; h: number; thumb: string };

/** The pixels of an image, scaled to at most `max` on its longest side. */
export function pixelsOf(src: CanvasImageSource, w: number, h: number, max = Infinity): Pixels {
  const s = Math.min(1, max / Math.max(w, h)), c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return ctx.getImageData(0, 0, c.width, c.height);
}

export function toCanvas(px: Pixels, into?: HTMLCanvasElement): HTMLCanvasElement {
  const c = into ?? document.createElement('canvas');
  if (c.width !== px.width) c.width = px.width;
  if (c.height !== px.height) c.height = px.height;
  c.getContext('2d')!.putImageData(new ImageData(px.data as Uint8ClampedArray<ArrayBuffer>, px.width, px.height), 0, 0);
  return c;
}

/** The width : height the fix will produce for a photo w × h. */
export function fixRatio(fix: Fix, w: number, h: number) {
  const q = fix.quad ?? wholeImage(w, h);
  return outputRatio(fix.ratio, fix.quad ? measureRatio(q, w, h) : w / h);
}

/**
 * The straightened paper from `px` (an image `scale` times the original's size), before colour
 * edits, no bigger than `max` on its longest side.
 */
export function straightened(px: Pixels, fix: Fix, origW: number, origH: number, max: number): Pixels {
  const s = px.width / origW;
  const q = (fix.quad ?? wholeImage(origW, origH)).map(p => ({ x: p.x * s, y: p.y * s })) as Quad;
  const size = outputSize(q, fixRatio(fix, origW, origH), fix.trim, max);
  return warp(px, q, size.w, size.h, fix.trim);
}

/** The finished photo at full size (up to `max`). */
export function renderFix(orig: Original, fix: Fix, max: number): HTMLCanvasElement {
  const flat = straightened(pixelsOf(orig.src, orig.w, orig.h), fix, orig.w, orig.h, max);
  return toCanvas(applyEdit(flat, fix.edit));
}

/** A small JPEG of a canvas for the photo list. */
export async function thumbOf(c: HTMLCanvasElement): Promise<string> {
  const t = document.createElement('canvas'), s = Math.min(1, 320 / Math.max(c.width, c.height));
  t.width = Math.round(c.width * s); t.height = Math.round(c.height * s);
  const ctx = t.getContext('2d')!; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(c, 0, 0, t.width, t.height);
  const blob = await new Promise<Blob | null>(r => t.toBlob(r, 'image/jpeg', 0.85));
  return blob ? URL.createObjectURL(blob) : t.toDataURL('image/jpeg', 0.85);
}
