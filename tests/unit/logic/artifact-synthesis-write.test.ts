import { describe, expect, it } from 'vitest';
import { synthesizeArtifact, type Synthesis } from '../../../src/logic/artifact-synthesis';
import type { AgentDecision } from '../../../src/models/action';
import type { Capability, Provenance } from '../../../src/models/capability';
import type { CapabilityRequest } from '../../../src/models/capability-request';
import type { AgentTraceStep, HumanTraceStep, TraceStep } from '../../../src/models/discovery';
import type { ElementDescriptor } from '../../../src/models/element-descriptor';
import type { HumanAction } from '../../../src/models/intervention';
import type { Observation, ObservationNode } from '../../../src/models/observation';
import type { OutcomeCatalog } from '../../../src/models/outcome-catalog';

// The write flow as discovery records it: the model fills the form up to the review, the
// gateway blocks its Confirm, and a human clicks it and accepts the page's confirm().
const REQUEST: CapabilityRequest = {
  capability: {
    id: 'member.open-sub-account',
    version: '1.0.0',
    description: 'Open a sub-account',
    app: { product: 'legacy-member-console', surface: 'web' },
  },
  goal: 'Open a new {{accountType}} sub-account for member {{memberId}} with nickname {{nickname}} and an initial deposit of {{initialDeposit}}',
  inputs: {
    memberId: { type: 'string', description: 'Member ID', pattern: '^[0-9]+$', sensitivity: 'internal', example: '10001' },
    accountType: { type: 'string', description: 'Type', enum: ['Savings', 'Money Market', 'Holiday Club'], sensitivity: 'none', example: 'Money Market' },
    nickname: { type: 'string', description: 'Nickname', pattern: '^.{1,40}$', sensitivity: 'none', example: 'Rainy Day' },
    initialDeposit: { type: 'string', description: 'Deposit', pattern: '^[0-9]+(\\.[0-9]{1,2})?$', sensitivity: 'financial', example: '250.00' },
  },
  outputs: { accountNumber: { type: 'string', description: 'New account number', sensitivity: 'financial' } },
  outcomes: ['member_not_found', 'invalid_initial_deposit', 'invalid_nickname'],
};

const CATALOG: OutcomeCatalog = {
  product: 'legacy-member-console',
  targets: {},
  outcomes: [
    { id: 'member_not_found', kind: 'business', when: { kind: 'text_visible', text: 'No records found.', frame: 'content' } },
    {
      id: 'invalid_initial_deposit',
      kind: 'business',
      when: { kind: 'text_visible', text: 'Initial deposit must be at least $25.00', frame: 'content' },
    },
    {
      id: 'invalid_nickname',
      kind: 'business',
      when: { kind: 'text_visible', text: 'Nickname is required and may not contain special characters.', frame: 'content' },
    },
  ],
};

const PROVENANCE: Provenance = {
  method: 'discovered',
  createdAt: '2026-09-24T12:00:00.000Z',
  runId: '2026-09-24T12-00-00-000Z-discovery-member.open-sub-account',
  reasoner: { adapter: 'local', model: 'qwen3:14b' },
};

let nextId = 0;
function screen(nodes: ObservationNode[]): Observation {
  nextId += 1;
  return { observationId: nextId, url: 'http://localhost:8080/', frames: [{ name: null, url: 'http://localhost:8080/' }], nodes, dialog: null };
}

function content(ref: string, role: string, name: string, extra: Partial<ObservationNode> = {}): ObservationNode {
  return { ref, role, name, frame: 'content', ...extra };
}

const MENU: ObservationNode = { ref: 'e1', role: 'link', name: 'Member Lookup', frame: null };
const MEMBER_ID = content('e2', 'textbox', '', { label: 'Member ID', value: '' });
const SEARCH = content('e3', 'button', 'Search');
const MARIA = content('e4', 'link', 'Maria Santos');
const OPEN = content('e5', 'button', 'Open Sub-Account');
const TYPE = content('e6', 'combobox', '', { label: 'Account Type', value: '' });
const NICKNAME = content('e7', 'textbox', '', { label: 'Nickname', value: '' });
const DEPOSIT = content('e8', 'textbox', '', { label: '$', value: '' });
const CONTINUE = content('e9', 'button', 'Continue');
const CONFIRM = content('e10', 'button', 'Confirm');
const NUMBER = content('e11', 'cell', '10001MMRAIN025000');

const WELCOME = screen([MENU, { role: 'text', name: 'Welcome', frame: 'content' }]);
const lookup = (value: string) => screen([MENU, content('e12', 'cell', 'Member ID:'), { ...MEMBER_ID, value }, SEARCH]);
const RESULTS = screen([MENU, content('e13', 'generic', 'Member Search Results'), content('e14', 'cell', '10001'), MARIA]);
const DETAIL = screen([MENU, content('e15', 'generic', 'Member Detail'), OPEN]);
const form = (type: string, nickname: string, deposit: string) =>
  screen([
    MENU,
    content('e16', 'generic', 'Open Sub-Account'),
    content('e17', 'cell', 'Account Type:'),
    content('e18', 'cell', type),
    TYPE,
    content('e19', 'cell', 'Nickname:'),
    { ...NICKNAME, value: nickname },
    content('e20', 'cell', 'Initial Deposit:'),
    { ...DEPOSIT, value: deposit },
    CONTINUE,
  ]);
const REVIEW = screen([MENU, content('e21', 'generic', 'Review Sub-Account Request'), content('e22', 'cell', 'Rainy Day'), CONFIRM]);
const OPENED = screen([
  MENU,
  content('e23', 'generic', 'Sub-Account Opened'),
  content('e24', 'cell', 'Member ID:'),
  content('e25', 'cell', '10001'),
  content('e26', 'cell', 'New Account Number:'),
  NUMBER,
]);

function agent(
  stepId: string,
  decision: [AgentDecision['verb'], ObservationNode, string?],
  descriptor: ElementDescriptor,
  observation: Observation,
  observationAfter: Observation,
  value?: string,
): AgentTraceStep {
  const [verb, node, argument] = decision;
  return {
    stepId,
    decision: { verb, target: node.ref ?? null, argument: argument ?? null, rationale: 'test' },
    observation,
    element: { node, descriptor },
    ...(value === undefined ? {} : { value }),
    observationAfter,
    progressed: true,
  };
}

const AT = '2026-09-24T12:00:00.000Z';
const CONFIRM_TARGET = {
  frame: 'content',
  tag: 'input',
  role: 'button',
  name: 'Confirm',
  id: 'ctl00_ContentPlaceHolder1_btnPrimary',
  nameAttr: 'ctl00$ContentPlaceHolder1$btnPrimary',
};

function human(action: HumanAction, element?: HumanTraceStep['element']): HumanTraceStep {
  return { actor: 'human', stepId: 'step-10', interventionId: 'int-1', action, ...(element === undefined ? {} : { element }), observation: REVIEW, observationAfter: OPENED };
}

function handoff(decision: 'accept' | 'dismiss' = 'accept'): HumanTraceStep[] {
  return [
    human(
      { kind: 'click', target: CONFIRM_TARGET, at: AT },
      { node: CONFIRM, descriptor: { attributes: { name: CONFIRM_TARGET.nameAttr, id: CONFIRM_TARGET.id } } },
    ),
    human({ kind: 'dialog', message: 'Submit this sub-account request?', decision, at: AT }),
    human({ kind: 'navigation', frame: 'content', url: 'http://localhost:8080/member/subacct/confirm', at: AT }),
  ];
}

const NUMBER_DESCRIPTOR: ElementDescriptor = {
  attributes: {},
  label: 'New Account Number:',
  cell: { column: '10001', row: { 'Member ID:': 'New Account Number:', '10001': '10001MMRAIN025000' } },
};

function writeFlow(numberDescriptor: ElementDescriptor = NUMBER_DESCRIPTOR, dialog: 'accept' | 'dismiss' = 'accept'): TraceStep[] {
  return [
    agent('step-1', ['click', MENU], { attributes: {} }, WELCOME, lookup('')),
    agent('step-2', ['fill', MEMBER_ID, '10001'], { attributes: { name: 'txtMemberId' }, label: 'Member ID:' }, lookup(''), lookup('10001')),
    agent('step-3', ['click', SEARCH], { attributes: {} }, lookup('10001'), RESULTS),
    agent('step-4', ['click', MARIA], { attributes: {}, cell: { column: 'Name', row: { 'Member ID': '10001', Name: 'Maria Santos' } } }, RESULTS, DETAIL),
    agent('step-5', ['click', OPEN], { attributes: {} }, DETAIL, form('Savings', '', '')),
    agent('step-6', ['select', TYPE, 'Money Market'], { attributes: { name: 'ddlAccountType' }, label: 'Account Type:' }, form('Savings', '', ''), form('Money Market', '', '')),
    agent('step-7', ['fill', NICKNAME, 'Rainy Day'], { attributes: { name: 'txtNickname' }, label: 'Nickname:' }, form('Money Market', '', ''), form('Money Market', 'Rainy Day', '')),
    agent('step-8', ['fill', DEPOSIT, '250.00'], { attributes: { name: 'txtInitialDeposit' }, label: 'Initial Deposit:' }, form('Money Market', 'Rainy Day', ''), form('Money Market', 'Rainy Day', '250.00')),
    agent('step-9', ['click', CONTINUE], { attributes: {} }, form('Money Market', 'Rainy Day', '250.00'), REVIEW),
    ...handoff(dialog),
    agent('step-11', ['read', NUMBER, 'accountNumber'], numberDescriptor, OPENED, OPENED, '10001MMRAIN025000'),
  ];
}

function artifact(synthesis: Synthesis): Capability {
  if (!synthesis.ok) throw new Error(`${synthesis.error.code}: ${synthesis.error.message}`);
  return synthesis.capability;
}

describe('synthesizeArtifact on the write flow', () => {
  it('parameterizes every field and makes the human-performed Confirm the one risky step', () => {
    const { steps } = artifact(synthesizeArtifact(writeFlow(), REQUEST, CATALOG, PROVENANCE));

    expect(steps.map((step) => [step.id, step.action, step.risk])).toEqual([
      ['click-member-lookup', { kind: 'click', target: 'page.memberLookup' }, 'safe'],
      ['fill-member-id', { kind: 'fill', target: 'content.memberId', value: '{{inputs.memberId}}' }, 'safe'],
      ['click-search', { kind: 'click', target: 'content.search' }, 'safe'],
      ['click-name', { kind: 'click', target: 'content.name' }, 'safe'],
      ['click-open-sub-account', { kind: 'click', target: 'content.openSubAccount' }, 'safe'],
      ['select-account-type', { kind: 'select', target: 'content.accountType', value: '{{inputs.accountType}}' }, 'safe'],
      ['fill-nickname', { kind: 'fill', target: 'content.nickname', value: '{{inputs.nickname}}' }, 'safe'],
      ['fill-initial-deposit', { kind: 'fill', target: 'content.initialDeposit', value: '{{inputs.initialDeposit}}' }, 'safe'],
      ['click-continue', { kind: 'click', target: 'content.continue' }, 'safe'],
      ['click-confirm', { kind: 'click', target: 'content.confirm' }, 'risky'],
      ['read-account-number', { kind: 'read', target: 'content.newAccountNumber', output: 'accountNumber' }, 'safe'],
    ]);
    expect(steps.find((step) => step.id === 'click-confirm')?.checkpoint).toEqual({ kind: 'text_visible', text: 'Sub-Account Opened', frame: 'content' });
  });

  it('locates the new account number by the label beside it, never by its value', () => {
    const { targets } = artifact(synthesizeArtifact(writeFlow(), REQUEST, CATALOG, PROVENANCE));

    expect(targets['content.newAccountNumber']).toEqual({ frame: 'content', candidates: [{ strategy: 'label', text: 'New Account Number:' }] });
    expect(targets['content.confirm'].candidates).toEqual([
      { strategy: 'role', role: 'button', name: 'Confirm' },
      { strategy: 'attribute', name: 'name', value: CONFIRM_TARGET.nameAttr },
      { strategy: 'attribute', name: 'id', value: CONFIRM_TARGET.id },
    ]);
  });

  it('copies the validation outcomes the request names', () => {
    const { outcomes } = artifact(synthesizeArtifact(writeFlow(), REQUEST, CATALOG, PROVENANCE));

    expect(outcomes.map((outcome) => [outcome.id, outcome.kind])).toEqual([
      ['member_not_found', 'business'],
      ['invalid_initial_deposit', 'business'],
      ['invalid_nickname', 'business'],
    ]);
  });

  it('refuses a handoff whose dialog the human dismissed', () => {
    const synthesis = synthesizeArtifact(writeFlow(NUMBER_DESCRIPTOR, 'dismiss'), REQUEST, CATALOG, PROVENANCE);

    expect(synthesis).toMatchObject({ ok: false, error: { code: 'unsupported_human_steps', stepId: 'step-10' } });
  });

  it('does not locate a read by a label that is record data', () => {
    const synthesis = synthesizeArtifact(writeFlow({ attributes: {}, label: '100018830' }), REQUEST, CATALOG, PROVENANCE);

    expect(synthesis).toMatchObject({ ok: false, error: { code: 'untargetable_element', stepId: 'step-11' } });
  });
});
