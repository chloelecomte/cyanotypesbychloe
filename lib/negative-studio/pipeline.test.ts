import { describe, expect, it } from 'vitest';
import { monotone, lstar } from './math';
import { countDistinct, curveFn, fitCurve, gradientStops, GENERIC_GRADIENT, readingsToDarkness, responseFn, toneFn } from './pipeline';
import { crc32, decodeAcv, encodeAcv, normalizeImportedCurve, parseLutText, withPhys } from './files';
import { DEFAULT_SETTINGS, mergeSettings } from './types';
import { safeNext } from '@/lib/safe-next';

const model = DEFAULT_SETTINGS.model;

describe('monotone', () => {
  it('passes through the points and never overshoots', () => {
    const f = monotone([0, 0.5, 1], [0, 0.9, 1]);
    expect(f(0)).toBe(0);
    expect(f(0.5)).toBeCloseTo(0.9);
    for (let x = 0; x <= 1; x += 0.01) expect(f(x)).toBeLessThanOrEqual(1 + 1e-9);
  });
});

describe('auto-fit', () => {
  it('makes the generic response print linearly: R(C(n)) ≈ n', () => {
    const R = responseFn(null, model), C = curveFn(fitCurve(R));
    const lo = R(0), hi = R(1);
    for (const n of [0.1, 0.3, 0.5, 0.7, 0.9]) expect((R(C(n)) - lo) / (hi - lo)).toBeCloseTo(n, 1);
  });

  it('inverts a calibrated response', () => {
    const darkness = Array.from({ length: 21 }, (_, i) => Math.pow(i / 20, 0.5));
    const R = responseFn({ darkness, colors: null }, model), C = curveFn(fitCurve(R));
    for (const n of [0.2, 0.5, 0.8]) expect(R(C(n))).toBeCloseTo(n, 1);
  });
});

describe('calibration readings', () => {
  it('normalizes L* to monotone darkness 0..1', () => {
    const L = [96, 94, 95, 80, 70, 60, 50, 45, 40, 35, 30, 28, 26, 24, 22, 21, 20, 20, 19, 19, 19];
    const d = readingsToDarkness(L);
    expect(d[0]).toBe(0);
    expect(d[20]).toBe(1);
    for (let i = 1; i < 21; i++) expect(d[i]).toBeGreaterThanOrEqual(d[i - 1]);
  });

  it('counts distinct tones', () => {
    expect(countDistinct([0, 0, 0.5, 0.5, 1])).toBe(3);
  });

  it('computes L* for white and black', () => {
    expect(lstar(255, 255, 255)).toBeCloseTo(100, 0);
    expect(lstar(0, 0, 0)).toBe(0);
  });

  it('falls back to the generic gradient without scanned colours', () => {
    expect(gradientStops({ darkness: new Array(21).fill(0), colors: null })).toBe(GENERIC_GRADIENT);
  });
});

describe('tone', () => {
  it('is the identity at default settings', () => {
    const t = toneFn(DEFAULT_SETTINGS.tone);
    for (const x of [0, 0.25, 0.5, 1]) expect(t(x)).toBeCloseTo(x, 5);
  });
});

describe('files', () => {
  it('round-trips .acv curves', () => {
    const pts: [number, number][] = [[0, 0], [0.5, 0.6], [1, 1]];
    const back = decodeAcv(encodeAcv(pts));
    back.forEach((p, i) => { expect(p[0]).toBeCloseTo(pts[i][0], 2); expect(p[1]).toBeCloseTo(pts[i][1], 2); });
  });

  it('parses a 1D .cube LUT', () => {
    const text = 'TITLE "x"\nLUT_1D_SIZE 3\n0 0 0\n0.4 0.4 0.4\n1 1 1\n';
    expect(parseLutText(text)).toEqual([[0, 0], [0.5, 0.4], [1, 1]]);
  });

  it('flips curves made for the positive', () => {
    expect(normalizeImportedCurve([[0, 0.2], [1, 0.9]], true)).toEqual([[0, 0.09999999999999998], [1, 0.8]]);
  });

  it('inserts a valid pHYs chunk after IHDR', () => {
    const png = new Uint8Array(40);
    const out = withPhys(png, 300);
    expect(out.length).toBe(61);
    expect(String.fromCharCode(...out.subarray(37, 41))).toBe('pHYs');
    const dv = new DataView(out.buffer);
    expect(dv.getUint32(41)).toBe(Math.round(300 / 0.0254));
    expect(dv.getUint32(50)).toBe(crc32(out.subarray(37, 50)));
  });
});

describe('settings', () => {
  it('fills defaults and ignores junk', () => {
    const s = mergeSettings({ tone: { exposure: 1, contrast: 'x' }, bogus: 1, curve: [[0, 0], [1, 1]], curveByProfile: { a: { curve: null, curveAuto: true } } });
    expect(s.tone.exposure).toBe(1);
    expect(s.tone.contrast).toBe(0);
    expect(s.curve).toEqual([[0, 0], [1, 1]]);
    expect(s.curveByProfile.a).toEqual({ curve: null, curveAuto: true });
    expect('bogus' in s).toBe(false);
  });
});

describe('safeNext', () => {
  it('only allows same-site paths', () => {
    expect(safeNext('/tools/negative-studio?x=1')).toBe('/tools/negative-studio?x=1');
    expect(safeNext('//evil.com')).toBe('/tools/negative-studio');
    expect(safeNext('/\\evil.com')).toBe('/tools/negative-studio');
    expect(safeNext('https://evil.com')).toBe('/tools/negative-studio');
    expect(safeNext(undefined, '/')).toBe('/');
  });
});
