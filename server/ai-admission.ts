import { HttpError } from "./store";

interface ActiveRequest { controller: AbortController; done: Promise<void> }
/** One runtime limit shared by direct requests and agent roles. No waiting queue. */
export class AiProviderAdmission {
  private active = new Set<ActiveRequest>();
  private stopping = false;
  constructor(readonly concurrency = 2) {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 16)
      throw new Error("AI_PROVIDER_CONCURRENCY must be an integer from 1 to 16.");
  }
  acquire(signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (this.stopping)
      throw new HttpError(503, "The design assistant is restarting. Try again shortly.", "AI_STOPPING");
    if (this.active.size >= this.concurrency)
      throw new HttpError(429, "The design assistant is busy. Try again when a request finishes.", "AI_BUSY");
    const controller = new AbortController();
    let finish!: () => void;
    const entry = { controller, done: new Promise<void>((resolve) => { finish = resolve; }) };
    this.active.add(entry);
    const timeout = setTimeout(() => controller.abort(new DOMException("The design assistant timed out.", "TimeoutError")), 60_000);
    timeout.unref();
    return {
      signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
      release: () => {
        clearTimeout(timeout);
        if (this.active.delete(entry)) finish();
      },
    };
  }
  stop() {
    this.stopping = true;
    // Aborting does not free capacity; the provider and accounting must settle first.
    for (const entry of this.active) entry.controller.abort();
  }
  async close() {
    this.stop();
    await Promise.all([...this.active].map((entry) => entry.done));
  }
  stats() { return { active: this.active.size, concurrency: this.concurrency, stopping: this.stopping }; }
}
