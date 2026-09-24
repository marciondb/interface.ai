import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createOllamaReasoner } from '../../src/diplomat/reasoner/ollama';
import { createOpenAiCompatibleReasoner } from '../../src/diplomat/reasoner/openai-compatible';
import type { Reasoner } from '../../src/diplomat/reasoner/port';
import { createFixtureSessionProvider } from '../../src/diplomat/session/fixture-login';
import { createPlaywrightDriver } from '../../src/diplomat/surface/playwright-driver';
import type { SurfaceDriver } from '../../src/diplomat/surface/port';
import { loadConfig } from '../../src/infrastructure/config';
import { observationRefs } from '../../src/logic/grounding';
import type { Observation, ObservationNode } from '../../src/models/observation';
import { startFixture, type FixtureHandle } from '../support/fixture';

const GOAL = 'look up member 10001 and read their savings balance';
const config = loadConfig();
const hosted = process.env.LIVE_REASONER === 'hosted';

const OllamaTagsSchema = z.object({ models: z.array(z.object({ name: z.string() })) });

async function assertModelPulled(): Promise<void> {
  const response = await fetch(`${config.ollamaBaseUrl.replace(/\/+$/, '')}/api/tags`, {
    signal: AbortSignal.timeout(5_000),
  }).catch(() => undefined);
  if (response?.ok !== true) throw new Error('Ollama not reachable — run `ollama serve`');
  const names = OllamaTagsSchema.parse(await response.json()).models.map((model) => model.name);
  if (!names.includes(config.reasonerModel) && !names.includes(`${config.reasonerModel}:latest`)) {
    throw new Error(`Model not pulled — run \`ollama pull ${config.reasonerModel}\``);
  }
}

function contentTextboxes(observation: Observation): ObservationNode[] {
  return observation.nodes.filter((node) => node.frame === 'content' && node.role === 'textbox');
}

describe.skipIf(process.env.RUN_LIVE_MODEL !== '1')('first real decision on Member Lookup', () => {
  let fixture: FixtureHandle | undefined;
  let driver: SurfaceDriver | undefined;
  let reasoner: Reasoner | undefined;

  beforeAll(async () => {
    if (hosted) {
      reasoner = createOpenAiCompatibleReasoner(config.hosted);
    } else {
      await assertModelPulled();
      reasoner = createOllamaReasoner({ baseUrl: config.ollamaBaseUrl, model: config.reasonerModel });
    }
    fixture = await startFixture();
    const targetUrl = `${fixture.baseUrl}/`;
    const session = await createFixtureSessionProvider({
      username: config.targetUsername,
      password: config.targetPassword,
    }).establish(targetUrl);
    driver = createPlaywrightDriver();
    await driver.open(targetUrl, session);
  }, 60_000);

  afterAll(async () => {
    await driver?.close();
    await fixture?.stop();
  });

  it('fills the member id from the goal into the only textbox', async () => {
    if (driver === undefined || reasoner === undefined) throw new Error('setup did not complete');
    const surface = driver;

    // Reach the starting screen without the model.
    const shell = await surface.observe();
    const lookup = shell.nodes.find((node) => node.role === 'link' && node.name === 'Member Lookup');
    if (lookup?.ref === undefined) throw new Error('Member Lookup link not found on the shell');
    await surface.perform({ kind: 'click', ref: lookup.ref });
    await expect.poll(async () => contentTextboxes(await surface.observe()).length).toBeGreaterThan(0);

    const observation = await surface.observe();
    const textboxes = contentTextboxes(observation);
    expect(textboxes).toHaveLength(1);

    const started = performance.now();
    const decision = await reasoner.propose({ goal: GOAL, observation, validRefs: observationRefs(observation) });
    const latencyMs = Math.round(performance.now() - started);
    console.info(
      `[live-decision] ${JSON.stringify({ reasoner: reasoner.adapter, model: reasoner.model, latencyMs, decision })}`,
    );

    expect(decision).toMatchObject({ kind: 'act', action: { kind: 'fill', ref: textboxes[0]?.ref, value: '10001' } });
  }, 180_000);
});
