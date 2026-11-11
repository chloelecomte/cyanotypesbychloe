import { describe, expect, it } from 'vitest';
import { gridFor, gridRects, panBy, place, NO_VIEW } from './layout';

describe('gridRects', () => {
  it('fills the post inside the margins when cells are auto', () => {
    const [a, b] = gridRects(1000, 1250, { rows: 1, cols: 2, margin: 0.1, gap: 0.02, cellRatio: 'auto' });
    expect(a).toEqual({ x: 100, y: 100, w: 390, h: 1050 });
    expect(b.x).toBe(510);
  });
  it('centers a grid of fixed-shape cells', () => {
    const r = gridRects(1000, 1250, { rows: 1, cols: 1, margin: 0.1, gap: 0, cellRatio: '1:1' });
    expect(r[0]).toEqual({ x: 100, y: 225, w: 800, h: 800 });
  });
});

describe('place', () => {
  const cell = { x: 0, y: 0, w: 100, h: 100 };
  it('shows the whole photo centered in fit mode', () => {
    expect(place(200, 100, cell, 'fit')).toMatchObject({ dx: 0, dy: 25, dw: 100, dh: 50 });
  });
  it('crops the middle in fill mode and follows the pan', () => {
    expect(place(200, 100, cell, 'fill')).toMatchObject({ sx: 50, sw: 100, sh: 100 });
    expect(place(200, 100, cell, 'fill', { zoom: 1, panX: -1, panY: 0 }).sx).toBe(0);
    expect(place(200, 100, cell, 'fill', { zoom: 2, panX: 0, panY: 0 })).toMatchObject({ sx: 75, sy: 25, sw: 50, sh: 50 });
  });
  it('pans only as far as the photo reaches', () => {
    expect(panBy(200, 100, cell, NO_VIEW, 1000, 1000)).toEqual({ zoom: 1, panX: -1, panY: 0 });
    expect(panBy(200, 100, cell, NO_VIEW, -50, 0).panX).toBe(1);
  });
});

describe('gridFor', () => {
  it('picks a full grid when one exists', () => {
    expect(gridFor(16, 1080, 1350)).toEqual({ rows: 4, cols: 4 });
    expect(gridFor(4, 1080, 1350)).toEqual({ rows: 2, cols: 2 });
  });
});
