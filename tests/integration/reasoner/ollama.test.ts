import { describe, expect, it } from 'vitest';
import { ReasonerError } from '../../../src/diplomat/reasoner/errors';
import { createOllamaReasoner } from '../../../src/diplomat/reasoner/ollama';
import type { ReasonerInput } from '../../../src/diplomat/reasoner/port';
import { fakeFetch, jsonResponse } from '../../support/fake-fetch';
import { loginObservation } from '../../support/observations';

const input: ReasonerInput = {
  goal: 'Sign on',
  observation: loginObservation(),
  validRefs: ['e1', 'e2', 'e3', 'e4', 'e5'],
};

const decision = { verb: 'fill', target: 'e2', argument: 'operator', rationale: 'user id field' };

function answer(content: unknown): Response {
  return jsonResponse({ model: 'qwen3:8b', message: { role: 'assistant', content: JSON.stringify(content) }, done: true });
}

function reasoner(queue: (Response | Error)[]) {
  const fake = fakeFetch(queue);
  const created = createOllamaReasoner({ baseUrl: 'http://ollama.test/', model: 'qwen3:8b', fetch: fake.fetch, retryDelayMs: 0 });
  return { reasoner: created, calls: fake.calls };
}

function userMessage(body: unknown): string {
  return (body as { messages: { role: string; content: string }[] }).messages.find((m) => m.role === 'user')?.content ?? '';
}

async function rejection(promise: Promise<unknown>): Promise<ReasonerError> {
  const error: unknown = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ReasonerError);
  return error as ReasonerError;
}

describe('createOllamaReasoner', () => {
  it('calls /api/chat with a constrained, deterministic, non-streaming request', async () => {
    const { reasoner: ollama, calls } = reasoner([answer(decision)]);

    await expect(ollama.propose(input)).resolves.toEqual(decision);
    expect(ollama).toMatchObject({ adapter: 'ollama', model: 'qwen3:8b' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://ollama.test/api/chat');
    expect(calls[0]?.body).toMatchObject({
      model: 'qwen3:8b',
      stream: false,
      think: false,
      options: { temperature: 0 },
      format: { properties: { target: { anyOf: [{ enum: input.validRefs }, { type: 'null' }] } } },
      messages: [{ role: 'system' }, { role: 'user', content: expect.stringContaining('Goal: Sign on') as unknown }],
    });
  });

  it('repairs an invalid answer by calling again with the rejection reason', async () => {
    const { reasoner: ollama, calls } = reasoner([answer({ verb: 'dance' }), answer(decision)]);

    await expect(ollama.propose(input)).resolves.toEqual(decision);
    expect(calls).toHaveLength(2);
    expect(userMessage(calls[0]?.body)).not.toContain('Previous answer rejected');
    expect(userMessage(calls[1]?.body)).toMatch(/\nPrevious answer rejected: .*verb/);
  });

  it('gives up with invalid_output after three answers aimed at a ref not on the screen', async () => {
    const bad = { verb: 'click', target: 'e99', argument: null, rationale: 'x' };
    const { reasoner: ollama, calls } = reasoner([answer(bad), answer(bad), answer(bad)]);

    const error = await rejection(ollama.propose(input));
    expect(error).toMatchObject({ code: 'invalid_output', attempts: 3, adapter: 'ollama' });
    expect(error.message).toContain('target e99 is not on the screen');
    expect(calls).toHaveLength(3);
  });

  it('gives up with transport after three network failures', async () => {
    const down = () => new TypeError('fetch failed');
    const { reasoner: ollama, calls } = reasoner([down(), down(), down()]);

    await expect(rejection(ollama.propose(input))).resolves.toMatchObject({ code: 'transport', attempts: 3 });
    expect(calls).toHaveLength(3);
  });

  it('retries a 503 and then succeeds', async () => {
    const { reasoner: ollama, calls } = reasoner([jsonResponse({ error: 'busy' }, 503), answer(decision)]);

    await expect(ollama.propose(input)).resolves.toEqual(decision);
    expect(calls).toHaveLength(2);
  });

  it('fails on the first call when the model is missing', async () => {
    const { reasoner: ollama, calls } = reasoner([jsonResponse({ error: "model 'qwen3:8b' not found" }, 404)]);

    const error = await rejection(ollama.propose(input));
    expect(error).toMatchObject({ code: 'transport', attempts: 1 });
    expect(error.message).toContain("HTTP 404 model 'qwen3:8b' not found");
    expect(error.message).not.toContain('Sign On');
    expect(calls).toHaveLength(1);
  });

  it('retries an unexpected envelope', async () => {
    const { reasoner: ollama, calls } = reasoner([jsonResponse({ done: true }), answer(decision)]);

    await expect(ollama.propose(input)).resolves.toEqual(decision);
    expect(calls).toHaveLength(2);
  });
});
