import { describe, expect, it } from 'vitest';
import { createOllamaReasoner } from '../../src/diplomat/reasoner/ollama';
import { createOpenAiCompatibleReasoner } from '../../src/diplomat/reasoner/openai-compatible';
import type { Reasoner, ReasonerInput } from '../../src/diplomat/reasoner/port';
import { loadConfig } from '../../src/infrastructure/config';
import { ActionSchema } from '../../src/models/action';
import { ObservationSchema } from '../../src/models/observation';

const config = loadConfig();

const input: ReasonerInput = {
  goal: 'Search for the word apple',
  observation: ObservationSchema.parse({
    observationId: 1,
    url: 'http://localhost/search',
    frames: [{ name: null, url: 'http://localhost/search' }],
    nodes: [
      { role: 'text', name: 'Search', frame: null },
      { ref: 'e1', role: 'textbox', name: '', label: 'Search term', value: '', frame: null },
      { ref: 'e2', role: 'button', name: 'Go', frame: null },
    ],
    dialog: null,
  }),
  validRefs: ['e1', 'e2'],
};

async function proposeOnce(reasoner: Reasoner) {
  const started = performance.now();
  const decision = ActionSchema.parse(await reasoner.propose(input));
  console.info(`${reasoner.adapter} ${reasoner.model}: ${String(Math.round(performance.now() - started))} ms ->`, decision);
  expect(input.validRefs).toContain(decision.target);
}

describe('live reasoner', () => {
  it('Ollama returns a valid decision grounded on the screen', async () => {
    await proposeOnce(createOllamaReasoner({ baseUrl: config.ollamaBaseUrl, model: config.reasonerModel }));
  }, 180_000);

  it.skipIf(config.hosted.apiKey === undefined)('hosted model returns a valid decision grounded on the screen', async () => {
    await proposeOnce(createOpenAiCompatibleReasoner(config.hosted));
  }, 180_000);
});
