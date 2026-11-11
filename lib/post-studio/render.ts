// Loading photos and drawing the post, for the preview and at full size for export.
import { format, gridRects, place, type Fit, type FormatId, type Grid, type Rect, type View } from './layout';

export type Photo = { id: number; name: string; src: CanvasImageSource; w: number; h: number; thumb: string };

/** Largest side kept in memory. The biggest export is 3240 px wide, so more never shows. */
const MAX_SIDE = 4096;

export async function decodePhoto(file: File, id: number): Promise<Photo> {
  let src: ImageBitmap | HTMLImageElement;
  try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    src = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image(); i.onload = () => { URL.revokeObjectURL(i.src); res(i); }; i.onerror = () => rej(new Error(`Couldn't open ${file.name || 'that file'}`));
      i.src = URL.createObjectURL(file);
    });
  }
  let w = 'naturalWidth' in src ? src.naturalWidth : src.width, h = 'naturalHeight' in src ? src.naturalHeight : src.height;
  let out: CanvasImageSource = src;
  if (Math.max(w, h) > MAX_SIDE) {
    const s = MAX_SIDE / Math.max(w, h), c = document.createElement('canvas');
    c.width = Math.round(w * s); c.height = Math.round(h * s);
    const ctx = c.getContext('2d')!; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(src, 0, 0, c.width, c.height);
    if ('close' in src) src.close();
    out = c; w = c.width; h = c.height;
  }
  return { id, name: (file.name || '').replace(/\.[^.]+$/, '').trim() || `Photo ${id}`, src: out, w, h, thumb: URL.createObjectURL(file) };
}

export type Cell = { photoId: number | null } & View;

export type Design = {
  mode: 'border' | 'collage';
  format: FormatId;
  background: string;
  border: { margin: number };
  collage: Grid & { fit: Fit };
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
  const blob = await new Promise<Blob | null>(r => c.toBlob(r, `image/${ex.type}`, 0.95));
  c.width = c.height = 0; // free the pixels now; Safari keeps big canvases around otherwise
  if (!blob) throw new Error('Could not encode the image.');
  return blob;
}

export function exportName(base: string, d: Design, ex: ExportSettings) {
  const safe = base.replace(/[^\w\- ]+/g, '').trim() || 'post';
  return `${safe} - ${d.mode === 'border' ? 'border' : 'collage'} ${format(d.format).ratio.replace(':', 'x')}.${ex.type === 'jpeg' ? 'jpg' : 'png'}`;
}
