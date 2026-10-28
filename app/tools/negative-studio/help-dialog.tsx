import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function HelpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-0 max-sm:h-dvh max-sm:max-h-none max-sm:max-w-none max-sm:rounded-none max-sm:border-0 max-sm:pt-[env(safe-area-inset-top)] max-sm:pb-[env(safe-area-inset-bottom)] p-0 max-sm:h-dvh max-sm:max-h-none max-sm:max-w-none max-sm:rounded-none max-sm:border-0 max-sm:pt-[env(safe-area-inset-top)] max-sm:pb-[env(safe-area-inset-bottom)] sm:max-w-2xl">
        <DialogHeader className="border-b py-4 pr-12 pl-6 text-left max-sm:pl-4">
          <DialogTitle>How digital negatives for cyanotype work</DialogTitle>
        </DialogHeader>
        <div className="grid min-h-0 gap-1 overflow-y-auto overscroll-contain px-6 max-sm:px-4 pt-2 pb-6 text-[13px] leading-relaxed text-foreground/85 [&_b]:text-foreground [&_h3]:mt-4 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-foreground">
          <h3>The short version</h3>
          <ol className="list-decimal space-y-1 pl-5">
            <li><b>Edit</b> your photo as a black &amp; white positive that looks the way you want the print to look.</li>
            <li>The app <b>inverts</b> it into a negative: light areas of the photo become dark ink that blocks UV, so the paper stays white there.</li>
            <li>A <b>curve</b> corrects the negative. Cyanotype only &ldquo;sees&rdquo; part of the tonal range — without correction prints come out contrasty, with lost highlights and blocked shadows.</li>
            <li>The negative is <b>mirrored</b> so the ink side can touch the paper (sharper prints), then printed on transparency film.</li>
          </ol>
          <h3>About the preview</h3>
          <p>The Cyanotype view simulates the print by running your negative through a model of the process. With the Generic profile it&apos;s an educated guess; after you calibrate (the gauge button at the top), it uses your measured tones and even the actual blues and paper colour of your scan.</p>
          <h3>Reading the strip at the bottom</h3>
          <p>&ldquo;Ideal print&rdquo; is a perfectly even 21-step scale in cyanotype colours. &ldquo;Predicted print&rdquo; is what your current negative curve would give you. The closer they match, and the more distinct tones you get, the better. Try clicking <b>Linear</b> and then <b>Auto-fit</b> to see the difference.</p>
          <h3>Good starting photos</h3>
          <p>Images with clear shapes, good midtone separation and not too many large deep-shadow areas tend to print well. Cyanotype is a fairly short-scale process with a beautiful but limited range of blues.</p>
          <h3>Further reading</h3>
          <p>Christina Z. Anderson&apos;s books (e.g. <i>Cyanotype: The Blueprint in Contemporary Practice</i>), Peter Mrhar&apos;s Easy Digital Negatives site and manual, and Mark Nelson&apos;s Precision Digital Negatives cover calibration in depth.</p>
          <p className="mt-3">Everything runs on your computer — your photos never leave it. Settings, curves and calibrations are saved to your account, so they follow you to any computer.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
