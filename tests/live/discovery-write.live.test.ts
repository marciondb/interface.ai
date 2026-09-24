import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { fromCapabilityFile } from '../../src/adapters/capability-file';
import { createOllamaReasoner } from '../../src/diplomat/reasoner/ollama';
import { createOpenAiCompatibleReasoner } from '../../src/diplomat/reasoner/openai-compatible';
import type { Reasoner } from '../../src/diplomat/reasoner/port';
import { loadConfig } from '../../src/infrastructure/config';
import { runDiscovery, SUB_ACCOUNT_REQUEST } from '../support/discovery-harness';
import { runDir } from '../support/evidence';
import { startFixture, type FixtureHandle } from '../support/fixture';
import { runReplay } from '../support/replay-harness';
import { operatorConfirms } from '../support/scripted-operator';

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

// The model is real; the operator at the risky Confirm is scripted, through the same CLI
// broker and browser session a person would use.
describe.skipIf(process.env.RUN_LIVE_MODEL !== '1')('live discovery of the write flow', () => {
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

  it('discovers the flow with a human at Confirm and replays it for another member', async () => {
    if (fixture === undefined || reasoner === undefined) throw new Error('setup did not complete');

    const operator = operatorConfirms();
    const discovery = await runDiscovery(fixture, reasoner, { requestPath: SUB_ACCOUNT_REQUEST, operator, stepTimeoutMs: 5_000, handoffTtlMs: 60_000 });
    const dir = join(discovery.evidenceRoot, discovery.result.runId);
    const log = await readFile(join(dir, 'run.jsonl'), 'utf8');
    for (const line of log.trim().split('\n')) {
      const event = JSON.parse(line) as { type: string };
      if (['decision', 'feedback', 'grounding_rejected', 'handoff_requested', 'handoff_resumed', 'result'].includes(event.type)) {
        console.info(`[live-write] ${line}`);
      }
    }
    console.info(`[live-write] discovery evidence ${dir}`);
    console.info(`[live-write] artifact dir ${discovery.capabilitiesDir}`);
    expect(operator.errors).toEqual([]);
    expect(discovery.result).toMatchObject({ status: 'succeeded', outputs: { accountNumber: '10001MMRAIN025000' } });
    const { version } = discovery.result.capability;
    const loaded = fromCapabilityFile(JSON.parse(await readFile(join(discovery.capabilitiesDir, 'member.open-sub-account', `${version}.json`), 'utf8')));
    if (!loaded.ok) throw new Error(loaded.issues.join('; '));
    expect(loaded.capability.steps.filter((step) => step.risk === 'risky')).toHaveLength(1);

    const replayOperator = operatorConfirms();
    const replay = await runReplay(
      fixture,
      { memberId: '10002', accountType: 'Holiday Club', nickname: 'Vacation', initialDeposit: '100.00' },
      { capability: 'member.open-sub-account', capabilitiesDir: discovery.capabilitiesDir, allowDraft: true, operator: replayOperator, stepTimeoutMs: 5_000 },
    );
    console.info(`[live-write] replay evidence ${runDir(replay)}`);

    expect(replayOperator.errors).toEqual([]);
    expect(replay.result).toMatchObject({ status: 'succeeded', outputs: { accountNumber: '10002HCVACA010000' } });
    expect(replay.result.interventions).toHaveLength(1);
  }, 900_000);
});
