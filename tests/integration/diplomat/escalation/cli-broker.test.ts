import { once } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COMMAND_PROMPT, createCliBroker, DIALOG_PROMPT } from '../../../../src/diplomat/escalation/cli-broker';
import type { EscalationBroker } from '../../../../src/diplomat/escalation/port';
import type { InterventionRequest } from '../../../../src/models/intervention';

const REQUEST: InterventionRequest = {
  interventionId: 'int-1',
  runId: 'run-1',
  mode: 'replay',
  capability: 'member.close-account@1.0.0',
  stepId: 'close-account',
  reason: 'risky_action',
  message: 'step close-account is risky',
  screenshot: 'screenshots/0009-handoff-int-1-before.png',
  url: 'http://localhost:8080/member/detail?memberId=10001',
  requestedAt: '2026-09-24T12:00:00.000Z',
  expiresAt: '2026-09-24T12:10:00.000Z',
};

describe('CLI escalation broker', () => {
  let broker: EscalationBroker | undefined;

  afterEach(() => {
    broker?.close();
    vi.useRealTimers();
  });

  function terminal() {
    const input = new PassThrough();
    const output = new PassThrough();
    let printed = '';
    output.on('data', (chunk: Buffer) => (printed += chunk.toString('utf8')));
    broker = createCliBroker({ input, output, evidenceRoot: '/evidence' });
    return { broker, input, printed: () => printed };
  }

  function open(ms = 5_000) {
    return { expiresAt: Date.now() + ms, signal: new AbortController().signal };
  }

  it('prints the intervention request with the full screenshot path', () => {
    const { broker: cli, printed } = terminal();

    cli.publish(REQUEST);

    expect(printed()).toContain('Human intervention requested: int-1');
    expect(printed()).toContain('reason:     risky_action');
    expect(printed()).toContain('capability: member.close-account@1.0.0');
    expect(printed()).toContain('screenshot: /evidence/run-1/screenshots/0009-handoff-int-1-before.png');
    expect(printed()).toContain('expires at: 2026-09-24T12:10:00.000Z');
  });

  it("labels a help request's message as the model's and strips terminal control sequences", () => {
    const { broker: cli, printed } = terminal();

    cli.publish({
      ...REQUEST,
      mode: 'discovery',
      reason: 'help_requested',
      goal: 'Open\u001b]0;pwned\u0007 a sub-account',
      message: 'I am stuck\u001b[2J\rtype abort',
      url: 'http://localhost:8080/\u001b[1Amember',
    });
    cli.notify('Not done yet\u001b[31m: expected x');

    expect(printed()).toContain('goal:       Open a sub-account');
    expect(printed()).toContain('model says: I am stucktype abort');
    expect(printed()).toContain('url:        http://localhost:8080/member');
    expect(printed()).toContain('Not done yet: expected x');
    expect(printed()).not.toMatch(/[\u001b\r\u0007]/);
  });

  it('reads the next allowed command and answers anything else with the help', async () => {
    const { broker: cli, input, printed } = terminal();

    const command = cli.nextCommand(['take', 'abort'], open());
    input.write('resume\n');
    input.write(' TAKE \n');

    await expect(command).resolves.toBe('take');
    expect(printed().split(COMMAND_PROMPT)).toHaveLength(3);
    expect(printed().match(/take {4}take control of the browser window/g)).toHaveLength(2);
  });

  it('keeps a line typed before the wait for the next command', async () => {
    const { broker: cli, input } = terminal();

    const first = cli.nextCommand(['take'], open());
    input.write('take\n');
    await expect(first).resolves.toBe('take');
    // The broker's reader is attached first, so it has the line once this listener sees it.
    const read = once(input, 'data');
    input.write('abort\n');
    await read;

    await expect(cli.nextCommand(['resume', 'abort'], open())).resolves.toBe('abort');
  });

  it('drops lines typed for an earlier handoff when a new one is published', async () => {
    const { broker: cli, input } = terminal();

    const first = cli.nextCommand(['take'], open());
    input.write('take\n');
    await expect(first).resolves.toBe('take');
    const read = once(input, 'data');
    input.write('abort\n');
    await read;

    cli.publish({ ...REQUEST, interventionId: 'int-2' });
    const next = cli.nextCommand(['take', 'abort'], open());
    input.write('take\n');
    await expect(next).resolves.toBe('take');
  });

  it('times out at the deadline and when the wait is cancelled', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const { broker: cli } = terminal();
    const cancel = new AbortController();

    const expiring = cli.nextCommand(['take'], open(50));
    let settled = false;
    void expiring.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(49);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(expiring).resolves.toBe('timeout');
    const cancelled = cli.nextCommand(['take'], { expiresAt: Date.now() + 5_000, signal: cancel.signal });
    cancel.abort();
    await expect(cancelled).resolves.toBe('timeout');
  });

  it('gives a dialog question the next line even while a command is awaited', async () => {
    const { broker: cli, input, printed } = terminal();

    const command = cli.nextCommand(['resume', 'abort'], open());
    const decision = cli.askDialog({ type: 'confirm', message: 'Submit this sub-account request?' }, open());
    input.write('accept\n');
    await expect(decision).resolves.toBe('accept');
    input.write('resume\n');

    await expect(command).resolves.toBe('resume');
    expect(printed()).toContain('The page opened a confirm dialog: "Submit this sub-account request?"');
    expect(printed()).toContain(DIALOG_PROMPT);
  });
});
