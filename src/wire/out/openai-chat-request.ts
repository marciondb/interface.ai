export type OpenAiChatMessage = {
  readonly role: 'system' | 'user';
  readonly content: string;
};

export type OpenAiChatRequest = {
  readonly model: string;
  readonly temperature: number;
  readonly messages: readonly OpenAiChatMessage[];
  readonly response_format: {
    readonly type: 'json_schema';
    readonly json_schema: {
      readonly name: string;
      readonly strict: boolean;
      readonly schema: Record<string, unknown>;
    };
  };
};
