import { isAbsolute, relative } from 'node:path';
import { parseArgs, type ParseArgsOptionsConfig } from 'node:util';
import { loadConfig, type Config } from '../../infrastructure/config';
import { errorMessage } from '../../infrastructure/errors';
import type { DiscoveryResult } from '../../models/discovery';
import type { ExecutionResult } from '../../models/execution-result';

// Process exit codes of both CLIs.
export const EXIT = {
  succeeded: 0,
  usage: 1,
  businessOutcome: 2,
  failed: 3,
  escalated: 4,
  // A crash: a bug or an environment problem, not a result of the run.
  internal: 5,
} as const;

export function replayExitCode(result: ExecutionResult): number {
  switch (result.status) {
    case 'succeeded':
      return EXIT.succeeded;
    case 'business_outcome':
      return EXIT.businessOutcome;
    case 'failed':
      return EXIT.failed;
    case 'escalated':
      return EXIT.escalated;
    default: {
      const unhandled: never = result;
      return unhandled;
    }
  }
}

export function discoveryExitCode(result: DiscoveryResult): number {
  switch (result.status) {
    case 'succeeded':
      return EXIT.succeeded;
    case 'failed':
      return EXIT.failed;
    case 'escalated':
      return EXIT.escalated;
    default: {
      const unhandled: never = result;
      return unhandled;
    }
  }
}

export type Cli = {
  // Prints the lines and the usage to stderr; returns the usage exit code.
  usageError(...lines: string[]): number;
  // node:util parseArgs `values`, still untrusted (a wire shape), or the parse error.
  flags(argv: readonly string[], options: ParseArgsOptionsConfig): { ok: true; values: unknown } | { ok: false; issue: string };
  config(): { ok: true; config: Config } | { ok: false; issue: string };
  // Relative to the cwd when inside it, for the lines printed to the operator.
  shown(path: string): string;
  // Runs main with the process arguments and sets the exit code; a rejection is an internal error.
  run(main: (argv: string[]) => Promise<number>): void;
};

export function createCli(name: string, usage: string): Cli {
  return {
    usageError(...lines) {
      for (const line of [...lines, usage]) process.stderr.write(`${line}\n`);
      return EXIT.usage;
    },
    flags(argv, options) {
      try {
        return { ok: true, values: parseArgs({ args: [...argv], options, strict: true, allowPositionals: false }).values };
      } catch (error) {
        return { ok: false, issue: errorMessage(error) };
      }
    },
    config() {
      try {
        return { ok: true, config: loadConfig() };
      } catch (error) {
        return { ok: false, issue: `config: ${errorMessage(error)}` };
      }
    },
    shown(path) {
      const shown = relative(process.cwd(), path);
      return shown === '' || shown.startsWith('..') || isAbsolute(shown) ? path : shown;
    },
    run(main) {
      main(process.argv.slice(2)).then(
        (code) => {
          process.exitCode = code;
        },
        (error: unknown) => {
          const detail = error instanceof Error && error.stack !== undefined ? error.stack : errorMessage(error);
          process.stderr.write(`${name}: internal error: ${detail}\n`);
          process.exitCode = EXIT.internal;
        },
      );
    },
  };
}
