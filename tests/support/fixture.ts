import { spawn, type ChildProcess, type ChildProcessByStdio } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

type FixtureProcess = ChildProcessByStdio<null, Readable, Readable>;

export type FaultKind = 'slow_load' | 'interstitial' | 'session_expired' | 'server_error' | 'element_missing';

export interface FixtureHandle {
  baseUrl: string;
  armFault(kind: FaultKind): Promise<void>;
  stop(): Promise<void>;
}

const SERVER_PATH = fileURLToPath(new URL('../../fixture/server.js', import.meta.url));
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

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0);
  await once(server, 'listening');
  const address = server.address();
  server.close();
  await once(server, 'close');
  if (address === null || typeof address === 'string') throw new Error('could not allocate a free port');
  return address.port;
}

function waitForListening(child: FixtureProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      finish(new Error(`fixture did not start within ${String(START_TIMEOUT_MS)} ms: ${stderr}`));
    }, START_TIMEOUT_MS);
    const onStdout = (chunk: Buffer): void => {
      stdout += chunk.toString('utf8');
      if (stdout.includes('listening')) finish();
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
    function finish(error?: Error): void {
      clearTimeout(timer);
      child.stdout.off('data', onStdout);
      child.stderr.off('data', onStderr);
      child.off('exit', onExit);
      child.off('error', onError);
      if (error) reject(error);
      else resolve();
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

export async function startFixture(): Promise<FixtureHandle> {
  installExitHook();
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER_PATH], {
    env: { ...process.env, PORT: String(port), SUPERVISOR_CODE: '482917' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  running.add(child);

  try {
    await waitForListening(child);
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
