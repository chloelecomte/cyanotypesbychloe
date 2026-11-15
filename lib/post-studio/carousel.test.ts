import { describe, expect, it } from 'vitest';
import { layoutBoxes, moveBox, refill, resizeBox, slidesOf, snapTargets, type Carousel } from './carousel';

const c: Carousel = { slides: 3, margin: 0.1, gap: 0.04, layout: 'bridge' };
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 9);

describe('layoutBoxes', () => {
  it('bridge: half-slide photos at the ends, and one centered on every seam', () => {
    const b = layoutBoxes('bridge', c, 1.25);
    expect(b).toHaveLength(4);
    close(b[0].x, 0.1); close(b[0].x + b[0].w, 0.48);
    close(b[1].x, 0.52); close(b[1].x + b[1].w, 1.48);
    close(b[3].x + b[3].w, 2.9);
    close(b[0].y, 0.08); close(b[0].h, 0.84); // margin is a share of the width: 0.1 / 1.25
    expect(slidesOf(b[1], 3)).toEqual([0, 1]);
  });
  it('panorama spans every slide; one each stays inside each slide', () => {
    expect(layoutBoxes('panorama', c, 1)[0]).toMatchObject({ x: 0.1, w: 2.8 });
    expect(layoutBoxes('single', c, 1).map(b => slidesOf(b, 3))).toEqual([[0], [1], [2]]);
  });
});

describe('refill', () => {
  it('keeps photos and crops in order', () => {
    let id = 100;
    const old = refill(layoutBoxes('single', c, 1), [], () => id++).map((f, i) => ({ ...f, photoId: i === 1 ? null : i, zoom: i + 1 }));
    const next = refill(layoutBoxes('panorama', c, 1), old, () => id++);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ photoId: 0, zoom: 1 });
    expect(refill(layoutBoxes('single', c, 1), old, () => id++).map(f => f.photoId)).toEqual([0, 2, null]);
  });
});

describe('snapping', () => {
  const t = snapTargets(c, 1, []);
  it('pulls a nearby edge onto a seam', () => {
    const b = moveBox({ x: 0.5, y: 0.1, w: 0.48, h: 0.8 }, 0.01, 0, t, 0.02, 0.02);
    close(b.x + b.w, 1); // right edge snapped from 0.99 to the seam
  });
  it('leaves edges alone when nothing is close', () => {
    expect(moveBox({ x: 0.3, y: 0.3, w: 0.33, h: 0.3 }, 0.003, 0, t, 0, 0).x).toBeCloseTo(0.303);
  });
  it('resizes from one handle and keeps a minimum size', () => {
    const b = resizeBox({ x: 1, y: 0.1, w: 1, h: 0.8 }, 'e', -2, 0, t, 0.02, 0.02, 1);
    expect(b.x).toBe(1);
    expect(b.w).toBeCloseTo(0.04);
    const c2 = resizeBox({ x: 1, y: 0.1, w: 0.5, h: 0.8 }, 'se', 0.39, 0.095, t, 0.02, 0.02, 1);
    close(c2.x + c2.w, 1.9); // onto the right margin of slide 2
    close(c2.y + c2.h, 1); // onto the bottom edge
  });
});
