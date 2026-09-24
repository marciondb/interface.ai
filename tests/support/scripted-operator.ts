import type { Frame } from 'playwright';
import { createHumanActor, type ActorContext, type HumanActor } from './human-actor';

// The fixture's default supervisor approval code; only the operator ever types it.
export const SUPERVISOR_CODE = '482917';

const SETTLE_MS = 10_000;

function content({ page }: ActorContext): Frame {
  const frame = page.frame({ name: 'content' });
  if (frame === null) throw new Error('scripted operator: no content frame');
  return frame;
}

// Clicks Confirm on the review screen and waits for what it leads to, as a person would
// before typing resume; the page's confirm() is answered at the dialog prompt.
export async function clickConfirm(context: ActorContext): Promise<void> {
  const frame = content(context);
  await frame.getByRole('button', { name: 'Confirm', exact: true }).click();
  await frame.waitForURL((url) => !url.pathname.endsWith('/review'), { timeout: SETTLE_MS });
}

export async function approveWithCode(context: ActorContext): Promise<void> {
  const frame = content(context);
  await frame.locator('input[type="password"]').fill(SUPERVISOR_CODE);
  await frame.getByRole('button', { name: 'Approve', exact: true }).click();
  await frame.getByText('Sub-Account Opened', { exact: true }).waitFor({ timeout: SETTLE_MS });
}

// Takes control, confirms the sub-account (accepting the dialog) and hands back.
export function operatorConfirms(): HumanActor {
  return createHumanActor([{ command: 'take' }, { act: clickConfirm }, { command: 'resume' }], ['accept']);
}

// Same, and when the checkpoint fails on the supervisor approval screen, enters the code there.
export function operatorConfirmsAndApproves(): HumanActor {
  return createHumanActor(
    [{ command: 'take' }, { act: clickConfirm }, { command: 'resume' }, { act: approveWithCode }, { command: 'resume' }],
    ['accept'],
  );
}

// Takes control and hands back without touching the page.
export function operatorDeclines(): HumanActor {
  return createHumanActor([{ command: 'take' }, { command: 'resume' }]);
}

export function operatorAborts(): HumanActor {
  return createHumanActor([{ command: 'take' }, { command: 'abort' }]);
}
