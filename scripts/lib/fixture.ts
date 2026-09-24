import { spawn, type ChildProcess, type ChildProcessByStdio } from 'node:child_process';
import { once } from 'node:events';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type { ActionGateway } from '../../src/diplomat/gateway/port';
import type { Policy } from '../../src/models/policy';
import { SUPERVISOR_CODE } from './fixture-data';

type FixtureProcess = ChildProcessByStdio<null, Readable, Readable>;

// fixture/lib/faults.js
export type FaultKind = 'slow_load' | 'interstitial' | 'session_expired' | 'server_error' | 'element_missing' | 'unexpected_dialog';

export interface FixtureHandle {
  baseUrl: string;
  armFault(kind: FaultKind): Promise<void>;
  stop(): Promise<void>;
}

const SERVER_PATH = fileURLToPath(new URL('../../fixture/server.js', import.meta.url));
const LISTENING = /listening on http:\/\/localhost:([0-9]+)/;
const START_TIMEOUT_MS = 10_000;
const STOP_GRACE_MS = 2_000;

const running = new Set<ChildProcess>();
let exitHookInstalled = false;

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once('exit', () => {
    for (const child of running) child.kill('SIGKILL');
  });
}

// Resolves to the port the server printed once it listens.
function waitForListening(child: FixtureProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      finish(new Error(`fixture did not start within ${String(START_TIMEOUT_MS)} ms: ${stderr}`));
    }, START_TIMEOUT_MS);
    const onStdout = (chunk: Buffer): void => {
      stdout += chunk.toString('utf8');
      const port = LISTENING.exec(stdout)?.[1];
      if (port !== undefined) finish(undefined, Number(port));
    };
    const onStderr = (chunk: Buffer): void => {
      stderr += chunk.toString('utf8');
    };
    const onExit = (code: number | null): void => {
      finish(new Error(`fixture exited before listening (code ${String(code)}): ${stderr}`));
    };
    const onError = (error: Error): void => {
      finish(error);
    };
    function finish(error?: Error, port?: number): void {
      clearTimeout(timer);
      child.stdout.off('data', onStdout);
      child.stderr.off('data', onStderr);
      child.off('exit', onExit);
      child.off('error', onError);
      if (port !== undefined) resolve(port);
      else reject(error ?? new Error('fixture did not report its port'));
    }
    child.stdout.on('data', onStdout);
    child.stderr.on('data', onStderr);
    child.once('exit', onExit);
    child.once('error', onError);
  });
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), STOP_GRACE_MS);
    await exited;
    clearTimeout(timer);
  }
  running.delete(child);
}

// A fixture process of its own on an ephemeral port, killed when this process exits.
export async function startFixture(): Promise<FixtureHandle> {
  installExitHook();
  const child = spawn(process.execPath, [SERVER_PATH], {
    env: { ...process.env, PORT: '0', SUPERVISOR_CODE },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  running.add(child);

  let port: number;
  try {
    port = await waitForListening(child);
  } catch (error) {
    await stopChild(child);
    throw error;
  }
  child.stdout.resume();
  child.stderr.resume();

  const baseUrl = `http://localhost:${String(port)}`;
  let stopping: Promise<void> | undefined;

  return {
    baseUrl,
    async armFault(kind) {
      const response = await fetch(`${baseUrl}/_fault`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind }),
      });
      const body = await response.text();
      if (body !== `armed:${kind}`) throw new Error(`could not arm fault ${kind}: ${String(response.status)} ${body}`);
    },
    stop() {
      stopping ??= stopChild(child);
      return stopping;
    },
  };
}

// The committed policy with its allowlist pointed at this fixture instead of localhost:8080.
export function fixturePolicy(policy: Policy, fixture: FixtureHandle): Policy {
  return { ...policy, allowedOrigins: [new URL(fixture.baseUrl).origin] };
}

export type ArmPlan = {
  readonly stepId: string;
  readonly kind: FaultKind;
  // How many times the step's action gets the fault armed right before it (default 1).
  readonly times?: number;
};

// Faults are one-shot and fire on the next request, sign-in included, so they are armed
// right before the step's own action rather than before the run.
export function armBefore(gateway: ActionGateway, fixture: FixtureHandle, plan: ArmPlan): ActionGateway {
  let remaining = plan.times ?? 1;
  return {
    ...gateway,
    async perform(request) {
      if (request.purpose === 'step' && request.stepId === plan.stepId && remaining > 0) {
        remaining -= 1;
        await fixture.armFault(plan.kind);
      }
      return gateway.perform(request);
    },
  };
}
