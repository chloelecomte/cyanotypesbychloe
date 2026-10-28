'use client';

// Small building blocks shared by the studio's panels.
import { useId, useState, useSyncExternalStore } from 'react';
import { CircleHelp, Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/** Phone-sized screens get the stacked layout; keep in step with Tailwind's `md` breakpoint. */
export const MOBILE = '(max-width: 767px)';
/** Fingers rather than a mouse: no hover, no double-click, bigger targets. */
export const TOUCH = '(pointer: coarse)';

/** Whether a media query matches. Renders as false on the server, then updates on the client. */
export function useMedia(query: string) {
  return useSyncExternalStore(
    onChange => {
      const m = matchMedia(query);
      m.addEventListener('change', onChange);
      return () => m.removeEventListener('change', onChange);
    },
    () => matchMedia(query).matches,
    () => false,
  );
}

/** A labelled slider with its value on the right. Double-click, or the reset button once it has moved, resets it. */
export function SliderRow({ label, value, min, max, step, def, format, onChange, hint }: {
  label: string; value: number; min: number; max: number; step: number; def: number;
  format: (v: number) => string; onChange: (v: number) => void; hint?: React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="grid gap-2 py-1.5 pointer-coarse:py-2" onDoubleClick={() => onChange(def)}>
      <div className="flex min-h-5 items-center gap-1 text-xs">
        <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">{label}</Label>
        {hint && <HelpTip label={`About ${label.toLowerCase()}`}>{hint}</HelpTip>}
        {value !== def && (
          <button
            type="button" aria-label={`Reset ${label.toLowerCase()}`} title="Reset" onClick={() => onChange(def)}
            className="ml-auto rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground pointer-coarse:-my-2 pointer-coarse:p-2"
          ><RotateCcw className="size-3" /></button>
        )}
        <output htmlFor={id} className={cn('tabular-nums text-foreground', value === def && 'ml-auto')}>{format(value)}</output>
      </div>
      <Slider id={id} value={[value]} min={min} max={max} step={step} onValueChange={([v]) => onChange(v)} aria-label={label} />
    </div>
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

/** A labelled form field, optionally with a help button after the label. */
export function Field({ label, htmlFor, help, className, children }: {
  label: string; htmlFor: string; help?: React.ReactNode; className?: string; children: React.ReactNode;
}) {
  return (
    <div className={cn('grid gap-1.5', className)}>
      <div className="flex items-center gap-1">
        <Label htmlFor={htmlFor} className="text-xs font-normal text-muted-foreground">{label}</Label>
        {help && <HelpTip label={`About ${label.toLowerCase()}`}>{help}</HelpTip>}
      </div>
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

/** A small ? button that opens an explanation: beside the control on wide screens, below it on phones. */
export function HelpTip({ label, children }: { label: string; children: React.ReactNode }) {
  const mobile = useMedia(MOBILE);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={label} className="rounded-full text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none pointer-coarse:-m-2 pointer-coarse:p-2">
          <CircleHelp className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={mobile ? 'bottom' : 'right'} align={mobile ? 'center' : 'start'} collisionPadding={12}
        className="max-h-[min(28rem,var(--radix-popover-content-available-height))] w-[min(20rem,calc(100vw-1.5rem))] overflow-y-auto text-xs leading-relaxed text-muted-foreground [&_b]:font-medium [&_b]:text-foreground [&_h4]:mb-1 [&_h4]:text-[13px] [&_h4]:font-semibold [&_h4]:text-foreground [&_p+h4]:mt-3 [&_p+p]:mt-2"
      >
        {children}
      </PopoverContent>
    </Popover>
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
