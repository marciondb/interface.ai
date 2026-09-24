import { PassThrough } from 'node:stream';
import type { Page } from 'playwright';
import { COMMAND_PROMPT, createCliBroker, DIALOG_PROMPT } from '../../src/diplomat/escalation/cli-broker';
import type { EscalationBroker, OperatorCommand } from '../../src/diplomat/escalation/port';
import type { ActionGateway } from '../../src/diplomat/gateway/port';
import type { DialogDecision } from '../../src/models/intervention';

// What the operator can reach: the same browser page the run uses, and the run's gateway
// (to show that automation is refused while they hold control).
export type ActorContext = {
  readonly page: Page;
  readonly gateway: ActionGateway;
};

export type ActorStep = { readonly command: OperatorCommand } | { readonly act: (context: ActorContext) => Promise<void> };

export type HumanActor = {
  // The real CLI broker, fed through its input stream like a terminal would be.
  readonly broker: EscalationBroker;
  attach(context: ActorContext): void;
  // Everything the broker printed to the operator.
  printed(): string;
  // Failures of the actor's own steps, surfaced by the test.
  readonly errors: unknown[];
};

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

// A scripted operator. At each command prompt it performs its next page actions, then types
// its next command; with nothing left it walks away (the handoff times out). Dialog prompts
// get the next of `dialogs`.
export function createHumanActor(script: readonly ActorStep[], dialogs: readonly DialogDecision[] = []): HumanActor {
  const input = new PassThrough();
  const output = new PassThrough();
  const steps = [...script];
  const answers = [...dialogs];
  const errors: unknown[] = [];
  let context: ActorContext | undefined;
  let printed = '';
  let commandPrompts = 0;
  let dialogPrompts = 0;
  let queue = Promise.resolve();

  async function untilNextCommand(): Promise<void> {
    for (let step = steps.shift(); step !== undefined; step = steps.shift()) {
      if ('command' in step) {
        input.write(`${step.command}\n`);
        return;
      }
      if (context === undefined) throw new Error('human actor: attach() was not called');
      await step.act(context);
    }
  }

  output.on('data', (chunk: Buffer) => {
    printed += chunk.toString('utf8');
    for (; commandPrompts < occurrences(printed, COMMAND_PROMPT); commandPrompts += 1) {
      queue = queue.then(untilNextCommand).catch((error: unknown) => {
        errors.push(error);
      });
    }
    for (; dialogPrompts < occurrences(printed, DIALOG_PROMPT); dialogPrompts += 1) {
      const answer = answers.shift();
      if (answer !== undefined) input.write(`${answer}\n`);
    }
  });

  return {
    broker: createCliBroker({ input, output }),
    attach(attached) {
      context = attached;
    },
    printed: () => printed,
    errors,
  };
}
