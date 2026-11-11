// Post layout: Instagram formats, where each photo goes on the canvas, and which part of it shows.
// Every distance is a fraction of the canvas width, so the preview and the export match exactly.

export const FORMATS = [
  { id: 'portrait', label: 'Portrait', ratio: '4:5', w: 1080, h: 1350 },
  { id: 'grid', label: 'Tall', ratio: '3:4', w: 1080, h: 1440 },
  { id: 'square', label: 'Square', ratio: '1:1', w: 1080, h: 1080 },
  { id: 'landscape', label: 'Landscape', ratio: '1.91:1', w: 1080, h: 566 },
  { id: 'story', label: 'Story', ratio: '9:16', w: 1080, h: 1920 },
] as const;
export type FormatId = (typeof FORMATS)[number]['id'];
export const format = (id: FormatId) => FORMATS.find(f => f.id === id) ?? FORMATS[0];

/** Fixed width:height for collage cells, or 'auto' to fill the space left by the margins. */
export const CELL_RATIOS = ['auto', '1:1', '4:5', '3:4', '2:3', '3:2'] as const;
export type CellRatio = (typeof CELL_RATIOS)[number];
const ratioValue = (r: CellRatio) => { const [w, h] = r.split(':').map(Number); return w / h; };

export type Rect = { x: number; y: number; w: number; h: number };

export type Grid = { rows: number; cols: number; margin: number; gap: number; cellRatio: CellRatio };

/** Cell rectangles in row order, centered on a W×H canvas. */
export function gridRects(W: number, H: number, g: Grid): Rect[] {
  const m = g.margin * W, gap = g.gap * W;
  let cw = Math.max(1, (W - 2 * m - (g.cols - 1) * gap) / g.cols);
  let ch = Math.max(1, (H - 2 * m - (g.rows - 1) * gap) / g.rows);
  if (g.cellRatio !== 'auto') {
    const r = ratioValue(g.cellRatio);
    if (cw / ch > r) cw = ch * r; else ch = cw / r;
  }
  const x0 = (W - (g.cols * cw + (g.cols - 1) * gap)) / 2, y0 = (H - (g.rows * ch + (g.rows - 1) * gap)) / 2;
  const rects: Rect[] = [];
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) rects.push({ x: x0 + c * (cw + gap), y: y0 + r * (ch + gap), w: cw, h: ch });
  return rects;
}

/**
 * How a photo sits in a cell. 'fit' shows the whole photo, centered (the white-border look);
 * 'fill' covers the cell, magnified by zoom (≥ 1) and shifted by pan (-1 = left/top edge, 1 = right/bottom).
 */
export type Fit = 'fit' | 'fill';
export type View = { zoom: number; panX: number; panY: number };
export const NO_VIEW: View = { zoom: 1, panX: 0, panY: 0 };

export type Placement = { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number };

export function place(iw: number, ih: number, cell: Rect, fit: Fit, v: View = NO_VIEW): Placement {
  if (fit === 'fit') {
    const s = Math.min(cell.w / iw, cell.h / ih), dw = iw * s, dh = ih * s;
    return { sx: 0, sy: 0, sw: iw, sh: ih, dx: cell.x + (cell.w - dw) / 2, dy: cell.y + (cell.h - dh) / 2, dw, dh };
  }
  const s = coverScale(iw, ih, cell, v.zoom), sw = cell.w / s, sh = cell.h / s;
  return { sx: (iw - sw) * (v.panX + 1) / 2, sy: (ih - sh) * (v.panY + 1) / 2, sw, sh, dx: cell.x, dy: cell.y, dw: cell.w, dh: cell.h };
}

const coverScale = (iw: number, ih: number, cell: Rect, zoom: number) => Math.max(cell.w / iw, cell.h / ih) * Math.max(1, zoom);

/** The view after dragging the photo by (dx, dy) canvas pixels inside a 'fill' cell. */
export function panBy(iw: number, ih: number, cell: Rect, v: View, dx: number, dy: number): View {
  const s = coverScale(iw, ih, cell, v.zoom);
  const slackX = iw * s - cell.w, slackY = ih * s - cell.h; // how far the photo can move, in canvas pixels
  const clamp = (n: number) => Math.min(1, Math.max(-1, n));
  return {
    ...v,
    panX: slackX > 0.5 ? clamp(v.panX - 2 * dx / slackX) : 0,
    panY: slackY > 0.5 ? clamp(v.panY - 2 * dy / slackY) : 0,
  };
}

/** Rows × columns that hold n photos with the least empty space, preferring tall grids for tall posts. */
export function gridFor(n: number, W: number, H: number): { rows: number; cols: number } {
  let best = { rows: 1, cols: 1 }, bestScore = Infinity;
  for (let cols = 1; cols <= 6; cols++) for (let rows = 1; rows <= 6; rows++) {
    if (rows * cols < n) continue;
    const empty = rows * cols - n, shape = Math.abs(Math.log((W / cols) / (H / rows)));
    const score = empty * 2 + shape;
    if (score < bestScore) { best = { rows, cols }; bestScore = score; }
  }
  return best;
}
