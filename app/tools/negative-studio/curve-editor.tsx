'use client';

import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { curvePoint, drawCurve } from '@/lib/negative-studio/canvas';
import { clamp, type Pt } from '@/lib/negative-studio/math';
import { isLinear, LINEAR } from '@/lib/negative-studio/pipeline';
import { HelpTip, SubHeading } from './controls';
import { useStudio } from './use-studio';

/**
 * The negative curve: click to add a point, drag to move, double-click or drag off the box to remove.
 * The last point touched stays selected, so it can also be removed with a button (no double-click on touch screens).
 */
export function CurveEditor() {
  const { settings, curve, response, luts, hist, setCurvePoints } = useStudio();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [active, setActive] = useState(-1), [hover, setHover] = useState(-1), [readout, setReadout] = useState('');
  const [selected, setSelected] = useState<Pt | null>(null);
  const dragOff = useRef(false), reach = useRef(0.045);
  const points = settings.curve || LINEAR, linear = isLinear(points);
  // Only the inner points can go; forget the selection once the curve changes under it (auto-fit, undo…).
  const sel = selected && settings.curve ? points.findIndex(q => q[0] === selected[0] && q[1] === selected[1]) : -1;
  const removable = sel > 0 && sel < points.length - 1;

  useEffect(() => {
    drawCurve(canvas.current!, { hist, response, grad: luts.grad, curve, points, active: active >= 0 ? active : sel, hover });
  }, [hist, response, luts.grad, curve, points, active, sel, hover]);

  function nearest(p: { x: number; y: number }) {
    let best = -1, bd = reach.current;
    points.forEach((q, i) => { const d = Math.hypot(q[0] - p.x, q[1] - p.y); if (d < bd) { bd = d; best = i; } });
    return best;
  }
  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    reach.current = e.pointerType === 'touch' ? 0.08 : 0.045; // fingers cover more than a mouse pointer
    const p = curvePoint(e.currentTarget, e);
    e.currentTarget.setPointerCapture(e.pointerId);
    let i = settings.curve ? nearest(p) : -1;
    let pts = points.map(q => [...q] as Pt);
    if (i < 0) {
      const x = clamp(p.x);
      if (pts.some(q => Math.abs(q[0] - x) < 0.02)) return;
      pts = [...pts, [x, clamp(p.y)] as Pt].sort((a, b) => a[0] - b[0]);
      i = pts.findIndex(q => q[0] === x);
    }
    dragOff.current = false; setActive(i); setSelected(pts[i]); setCurvePoints(pts);
  }
  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const p = curvePoint(e.currentTarget, e);
    setReadout(p.x >= 0 && p.x <= 1 ? `in ${Math.round(clamp(p.x) * 100)}% → out ${Math.round(clamp(curve(clamp(p.x))) * 100)}%` : '');
    if (active < 0) { setHover(settings.curve ? nearest(p) : -1); return; }
    const pts = points.map(q => [...q] as Pt), last = pts.length - 1, i = active;
    const minX = i === 0 ? 0 : pts[i - 1][0] + 0.01, maxX = i === last ? 1 : pts[i + 1][0] - 0.01;
    pts[i] = [+clamp(p.x, minX, maxX).toFixed(4), +clamp(p.y).toFixed(4)];
    dragOff.current = i > 0 && i < last && (p.y < -0.1 || p.y > 1.1);
    setSelected(pts[i]); setCurvePoints(pts);
  }
  function onPointerUp() {
    if (active >= 0 && dragOff.current) { setCurvePoints(points.filter((_, j) => j !== active)); setSelected(null); }
    dragOff.current = false; setActive(-1);
  }
  function onDoubleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const i = nearest(curvePoint(e.currentTarget, e));
    if (settings.curve && i > 0 && i < points.length - 1) { setCurvePoints(points.filter((_, j) => j !== i)); setSelected(null); }
  }
  function removeSelected() {
    if (removable) { setCurvePoints(points.filter((_, j) => j !== sel)); setSelected(null); }
  }

  return (
    <div>
      <div className="mt-3 flex items-center gap-2">
        <SubHeading className="m-0">Negative curve</SubHeading>
        <HelpTip label="About the negative curve">
          <h4>Negative curve</h4>
          <p>Adjusts the negative before it&apos;s printed, so your photo&apos;s tones land where cyanotype can show them. Left is dense ink (stays paper white), right is clear film (prints deep blue).</p>
          <p><b>Auto-fit</b> builds the curve that makes the predicted print match your black &amp; white as closely as the process allows. It follows the process profile and the generic sliders.</p>
          <p><b>Linear</b> means no correction: a plain inverted photo. Use it to see what the process does on its own.</p>
          <p><b>Editing by hand:</b> click to add a point, drag to move it, double-click or drag it off the box to remove it. Compare the rows of the strip at the bottom: the closer &ldquo;Predicted print&rdquo; is to &ldquo;Ideal print&rdquo;, the better.</p>
        </HelpTip>
        <Badge variant="outline" className={settings.curveAuto && !linear ? 'border-success/40 text-success' : 'text-muted-foreground'}>
          {linear ? 'Linear (no correction)' : settings.curveAuto ? 'Auto-fitted' : 'Edited'}
        </Badge>
        <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">{readout}</span>
      </div>
      <canvas
        ref={canvas} width={560} height={560}
        className="mt-1.5 block aspect-square w-full cursor-crosshair touch-none rounded-md bg-[#121417]"
        aria-label="Negative curve editor"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onDoubleClick={onDoubleClick}
        onPointerLeave={() => { setReadout(''); setHover(-1); }}
      />
      <div className="mt-1 flex justify-between gap-2 text-[11px] text-muted-foreground">
        <span>← dense ink (paper white)</span><span className="text-right">clear film (deep blue) →</span>
      </div>
      {removable && (
        <Button variant="outline" size="xs" className="mt-1.5" onClick={removeSelected}><Trash2 />Remove point</Button>
      )}
    </div>
  );
}
