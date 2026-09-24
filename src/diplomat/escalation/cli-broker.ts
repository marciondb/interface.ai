import { join } from 'node:path';
import { createInterface, type Interface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import type { DialogDecision } from '../../models/intervention';
import type { EscalationBroker, OperatorCommand, WaitOptions } from './port';

export type CliBrokerOptions = {
  // The operator's terminal: commands come from input, everything else goes to output.
  readonly input: Readable;
  readonly output: Writable;
  // Evidence root, so the screenshot path printed is complete.
  readonly evidenceRoot?: string;
  readonly now?: () => number;
};

export const COMMAND_PROMPT = 'handoff> ';
export const DIALOG_PROMPT = 'dialog> ';

const COMMAND_HELP: Record<OperatorCommand, string> = {
  take: 'take    take control of the browser window',
  resume: "resume  hand control back; the step's checkpoint is verified first",
  abort: 'abort   end the run as escalated',
};

type Waiter = { onLine(line: string): void };

// Operator prompt on the terminal of the running process (ADR-003): no separate command, no IPC.
// Input is read only while a handoff waits and released by close().
export function createCliBroker(options: CliBrokerOptions): EscalationBroker {
  const { input, output } = options;
  const now = options.now ?? (() => Date.now());
  const pending: string[] = [];
  // The newest wait gets each line: a dialog question interrupts a command wait.
  const waiters: Waiter[] = [];
  let reader: Interface | undefined;

  function write(text: string): void {
    output.write(text);
  }

  function listen(): void {
    if (reader !== undefined) return;
    reader = createInterface({ input, terminal: false });
    reader.on('line', (raw) => {
      const line = raw.trim().toLowerCase();
      const waiter = waiters.at(-1);
      if (waiter === undefined) pending.push(line);
      else waiter.onLine(line);
    });
  }

  function wait<T extends string>(prompt: string, help: string, parse: (line: string) => T | undefined, { expiresAt, signal }: WaitOptions) {
    listen();
    return new Promise<T | 'timeout'>((resolve) => {
      const waiter: Waiter = {
        onLine(line) {
          const value = parse(line);
          if (value !== undefined) {
            done(value);
            return;
          }
          if (line !== '') write(help);
          write(prompt);
        },
      };
      const timer = setTimeout(() => {
        done('timeout');
      }, Math.max(0, expiresAt - now()));
      const onAbort = () => {
        done('timeout');
      };
      function done(value: T | 'timeout'): void {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        const index = waiters.indexOf(waiter);
        if (index === -1) return;
        waiters.splice(index, 1);
        resolve(value);
      }
      waiters.push(waiter);
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) {
        done('timeout');
        return;
      }
      write(prompt);
      while (pending.length > 0 && waiters.includes(waiter)) waiter.onLine(pending.shift() ?? '');
    });
  }

  return {
    publish(request) {
      const screenshot =
        request.screenshot === null ? '(none)' : options.evidenceRoot === undefined ? request.screenshot : join(options.evidenceRoot, request.runId, request.screenshot);
      const lines = [
        '',
        `=== Human intervention requested: ${request.interventionId} ===`,
        `reason:     ${request.reason}`,
        ...(request.capability === undefined ? [] : [`capability: ${request.capability}`]),
        ...(request.goal === undefined ? [] : [`goal:       ${request.goal}`]),
        `step:       ${request.stepId}`,
        `message:    ${request.message}`,
        `url:        ${request.url}`,
        `screenshot: ${screenshot}`,
        `expires at: ${request.expiresAt}`,
        '',
      ];
      write(lines.join('\n'));
    },

    nextCommand(allowed: readonly OperatorCommand[], waitOptions: WaitOptions) {
      const help = `Commands:\n${allowed.map((command) => `  ${COMMAND_HELP[command]}`).join('\n')}\n`;
      write(help);
      return wait(COMMAND_PROMPT, help, (line) => allowed.find((command) => command === line), waitOptions);
    },

    askDialog(dialog, waitOptions) {
      write(`\nThe page opened a ${dialog.type} dialog: ${JSON.stringify(dialog.message)}\nType accept or dismiss.\n`);
      const decisions: readonly DialogDecision[] = ['accept', 'dismiss'];
      return wait(DIALOG_PROMPT, 'Type accept or dismiss.\n', (line) => decisions.find((decision) => decision === line), waitOptions);
    },

    notify(text) {
      write(`${text}\n`);
    },

    close() {
      reader?.close();
      reader = undefined;
    },
  };
}
