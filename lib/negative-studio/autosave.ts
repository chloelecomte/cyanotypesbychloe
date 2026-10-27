// Writes the editor settings to the cloud a moment after they stop changing, retrying on failure.
import type { Settings } from './types';

const SAVE_DELAY = 800;      // ms of quiet before settings are written to the cloud
const RETRY_DELAY = 5000;

export type SaveStatus = { kind: 'busy' | 'ok' | 'err'; text: string };

export class Autosaver {
  private latest: Settings;
  private saved: string;
  private saving = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(initial: Settings, private save: (s: Settings) => Promise<void>, private onStatus: (s: SaveStatus) => void) {
    this.latest = initial;
    this.saved = JSON.stringify(initial);
  }

  /** Call with every new settings value; unchanged values are ignored. */
  update(s: Settings) {
    this.latest = s;
    if (this.dirty) this.schedule(SAVE_DELAY);
  }

  get dirty() { return JSON.stringify(this.latest) !== this.saved; }

  async flush() {
    clearTimeout(this.timer);
    if (this.saving || !this.dirty) return;
    const s = this.latest, json = JSON.stringify(s);
    this.saving = true; this.status({ kind: 'busy', text: 'Saving…' });
    try {
      await this.save(s);
      this.saved = json;
      this.status(this.dirty ? { kind: 'busy', text: 'Saving…' } : { kind: 'ok', text: 'Saved' });
    } catch {
      this.status({ kind: 'err', text: 'Not saved — will retry' });
      this.saving = false;
      return this.schedule(RETRY_DELAY);
    }
    this.saving = false;
    if (this.dirty) this.schedule(SAVE_DELAY);
  }

  /** Writes anything pending, then stops. */
  dispose() {
    if (this.dirty) this.flush();
    clearTimeout(this.timer);
    this.disposed = true;
  }

  private schedule(ms: number) {
    if (this.disposed) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), ms);
  }
  private status(s: SaveStatus) { if (!this.disposed) this.onStatus(s); }
}
