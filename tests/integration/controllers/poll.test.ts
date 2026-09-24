import { describe, expect, it } from 'vitest';
import { pollUntil } from '../../../src/controllers/poll';
import { createFakeClock } from '../../support/fakes';

describe('pollUntil', () => {
  it('probes until done', async () => {
    const clock = createFakeClock();
    let probes = 0;
    const value = await pollUntil(clock, 1_000, 100, () => {
      probes += 1;
      return Promise.resolve({ done: probes === 3, value: probes });
    });

    expect(value).toBe(3);
    expect(clock.sleeps).toHaveLength(2);
  });

  it('returns the last value at the deadline', async () => {
    const clock = createFakeClock();
    const value = await pollUntil(clock, 250, 100, () => Promise.resolve({ done: false, value: clock.now() }));

    expect(value).toBe(300);
  });

  it('stops after the probe during which the signal aborted', async () => {
    const clock = createFakeClock();
    const waits = new AbortController();
    let probes = 0;
    const value = await pollUntil(
      clock,
      10_000,
      100,
      () => {
        probes += 1;
        if (probes === 2) waits.abort();
        return Promise.resolve({ done: false, value: probes });
      },
      waits.signal,
    );

    expect(value).toBe(2);
  });
});
