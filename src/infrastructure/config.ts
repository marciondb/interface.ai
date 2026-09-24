export type Config = {
  readonly targetUsername: string;
  readonly targetPassword: string;
  readonly ollamaBaseUrl: string;
  readonly reasonerModel: string;
  readonly hosted: {
    readonly baseUrl: string | undefined;
    readonly model: string | undefined;
    readonly apiKey: string | undefined;
  };
};

function read(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key];
  return value === undefined || value === '' ? undefined : value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    targetUsername: read(env, 'TARGET_USERNAME') ?? 'operator',
    targetPassword: read(env, 'TARGET_PASSWORD') ?? 'training',
    ollamaBaseUrl: read(env, 'OLLAMA_BASE_URL') ?? 'http://localhost:11434',
    reasonerModel: read(env, 'REASONER_MODEL') ?? 'qwen3:8b',
    hosted: {
      baseUrl: read(env, 'HOSTED_BASE_URL'),
      model: read(env, 'HOSTED_MODEL'),
      apiKey: read(env, 'HOSTED_API_KEY'),
    },
  };
}
