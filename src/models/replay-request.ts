export type ReplayRequest = {
  readonly capabilityId: string;
  // Callers pin a major version; replay runs the highest published minor/patch (ADR-007).
  readonly major: number;
  readonly inputs: Readonly<Record<string, string>>;
  // Entry URL of the target application.
  readonly targetUrl: string;
};
