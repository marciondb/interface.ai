import type { Page } from 'playwright';
import { toObservation } from '../../adapters/aria-snapshot';
import type { Observation } from '../../models/observation';
import { AriaSnapshotWireSchema } from '../../wire/in/aria-snapshot';
import { SurfaceError } from './errors';

const LOAD_TIMEOUT_MS = 5_000;
const SNAPSHOT_TIMEOUT_MS = 5_000;

export type Snapshot = {
  // With no dialog: the driver adds the one it dismissed.
  readonly observation: Observation;
  // Observation ref -> Playwright aria-ref.
  readonly refTargets: ReadonlyMap<string, string>;
};

// The page and its child frames as one observation, once their documents are loaded.
export async function snapshotPage(page: Page, observationId: number): Promise<Snapshot> {
  await page.waitForLoadState('domcontentloaded', { timeout: LOAD_TIMEOUT_MS });
  for (const frame of page.mainFrame().childFrames()) {
    await frame.waitForLoadState('domcontentloaded', { timeout: LOAD_TIMEOUT_MS });
  }
  const snapshot: unknown = await page.ariaSnapshotJSON({ mode: 'ai', timeout: SNAPSHOT_TIMEOUT_MS });
  const frames = page.mainFrame().childFrames().map((frame) => ({ name: frame.name(), url: frame.url() }));
  const wire = AriaSnapshotWireSchema.safeParse({
    url: page.url(),
    frames,
    nodes: Array.isArray(snapshot) ? snapshot : [snapshot],
  });
  if (!wire.success) throw new SurfaceError('snapshot_mismatch', 'the aria snapshot has an unexpected shape');

  const result = toObservation(wire.data, observationId);
  if (!result.ok) throw new SurfaceError('snapshot_mismatch', result.reason);
  return { observation: result.observation, refTargets: result.refTargets };
}
