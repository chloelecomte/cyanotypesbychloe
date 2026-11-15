import { describe, expect, it } from 'vitest';
import { boxForPhoto, layoutBoxes, moveBox, refill, resizeBox, slidesOf, snapTargets, splitBox, type Carousel } from './carousel';

const c: Carousel = { slides: 3, margin: 0.1, gap: 0.04, layout: 'bridge', count: 7, seed: 3 };
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

describe('mosaic', () => {
  const area = (bs: { w: number; h: number }[], aspect: number) => bs.reduce((a, b) => a + b.w * b.h * aspect, 0);
  it('tiles the strip with the asked-for number of tiles, without overlaps', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const b = layoutBoxes('mosaic', { ...c, gap: 0, margin: 0, seed }, 1.25);
      expect(b).toHaveLength(7);
      expect(area(b, 1.25)).toBeCloseTo(3 * 1.25, 9); // gapless tiles fill all three slides exactly
      for (const x of b) expect(x.w).toBeGreaterThan(0.1);
    }
  });
  it('is the same for the same seed and changes with a shuffle', () => {
    expect(layoutBoxes('mosaic', c, 1.25)).toEqual(layoutBoxes('mosaic', c, 1.25));
    expect(layoutBoxes('mosaic', { ...c, seed: 4 }, 1.25)).not.toEqual(layoutBoxes('mosaic', c, 1.25));
  });
  it('crosses at least one seam', () => {
    const b = layoutBoxes('mosaic', c, 1.25);
    expect(b.some(x => slidesOf(x, 3).length > 1)).toBe(true);
  });
});

describe('frame tools', () => {
  it('splits a frame in two with the gap between', () => {
    const [a, b] = splitBox({ x: 0, y: 0, w: 1, h: 1 }, 'v', 0.1, 1);
    expect([a.w, b.x]).toEqual([0.45, 0.55]);
    const [t, u] = splitBox({ x: 0, y: 0, w: 1, h: 1 }, 'h', 0.1, 2);
    expect([t.h, u.y]).toEqual([0.475, 0.525]);
  });
  it('reshapes a frame to its photo, keeping height and center', () => {
    const b = boxForPhoto({ x: 1, y: 0.1, w: 1, h: 0.8 }, 1.5, 1.25); // 0.8 slide heights = 1 slide width
    expect(b.w).toBeCloseTo(1.5);
    expect(b.x + b.w / 2).toBeCloseTo(1.5);
  });
});
