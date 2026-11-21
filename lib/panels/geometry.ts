// Where a photo sits inside a rectangle: whole (fit) or cropped to cover it (fill), with zoom and pan.
// Shared by Post Studio and Print Studio; units are whatever the caller draws in.

export type Rect = { x: number; y: number; w: number; h: number };

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
