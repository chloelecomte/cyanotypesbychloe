'use client';

// Small building blocks shared by the studio's panels.
import { useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/** A labelled slider with its value on the right. Double-click resets it. */
export function SliderRow({ label, value, min, max, step, def, format, onChange, hint }: {
  label: string; value: number; min: number; max: number; step: number; def: number;
  format: (v: number) => string; onChange: (v: number) => void; hint?: string;
}) {
  const id = useId();
  const row = (
    <div className="grid gap-2 py-1.5" onDoubleClick={() => onChange(def)}>
      <div className="flex items-center justify-between text-xs">
        <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">{label}</Label>
        <output htmlFor={id} className="tabular-nums text-foreground">{format(value)}</output>
      </div>
      <Slider id={id} value={[value]} min={min} max={max} step={step} onValueChange={([v]) => onChange(v)} aria-label={label} />
    </div>
  );
  if (!hint) return row;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{row}</TooltipTrigger>
      <TooltipContent side="right" className="max-w-60">{hint}</TooltipContent>
    </Tooltip>
  );
}

/** A number input that lets you type freely and only reports valid, non-negative numbers. */
export function NumberField({ id, value, onChange, ...props }: Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange'> & {
  value: number; onChange: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const [shown, setShown] = useState(value);
  if (value !== shown) { setShown(value); setText(String(value)); }
  return (
    <Input
      id={id} type="number" inputMode="decimal" value={text} {...props}
      onChange={e => {
        setText(e.target.value);
        const v = parseFloat(e.target.value);
        if (isFinite(v) && v >= 0) { setShown(v); onChange(v); }
      }}
      onBlur={() => setText(String(value))}
    />
  );
}

/** A labelled form field. */
export function Field({ label, htmlFor, className, children }: { label: string; htmlFor: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('grid gap-1.5', className)}>
      <Label htmlFor={htmlFor} className="text-xs font-normal text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

/** An icon-only button with a tooltip, which also serves as its accessible name. */
export function IconButton({ label, children, ...props }: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} {...props}>{children}</Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Small explanatory text under a control. */
export function Tip({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn('text-xs leading-relaxed text-muted-foreground [&_b]:font-medium [&_b]:text-foreground', className)}>{children}</p>;
}

export function SubHeading({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h3 className={cn('mt-4 mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground', className)}>{children}</h3>;
}

/**
 * Runs slow work (building a big negative) with a spinner on the button. The short pause lets the
 * spinner paint before the main thread is blocked.
 */
export function useBusy() {
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<unknown> | unknown) {
    setBusy(true);
    await new Promise(r => setTimeout(r, 30));
    try { await fn(); }
    catch (e) { toast.error('Something went wrong', { description: (e as Error).message }); }
    finally { setBusy(false); }
  }
  return [busy, run] as const;
}

export function BusyButton({ busy, icon, children, ...props }: React.ComponentProps<typeof Button> & { busy: boolean; icon: React.ReactNode }) {
  return (
    <Button disabled={busy || props.disabled} {...props}>
      {busy ? <Loader2 className="animate-spin" /> : icon}
      {busy ? 'Working…' : children}
    </Button>
  );
}
