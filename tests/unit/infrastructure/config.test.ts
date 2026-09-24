import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../../src/infrastructure/config';

describe('loadConfig', () => {
  it('uses fixture and local model defaults when the environment is empty', () => {
    expect(loadConfig({})).toEqual({
      targetUsername: 'operator',
      targetPassword: 'training',
      ollamaBaseUrl: 'http://localhost:11434',
      reasonerModel: 'qwen3:14b',
      hosted: { baseUrl: undefined, model: undefined, apiKey: undefined },
    });
  });

  it('reads every value from the environment', () => {
    expect(
      loadConfig({
        TARGET_USERNAME: 'alice',
        TARGET_PASSWORD: 'secret',
        OLLAMA_BASE_URL: 'http://ollama:11434',
        REASONER_MODEL: 'llama3:8b',
        HOSTED_BASE_URL: 'https://api.example.com/v1',
        HOSTED_MODEL: 'gpt-x',
        HOSTED_API_KEY: 'key',
      }),
    ).toEqual({
      targetUsername: 'alice',
      targetPassword: 'secret',
      ollamaBaseUrl: 'http://ollama:11434',
      reasonerModel: 'llama3:8b',
      hosted: { baseUrl: 'https://api.example.com/v1', model: 'gpt-x', apiKey: 'key' },
    });
  });

  it('treats empty strings as absent', () => {
    const config = loadConfig({
      TARGET_USERNAME: '',
      REASONER_MODEL: '',
      HOSTED_BASE_URL: '',
      HOSTED_API_KEY: '',
    });
    expect(config.targetUsername).toBe('operator');
    expect(config.reasonerModel).toBe('qwen3:14b');
    expect(config.hosted.baseUrl).toBeUndefined();
    expect(config.hosted.apiKey).toBeUndefined();
  });
});
