import { describe, expect, it } from 'vitest';
import { ReasonerError } from '../../../src/diplomat/reasoner/errors';
import { createOpenAiCompatibleReasoner } from '../../../src/diplomat/reasoner/openai-compatible';
import { isReasonerError, type ReasonerInput } from '../../../src/diplomat/reasoner/port';
import { fakeFetch, jsonResponse } from '../../support/fake-fetch';
import { loginObservation } from '../../support/observations';

const API_KEY = 'sk-test-0123456789';

const input: ReasonerInput = {
  goal: 'Sign on',
  observation: loginObservation(),
  validRefs: ['e1', 'e2', 'e3', 'e4', 'e5'],
};

const decision = { verb: 'click', target: 'e5', argument: null, rationale: 'submit the form' };
const parsed = { kind: 'act', action: { kind: 'click', ref: 'e5' }, rationale: 'submit the form' };

function answer(content: string | null): Response {
  return jsonResponse({ choices: [{ index: 0, message: { role: 'assistant', content } }] });
}

function reasoner(queue: (Response | Error)[]) {
  const fake = fakeFetch(queue);
  const created = createOpenAiCompatibleReasoner({
    baseUrl: 'https://llm.test/v1',
    model: 'gpt-test',
    apiKey: API_KEY,
    fetch: fake.fetch,
    retryDelayMs: 0,
  });
  return { reasoner: created, calls: fake.calls };
}

describe('createOpenAiCompatibleReasoner', () => {
  it('calls /chat/completions with a bearer key and the strict step schema', async () => {
    const { reasoner: hosted, calls } = reasoner([answer(JSON.stringify(decision))]);

    await expect(hosted.propose(input)).resolves.toEqual(parsed);
    expect(hosted).toMatchObject({ adapter: 'openai-compatible', model: 'gpt-test' });
    expect(calls[0]?.url).toBe('https://llm.test/v1/chat/completions');
    expect(calls[0]?.headers.authorization).toBe(`Bearer ${API_KEY}`);
    expect(calls[0]?.body).toMatchObject({
      model: 'gpt-test',
      temperature: 0,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'agent_decision', strict: true, schema: { additionalProperties: false } },
      },
    });
  });

  it('treats a refusal as invalid output and asks again', async () => {
    const { reasoner: hosted, calls } = reasoner([answer(null), answer(JSON.stringify(decision))]);

    await expect(hosted.propose(input)).resolves.toEqual(parsed);
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(calls[1]?.body)).toContain('Previous answer rejected: the answer was empty');
  });

  it('fails fast on 401 without leaking the key, even when the body echoes it', async () => {
    const { reasoner: hosted, calls } = reasoner([
      jsonResponse({ error: { message: `Incorrect API key provided: ${API_KEY}` } }, 401),
    ]);

    const error: unknown = await hosted.propose(input).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ReasonerError);
    expect(isReasonerError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'transport', attempts: 1 });
    expect(String(error)).toContain('HTTP 401');
    expect(String(error)).not.toContain(API_KEY);
    expect(calls).toHaveLength(1);
  });

  it('does not leak the key from a network error either', async () => {
    const { reasoner: hosted, calls } = reasoner([
      new Error(`connect ECONNREFUSED (key ${API_KEY})`),
      new Error(`connect ECONNREFUSED (key ${API_KEY})`),
      new Error(`connect ECONNREFUSED (key ${API_KEY})`),
    ]);

    const error: unknown = await hosted.propose(input).catch((reason: unknown) => reason);
    expect(error).toMatchObject({ code: 'transport', attempts: 3 });
    expect(String(error)).toContain('network error: connect ECONNREFUSED (key [redacted])');
    expect(calls).toHaveLength(3);
  });

  it('requires https unless the endpoint is on this machine', () => {
    const build = (baseUrl: string) => () => createOpenAiCompatibleReasoner({ baseUrl, model: 'm', apiKey: API_KEY });

    expect(build('http://llm.example.com/v1')).toThrow('HOSTED_BASE_URL must use https: unless it is on this machine');
    expect(build('not a url')).toThrow('HOSTED_BASE_URL is not a valid URL');
    expect(build('http://localhost:11434/v1')).not.toThrow();
    expect(build('https://llm.example.com/v1')).not.toThrow();
  });

  it('refuses to build without configuration and names only the variables', () => {
    expect(() => createOpenAiCompatibleReasoner({ baseUrl: undefined, model: 'm', apiKey: undefined })).toThrow(
      'Hosted reasoner is not configured: set HOSTED_BASE_URL, HOSTED_API_KEY',
    );
    expect(() => createOpenAiCompatibleReasoner({ baseUrl: 'https://x', model: undefined, apiKey: 'secret' })).toThrow(
      /^Hosted reasoner is not configured: set HOSTED_MODEL$/,
    );
  });
});
