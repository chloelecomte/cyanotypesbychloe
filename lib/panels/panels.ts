// One continuous picture cut into separate panels: the slides of a carousel, or prints hung side by
// side as a diptych or triptych. Everything is drawn once in a shared "scene", and each panel is that
// scene seen through its own rectangle, so photos that cross from one panel to the next line up.
import type { Rect } from './geometry';

/** Equal panels in rows and columns. The gaps are space between panels: wall space for prints, none for a carousel. */
export type PanelGrid = { rows: number; cols: number; w: number; h: number; gapX: number; gapY: number };

/** Each panel's rectangle in the scene, row by row. */
export function panelRects(g: PanelGrid): Rect[] {
  const out: Rect[] = [];
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) out.push({ x: c * (g.w + g.gapX), y: r * (g.h + g.gapY), w: g.w, h: g.h });
  return out;
}

export const sceneSize = (g: PanelGrid) => ({ w: g.cols * g.w + (g.cols - 1) * g.gapX, h: g.rows * g.h + (g.rows - 1) * g.gapY });

/** The smallest rectangle holding all of them. */
export function bounds(rects: Rect[]): Rect {
  if (!rects.length) return { x: 0, y: 0, w: 0, h: 0 };
  const x = Math.min(...rects.map(r => r.x)), y = Math.min(...rects.map(r => r.y));
  return { x, y, w: Math.max(...rects.map(r => r.x + r.w)) - x, h: Math.max(...rects.map(r => r.y + r.h)) - y };
}

/** Grows (or with a negative amount, shrinks) a rectangle on every side. */
export const inset = (r: Rect, by: number): Rect => ({ x: r.x + by, y: r.y + by, w: Math.max(0, r.w - 2 * by), h: Math.max(0, r.h - 2 * by) });

/** The panels a rectangle touches, by index. A photo in more than one of them crosses a seam. */
export const panelsTouched = (r: Rect, panels: Rect[]) =>
  panels.flatMap((p, i) => (r.x < p.x + p.w && r.x + r.w > p.x && r.y < p.y + p.h && r.y + r.h > p.y ? [i] : []));

/**
 * Draws one panel on a canvas of its own: `scale` pixels per scene unit, with `bleed` extra scene
 * units on every side. `draw` paints the whole scene in scene units; only this panel's part lands.
 */
export function renderPanel(panel: Rect, scale: number, draw: (ctx: CanvasRenderingContext2D) => void, bleed = 0) {
  const c = document.createElement('canvas');
  c.width = Math.round((panel.w + 2 * bleed) * scale);
  c.height = Math.round((panel.h + 2 * bleed) * scale);
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error(`This browser can't make an image ${c.width} × ${c.height} px.`);
  ctx.imageSmoothingQuality = 'high';
  ctx.setTransform(c.width / (panel.w + 2 * bleed), 0, 0, c.height / (panel.h + 2 * bleed), 0, 0);
  ctx.translate(bleed - panel.x, bleed - panel.y);
  draw(ctx);
  return c;
}

/** Encodes a canvas and frees its pixels at once; Safari keeps big canvases around otherwise. */
export async function encode(c: HTMLCanvasElement, type: 'jpeg' | 'png', quality = 0.95) {
  const blob = await new Promise<Blob | null>(r => c.toBlob(r, `image/${type}`, quality));
  c.width = c.height = 0;
  if (!blob) throw new Error('The image was too large for this browser to save.');
  return blob;
}

/** Saves files one after another; browsers drop rapid-fire downloads, so each gets a moment to start. */
export async function downloadAll(files: { blob: Blob; name: string }[], save: (b: Blob, name: string) => void) {
  for (const [i, f] of files.entries()) {
    save(f.blob, f.name);
    if (i < files.length - 1) await new Promise(r => setTimeout(r, 400));
  }
}
