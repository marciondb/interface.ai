import type { Writable } from 'node:stream';
import type { ReasonerChoice } from '../../adapters/discover-args';
import type { Config } from '../../infrastructure/config';
import { printable } from '../../logic/terminal-text';
import type { EvidenceRecorder } from '../evidence/port';

// Masked in the evidence and in what the model sees: the target password and, when the hosted
// reasoner is used, its API key.
export function discoverySecrets(choice: ReasonerChoice, config: Config): string[] {
  const apiKey = choice === 'hosted' ? config.hosted.apiKey : undefined;
  return apiKey === undefined ? [config.targetPassword] : [config.targetPassword, apiKey];
}

// Echoes each decision to the operator's terminal while the run is in progress, redacted like the
// evidence and stripped of terminal control sequences, since the rationale is the model's own text.
export function narrated(recorder: EvidenceRecorder, output: Writable): EvidenceRecorder {
  return {
    ...recorder,
    event(event) {
      if (event.type === 'decision') {
        const { stepId, verb, target, argument, rationale, latencyMs } = recorder.redact(event);
        const shownTarget = target === null ? '' : ` ${target}`;
        const shownArgument = argument === null ? '' : ` ${JSON.stringify(argument)}`;
        output.write(`${printable(`${stepId} ${verb}${shownTarget}${shownArgument} (${String(latencyMs)} ms) model: ${rationale}`)}\n`);
      }
      return recorder.event(event);
    },
  };
}
