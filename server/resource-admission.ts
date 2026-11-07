import { statfsSync } from "node:fs";
import { HttpError } from "./store";

export interface ResourceOptions {
  dataDir: string;
  concurrency?: number;
  queueLimit?: number;
  minFreeDiskBytes?: number;
  freeBytes?: () => number;
}
export interface ResourceTicket {
  wait(): Promise<void>;
  cancel(): void;
  release(): void;
}
interface Entry {
  state: "reserved" | "waiting" | "running" | "released";
  resolve?: () => void;
  reject?: (error: Error) => void;
}
/** Reservations bound accepted work across all queues, not only running children. */
export class ResourceAdmission {
  private entries = new Set<Entry>();
  private waiting: Entry[] = [];
  private active = 0;
  private stopped = false;
  readonly concurrency: number;
  readonly queueLimit: number;
  readonly minFreeDiskBytes: number;
  constructor(private options: ResourceOptions) {
    this.concurrency = options.concurrency ?? 1;
    this.queueLimit = options.queueLimit ?? 8;
    this.minFreeDiskBytes = options.minFreeDiskBytes ?? 0;
    if (!Number.isSafeInteger(this.concurrency) || this.concurrency < 1 || this.concurrency > 16 ||
        !Number.isSafeInteger(this.queueLimit) || this.queueLimit < 0 || this.queueLimit > 100 ||
        !Number.isSafeInteger(this.minFreeDiskBytes) || this.minFreeDiskBytes < 0)
      throw new Error("Invalid worker resource configuration.");
  }
  checkDisk() {
    if (!this.minFreeDiskBytes) return;
    let free: number;
    try {
      if (this.options.freeBytes) free = this.options.freeBytes();
      else { const fs = statfsSync(this.options.dataDir); free = fs.bavail * fs.bsize; }
    } catch { throw new HttpError(503, "Storage availability could not be checked. Try again shortly.", "STORAGE_UNAVAILABLE"); }
    if (!Number.isFinite(free) || free < this.minFreeDiskBytes)
      throw new HttpError(503, "Storage is nearly full. New jobs are paused; existing downloads remain available.", "STORAGE_LOW");
  }
  reserve(): ResourceTicket {
    if (this.stopped) throw new HttpError(503, "Workers are restarting. Try again shortly.", "WORKERS_STOPPING");
    this.checkDisk();
    if (this.entries.size >= this.concurrency + this.queueLimit)
      throw new HttpError(429, "Several jobs are waiting. Try again when a job finishes.", "WORKERS_BUSY");
    const entry: Entry = { state: "reserved" }; this.entries.add(entry);
    return {
      wait: () => {
        if (entry.state !== "reserved") return Promise.reject(new HttpError(503, "The queued job was interrupted.", "JOB_INTERRUPTED"));
        return new Promise<void>((resolve, reject) => {
          entry.resolve = resolve; entry.reject = reject; entry.state = "waiting";
          this.waiting.push(entry); this.drain();
        });
      },
      // A running worker retains its slot until its owner observes process exit.
      cancel: () => { if (entry.state !== "running") this.finish(entry, new HttpError(503, "The queued job was interrupted.", "JOB_INTERRUPTED")); },
      release: () => this.finish(entry),
    };
  }
  private finish(entry: Entry, error?: Error) {
    if (entry.state === "released") return;
    if (entry.state === "running") this.active--;
    if (entry.state === "waiting") entry.reject?.(error || new HttpError(503, "The queued job was interrupted.", "JOB_INTERRUPTED"));
    entry.state = "released"; this.entries.delete(entry);
    this.waiting = this.waiting.filter(item => item !== entry); this.drain();
  }
  private drain() {
    while (!this.stopped && this.active < this.concurrency && this.waiting.length) {
      const entry = this.waiting.shift()!;
      try { this.checkDisk(); }
      catch (error) {
        entry.state = "released"; this.entries.delete(entry); entry.reject?.(error as Error); continue;
      }
      entry.state = "running"; this.active++; entry.resolve?.();
    }
  }
  close() {
    this.stopped = true;
    for (const entry of [...this.entries]) if (entry.state !== "running")
      this.finish(entry, new HttpError(503, "The queued job was interrupted by restart.", "JOB_INTERRUPTED"));
  }
  stats() { return { active: this.active, admitted: this.entries.size, waiting: this.entries.size - this.active }; }
}
