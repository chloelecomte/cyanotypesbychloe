// Loading photos and drawing the post, for the preview and at full size for export.
import { encode, renderPanel } from '@/lib/panels/panels';
import { frameRect, type Carousel, type Frame } from './carousel';
import { format, gridRects, place, type Fit, type FormatId, type Grid, type Rect, type View } from './layout';

export type Photo = { id: number; name: string; src: CanvasImageSource; w: number; h: number; thumb: string };

/**
 * Largest side kept in memory. A single post is at most 3240 px wide, so more never shows; only a photo
 * stretched across several carousel slides at 2× or 3× is drawn larger, and a little softer.
 */
const MAX_SIDE = 4096;

export async function decodePhoto(file: File, id: number): Promise<Photo> {
  const { src, w, h } = await openImage(file);
  const out = downscale(src, w, h, MAX_SIDE);
  return { id, name: photoName(file, id), src: out.src, w: out.w, h: out.h, thumb: URL.createObjectURL(file) };
}

export const photoName = (file: File, id: number) => (file.name || '').replace(/\.[^.]+$/, '').trim() || `Photo ${id}`;

/** Opens an image file the right way up, at full size. */
export async function openImage(file: File): Promise<{ src: ImageBitmap | HTMLImageElement; w: number; h: number }> {
  let src: ImageBitmap | HTMLImageElement;
  try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    src = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image(); i.onload = () => { URL.revokeObjectURL(i.src); res(i); }; i.onerror = () => rej(new Error(`Couldn't open ${file.name || 'that file'}`));
      i.src = URL.createObjectURL(file);
    });
  }
  const w = 'naturalWidth' in src ? src.naturalWidth : src.width, h = 'naturalHeight' in src ? src.naturalHeight : src.height;
  return { src, w, h };
}

/** A copy no larger than `max` on its longest side (the original itself if it's already small enough). */
export function downscale(src: ImageBitmap | HTMLImageElement, w: number, h: number, max: number, keep = false): { src: CanvasImageSource; w: number; h: number } {
  if (Math.max(w, h) <= max) return { src, w, h };
  const s = max / Math.max(w, h), c = document.createElement('canvas');
  c.width = Math.round(w * s); c.height = Math.round(h * s);
  const ctx = c.getContext('2d')!; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(src, 0, 0, c.width, c.height);
  if (!keep && 'close' in src) src.close();
  return { src: c, w: c.width, h: c.height };
}

export type Cell = { photoId: number | null } & View;

export type Design = {
  mode: 'border' | 'collage' | 'carousel';
  format: FormatId;
  background: string;
  border: { margin: number };
  collage: Grid & { fit: Fit };
  carousel: Carousel;
};

/** Where the photos go on a canvas W pixels wide, for either mode. */
export function designRects(d: Design, W: number, H: number): Rect[] {
  return d.mode === 'border'
    ? gridRects(W, H, { rows: 1, cols: 1, margin: d.border.margin, gap: 0, cellRatio: 'auto' })
    : gridRects(W, H, d.collage);
}

/**
 * Draws the post on a canvas of any size. In border mode `cells` holds just the photo shown;
 * missing photos leave the background showing (and `placeholder` marks the empty cells).
 */
export function drawPost(ctx: CanvasRenderingContext2D, d: Design, cells: Cell[], photos: Map<number, Photo>, placeholder?: string) {
  const { width: W, height: H } = ctx.canvas;
  ctx.fillStyle = d.background; ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingQuality = 'high';
  const fit: Fit = d.mode === 'border' ? 'fit' : d.collage.fit;
  designRects(d, W, H).forEach((r, i) => {
    const cell = cells[i], p = cell?.photoId != null ? photos.get(cell.photoId) : undefined;
    if (!p) {
      if (placeholder) { ctx.fillStyle = placeholder; ctx.fillRect(r.x, r.y, r.w, r.h); }
      return;
    }
    const q = place(p.w, p.h, r, fit, cell);
    ctx.save();
    ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
    ctx.drawImage(p.src, q.sx, q.sy, q.sw, q.sh, q.dx, q.dy, q.dw, q.dh);
    ctx.restore();
  });
}

export type ExportSettings = { scale: 1 | 2 | 3; type: 'jpeg' | 'png' };

export async function exportPost(d: Design, cells: Cell[], photos: Map<number, Photo>, ex: ExportSettings): Promise<Blob> {
  const f = format(d.format), c = document.createElement('canvas');
  c.width = f.w * ex.scale; c.height = f.h * ex.scale;
  drawPost(c.getContext('2d')!, d, cells, photos);
  return encode(c, ex.type);
}

export function exportName(base: string, d: Design, ex: ExportSettings, slide?: number) {
  const safe = base.replace(/[^\w\- ]+/g, '').trim() || 'post';
  const part = slide == null ? '' : ` - ${String(slide + 1).padStart(2, '0')} of ${d.carousel.slides}`;
  return `${safe} - ${d.mode} ${format(d.format).ratio.replace(':', 'x')}${part}.${ex.type === 'jpeg' ? 'jpg' : 'png'}`;
}

/**
 * Draws a whole carousel strip (every slide side by side) in post pixels: slide i spans x from i·W to
 * (i+1)·W. Later frames sit on top of earlier ones; empty frames show `placeholder` if given.
 */
export function drawCarousel(ctx: CanvasRenderingContext2D, d: Design, frames: Frame[], photos: Map<number, Photo>, placeholder?: string) {
  const { w: W, h: H } = format(d.format);
  ctx.fillStyle = d.background; ctx.fillRect(0, 0, d.carousel.slides * W, H);
  ctx.imageSmoothingQuality = 'high';
  for (const f of frames) {
    const r = frameRect(f, W, H), p = f.photoId != null ? photos.get(f.photoId) : undefined;
    if (!p) {
      if (placeholder) { ctx.fillStyle = placeholder; ctx.fillRect(r.x, r.y, r.w, r.h); }
      continue;
    }
    const q = place(p.w, p.h, r, 'fill', f);
    ctx.save();
    ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
    ctx.drawImage(p.src, q.sx, q.sy, q.sw, q.sh, q.dx, q.dy, q.dw, q.dh);
    ctx.restore();
  }
}

/** Each slide of a carousel as its own image, in order. */
export async function exportSlides(d: Design, frames: Frame[], photos: Map<number, Photo>, ex: ExportSettings): Promise<Blob[]> {
  const { w: W, h: H } = format(d.format), out: Blob[] = [];
  for (let i = 0; i < d.carousel.slides; i++) {
    const c = renderPanel({ x: i * W, y: 0, w: W, h: H }, ex.scale, ctx => drawCarousel(ctx, d, frames, photos));
    out.push(await encode(c, ex.type));
  }
  return out;
}
