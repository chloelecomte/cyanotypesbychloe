import { describe, expect, it } from 'vitest';
import { detectQuad, measureRatio, snapEdges, nearestPaper, orderQuad, outputRatio, squareToQuad, turnQuad, warp, type Pixels, type Pt, type Quad } from './straighten';
import { applyEdit, autoEdit, NO_EDIT } from './tone';

/** Photographs a flat w × h rectangle with a pinhole camera turned by the given angles (radians). */
function project(w: number, h: number, tiltX: number, tiltY: number, spin: number, f: number, cx: number, cy: number): Quad {
  const corners = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
  return corners.map(([x0, y0]) => {
    let x = x0 * Math.cos(spin) - y0 * Math.sin(spin), y = x0 * Math.sin(spin) + y0 * Math.cos(spin), z = 0;
    [y, z] = [y * Math.cos(tiltX) - z * Math.sin(tiltX), y * Math.sin(tiltX) + z * Math.cos(tiltX)];
    [x, z] = [x * Math.cos(tiltY) + z * Math.sin(tiltY), -x * Math.sin(tiltY) + z * Math.cos(tiltY)];
    z += 30;
    return { x: cx + (f * x) / z, y: cy + (f * y) / z };
  }) as Quad;
}

function fill(w: number, h: number, rgb: number[]): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([...rgb, 255], i * 4);
  return { data, width: w, height: h };
}
const inside = (q: Quad, p: Pt) => q.every((a, k) => {
  const b = q[(k + 1) % 4];
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= 0;
});

describe('measureRatio', () => {
  it('recovers the true shape of a tilted print', () => {
    for (const [tx, ty, spin] of [[0.35, 0.1, 0.05], [-0.2, 0.3, -0.1], [0.5, -0.25, 0.3], [0.02, 0.01, 0]]) {
      const q = project(5, 7, tx, ty, spin, 1800, 1500, 2000);
      expect(measureRatio(q, 3000, 4000)).toBeCloseTo(5 / 7, 2);
    }
  });
  it('is right for a print photographed off-centre', () => {
    const q = project(8, 10, 0.3, 0.2, 0.1, 2400, 1500, 2000).map(p => ({ x: p.x + 400, y: p.y - 300 })) as Quad;
    expect(measureRatio(q, 3000, 4000)).toBeCloseTo(8 / 10, 1);
  });
});

describe('quads', () => {
  it('orders corners clockwise from the top-left', () => {
    const q = orderQuad([{ x: 90, y: 95 }, { x: 10, y: 5 }, { x: 5, y: 90 }, { x: 95, y: 10 }]);
    expect(q.map(p => [p.x, p.y])).toEqual([[10, 5], [95, 10], [90, 95], [5, 90]]);
  });
  it('maps the unit square onto the quad', () => {
    const q: Quad = [{ x: 10, y: 20 }, { x: 200, y: 5 }, { x: 220, y: 300 }, { x: 0, y: 260 }];
    const m = squareToQuad(q);
    [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([u, v], i) => {
      const z = m[6] * u + m[7] * v + 1;
      expect((m[0] * u + m[1] * v + m[2]) / z).toBeCloseTo(q[i].x, 6);
      expect((m[3] * u + m[4] * v + m[5]) / z).toBeCloseTo(q[i].y, 6);
    });
  });
  it('turns a quarter turn at a time', () => {
    const q: Quad = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    expect(turnQuad(turnQuad(turnQuad(turnQuad(q))))).toEqual(q);
    expect(turnQuad(q)[0]).toEqual({ x: 0, y: 1 });
  });
  it('turns paper sizes to match the measured orientation', () => {
    expect(outputRatio('5x7', 0.7)).toBeCloseTo(5 / 7);
    expect(outputRatio('5x7', 1.4)).toBeCloseTo(7 / 5);
    expect(outputRatio('auto', 0.6)).toBe(0.6);
    expect(nearestPaper(0.707)[0].id).toMatch(/^a[345]$/);
    expect(nearestPaper(1 / 1.4).map(p => p.id)).toContain('5x7');
    expect(nearestPaper(0.9)).toEqual([]);
  });
});

describe('detectQuad', () => {
  const q: Quad = [{ x: 120, y: 80 }, { x: 380, y: 110 }, { x: 360, y: 450 }, { x: 90, y: 420 }];
  function photo() {
    const img = fill(480, 520, [120, 122, 126]);
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
      if (!inside(q, { x: x + 0.5, y: y + 0.5 })) continue;
      // Paper with a dark blue picture in the middle.
      const dark = x > 170 && x < 320 && y > 180 && y < 360;
      img.data.set(dark ? [20, 55, 110] : [228, 232, 220], (y * img.width + x) * 4);
    }
    return img;
  }
  it('finds the corners of paper on a table', () => {
    const found = detectQuad(photo())!;
    expect(found).not.toBeNull();
    found.forEach((p, i) => { expect(Math.abs(p.x - q[i].x)).toBeLessThan(2.5); expect(Math.abs(p.y - q[i].y)).toBeLessThan(2.5); });
  });
  it('snaps rough corners onto the paper\'s edges', () => {
    const rough = q.map((p, i) => ({ x: p.x + (i % 2 ? 5 : -4), y: p.y + (i < 2 ? -5 : 4) })) as Quad;
    snapEdges(photo(), rough).forEach((p, i) => { expect(Math.abs(p.x - q[i].x)).toBeLessThan(1); expect(Math.abs(p.y - q[i].y)).toBeLessThan(1); });
  });
  it('finds nothing in a photo that is all print', () => {
    const img = fill(400, 500, [228, 232, 220]);
    for (let y = 150; y < 380; y++) for (let x = 100 + (y % 40); x < 300; x++) img.data.set([20, 55, 110], (y * 400 + x) * 4);
    expect(detectQuad(img)).toBeNull();
  });
  it('warps the paper flat', () => {
    const out = warp(photo(), q, 100, 130);
    const at = (x: number, y: number) => [...out.data.slice((y * 100 + x) * 4, (y * 100 + x) * 4 + 3)];
    expect(at(3, 3)).toEqual([228, 232, 220]);
    expect(at(96, 126)).toEqual([228, 232, 220]);
  });
});

describe('tone', () => {
  it('leaves a photo alone with no edit', () => {
    const img = fill(4, 4, [10, 128, 250]);
    expect([...applyEdit(img, NO_EDIT).data.slice(0, 4)]).toEqual([10, 128, 250, 255]);
  });
  it('turns cream paper white and keeps the blues blue', () => {
    const img = fill(100, 100, [214, 222, 196]);
    for (let y = 30; y < 70; y++) for (let x = 30; x < 70; x++) img.data.set([40, 80, 120], (y * 100 + x) * 4);
    const out = applyEdit(img, autoEdit(img)).data;
    const paper = [...out.slice(0, 3)], blue = [...out.slice((50 * 100 + 50) * 4, (50 * 100 + 50) * 4 + 3)];
    expect(Math.max(...paper) - Math.min(...paper)).toBeLessThan(4);
    expect(paper[0]).toBeGreaterThan(235);
    expect(blue[2] - blue[0]).toBeGreaterThan(60);
  });
});
