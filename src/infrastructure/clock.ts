export type Clock = {
  // Milliseconds since the epoch.
  now(): number;
  sleep(ms: number): Promise<void>;
};

// How often a controller re-checks the page while it waits for it to change.
export const DEFAULT_POLL_INTERVAL_MS = 250;

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};
