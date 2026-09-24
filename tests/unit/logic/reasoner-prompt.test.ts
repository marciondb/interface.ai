import { describe, expect, it } from 'vitest';
import { buildUserPrompt, SYSTEM_PROMPT } from '../../../src/logic/reasoner-prompt';
import { VERBS } from '../../../src/models/action';
import type { Observation } from '../../../src/models/observation';
import { loginObservation } from '../../support/observations';

describe('SYSTEM_PROMPT', () => {
  it('describes every verb', () => {
    for (const verb of VERBS) expect(SYSTEM_PROMPT).toContain(`- ${verb}:`);
  });

  it('names no app, flow, or domain', () => {
    expect(SYSTEM_PROMPT).not.toMatch(/member|account|savings|balance|bank|deposit|fixture/i);
  });
});

describe('buildUserPrompt', () => {
  const observation = loginObservation();

  it('lists the goal and one line per element, with plain text indented', () => {
    const prompt = buildUserPrompt({ goal: 'Sign on', observation });
    expect(prompt.split('\n')).toEqual([
      'Goal: Sign on',
      '',
      '[page http://localhost:8080/login]',
      '  text "Please Sign On"',
      'e1 cell "User ID:"',
      'e2 textbox label="User ID" value=""',
      'e3 cell "Password:"',
      'e4 textbox label="Password" value=""',
      'e5 button "Sign On"',
    ]);
  });

  it('adds feedback and repair lines only when given', () => {
    expect(buildUserPrompt({ goal: 'g', observation })).not.toMatch(/Feedback:|Previous answer rejected:/);
    const prompt = buildUserPrompt({ goal: 'g', observation, feedback: 'click on e5 changed nothing', repair: 'not valid JSON' });
    expect(prompt).toContain('Feedback: click on e5 changed nothing');
    expect(prompt).toContain('Previous answer rejected: not valid JSON');
  });

  it('groups elements by frame and shows an open dialog', () => {
    const framed: Observation = {
      observationId: 2,
      url: 'http://app/',
      frames: [
        { name: null, url: 'http://app/' },
        { name: 'content', url: 'http://app/search' },
      ],
      nodes: [
        { ref: 'e1', role: 'link', name: 'Home', frame: null },
        { ref: 'e2', role: 'checkbox', name: 'Exact', checked: true, disabled: true, frame: 'content' },
      ],
      dialog: { type: 'confirm', message: 'Leave page?' },
    };
    expect(buildUserPrompt({ goal: 'g', observation: framed }).split('\n').slice(2)).toEqual([
      '[page http://app/]',
      'e1 link "Home"',
      '[frame content http://app/search]',
      'e2 checkbox "Exact" checked=true disabled',
      '[dialog confirm] "Leave page?"',
    ]);
  });
});
