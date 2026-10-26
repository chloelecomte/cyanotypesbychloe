export type Pt = [number, number];
export type RGB = [number, number, number];

export const clamp = (x: number, a = 0, b = 1) => (x < a ? a : x > b ? b : x);

// Monotone cubic (Fritsch–Carlson) interpolation: smooth, never overshoots
export function monotone(xs: number[], ys: number[]): (x: number) => number {
  const n = xs.length;
  if (n === 1) return () => ys[0];
  const dx: number[] = [], sec: number[] = [], m: number[] = new Array(n);
  for (let i = 0; i < n - 1; i++) { dx[i] = xs[i + 1] - xs[i]; sec[i] = (ys[i + 1] - ys[i]) / dx[i]; }
  m[0] = sec[0]; m[n - 1] = sec[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = sec[i - 1] * sec[i] <= 0 ? 0 : (sec[i - 1] + sec[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (sec[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / sec[i], b = m[i + 1] / sec[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * sec[i]; m[i + 1] = t * b * sec[i]; }
  }
  return x => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] > x) hi = mid; else lo = mid; }
    const h = dx[lo], t = (x - xs[lo]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[lo] + (t3 - 2 * t2 + t) * h * m[lo] + (-2 * t3 + 3 * t2) * ys[lo + 1] + (t3 - t2) * h * m[lo + 1];
  };
}

export const s2l = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
export const l2s = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

export function lstar(r: number, g: number, b: number) {
  const Y = 0.2126 * s2l(r / 255) + 0.7152 * s2l(g / 255) + 0.0722 * s2l(b / 255);
  return Y > 0.008856 ? 116 * Math.cbrt(Y) - 16 : 903.3 * Y;
}

export const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
