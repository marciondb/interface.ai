import type { Clock } from '../infrastructure/clock';

// One look at the page: `done` ends the wait early.
export type Probe<T> = { readonly done: boolean; readonly value: T };

// Probes until one is done, the deadline passes or signal aborts, sleeping intervalMs between
// probes, and returns the last probe's value. The first probe always runs.
export async function pollUntil<T>(clock: Clock, deadline: number, intervalMs: number, probe: () => Promise<Probe<T>>, signal?: AbortSignal): Promise<T> {
  for (;;) {
    const { done, value } = await probe();
    if (done || clock.now() >= deadline || signal?.aborted === true) return value;
    await clock.sleep(intervalMs);
  }
}
