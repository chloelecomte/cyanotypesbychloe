// Lucide icons rendered to SVG strings, for the studio's static markup and controller.
import {
  ChevronDown, CircleHelp, CloudAlert, CloudCheck, Crop, Download, FlipVertical2, Gauge, LoaderCircle, LogOut,
  Plus, Printer, RotateCcw, RotateCw, Sparkles, Upload, X, type IconNode,
} from 'lucide';

// Lucide names flips by the axis drawn, so FlipVertical2 is the left–right mirror.
const ICONS = {
  chevron: ChevronDown, help: CircleHelp, cloudErr: CloudAlert, cloudOk: CloudCheck, crop: Crop, download: Download,
  flip: FlipVertical2, spinner: LoaderCircle, logout: LogOut, plus: Plus, print: Printer, rotL: RotateCcw,
  rotR: RotateCw, calibrate: Gauge, sparkles: Sparkles, upload: Upload, close: X,
} satisfies Record<string, IconNode>;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, size = 16): string {
  const children = ICONS[name].map(([tag, attrs]) =>
    `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join('');
  return `<svg class="icon icon-${name}" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${children}</svg>`;
}
