import { describe, expect, it } from 'vitest';
import { bounds, inset, panelRects, panelsTouched, sceneSize } from './panels';

describe('panelRects', () => {
  it('lays out a triptych with wall gaps between the panels', () => {
    const g = { rows: 1, cols: 3, w: 8, h: 10, gapX: 2, gapY: 2 };
    expect(panelRects(g).map(r => r.x)).toEqual([0, 10, 20]);
    expect(sceneSize(g)).toEqual({ w: 28, h: 10 });
  });
  it('runs row by row', () => {
    const r = panelRects({ rows: 2, cols: 2, w: 1, h: 1, gapX: 0, gapY: 0.5 });
    expect(r[2]).toEqual({ x: 0, y: 1.5, w: 1, h: 1 });
  });
});

describe('helpers', () => {
  it('bounds and inset', () => {
    expect(bounds([{ x: 1, y: 2, w: 3, h: 4 }, { x: 5, y: 0, w: 1, h: 1 }])).toEqual({ x: 1, y: 0, w: 5, h: 6 });
    expect(inset({ x: 0, y: 0, w: 10, h: 8 }, 1)).toEqual({ x: 1, y: 1, w: 8, h: 6 });
  });
  it('finds every panel a rectangle crosses', () => {
    const panels = panelRects({ rows: 1, cols: 3, w: 1, h: 1, gapX: 0, gapY: 0 });
    expect(panelsTouched({ x: 0.5, y: 0, w: 1, h: 1 }, panels)).toEqual([0, 1]);
    expect(panelsTouched({ x: 1, y: 0, w: 1, h: 1 }, panels)).toEqual([1]);
  });
});
