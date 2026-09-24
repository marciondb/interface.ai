import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createOllamaReasoner } from '../../src/diplomat/reasoner/ollama';
import { createOpenAiCompatibleReasoner } from '../../src/diplomat/reasoner/openai-compatible';
import type { Reasoner } from '../../src/diplomat/reasoner/port';
import { loadConfig } from '../../src/infrastructure/config';
import { runDiscovery } from '../support/discovery-harness';
import { startFixture, type FixtureHandle } from '../support/fixture';
import { runReplay } from '../support/replay-harness';

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

describe.skipIf(process.env.RUN_LIVE_MODEL !== '1')('live discovery of the read flow', () => {
  let fixture: FixtureHandle | undefined;
  let reasoner: Reasoner | undefined;

  beforeAll(async () => {
    if (hosted) {
      reasoner = createOpenAiCompatibleReasoner(config.hosted);
    } else {
      await assertModelPulled();
      reasoner = createOllamaReasoner({ baseUrl: config.ollamaBaseUrl, model: config.reasonerModel });
    }
    fixture = await startFixture();
  }, 60_000);

  afterAll(async () => {
    await fixture?.stop();
  });

  it('discovers an artifact that replays for another member without the model', async () => {
    if (fixture === undefined || reasoner === undefined) throw new Error('setup did not complete');

    const discovery = await runDiscovery(fixture, reasoner, { stepTimeoutMs: 5_000 });
    const log = await readFile(join(discovery.evidenceRoot, discovery.result.runId, 'run.jsonl'), 'utf8');
    for (const line of log.trim().split('\n')) {
      const event = JSON.parse(line) as { type: string };
      if (['decision', 'feedback', 'grounding_rejected', 'result'].includes(event.type)) console.info(`[live-discovery] ${line}`);
    }
    expect(discovery.result).toMatchObject({ status: 'succeeded', outputs: { balance: '4,812.37' } });

    const replay = await runReplay(fixture, { memberId: '10002', accountType: 'Savings' }, { capabilitiesDir: discovery.capabilitiesDir });

    expect(replay.result).toMatchObject({ status: 'succeeded', outputs: { balance: '3,100.55' }, capability: { version: '1.0.1' } });
  }, 720_000);
});
