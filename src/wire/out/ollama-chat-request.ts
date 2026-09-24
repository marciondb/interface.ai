export type OllamaChatMessage = {
  readonly role: 'system' | 'user';
  readonly content: string;
};

export type OllamaChatRequest = {
  readonly model: string;
  readonly messages: readonly OllamaChatMessage[];
  // JSON Schema the server enforces during generation.
  readonly format: Record<string, unknown>;
  readonly stream: false;
  readonly think: false;
  readonly options: { readonly temperature: number };
};
