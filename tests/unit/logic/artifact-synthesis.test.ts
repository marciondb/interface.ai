import { describe, expect, it } from 'vitest';
import { synthesizeArtifact, type Synthesis } from '../../../src/logic/artifact-synthesis';
import type { AgentDecision } from '../../../src/models/action';
import type { Capability, Provenance } from '../../../src/models/capability';
import type { CapabilityRequest } from '../../../src/models/capability-request';
import type { AgentTraceStep, HumanTraceStep, TraceStep } from '../../../src/models/discovery';
import type { ElementDescriptor } from '../../../src/models/element-descriptor';
import type { Observation, ObservationNode } from '../../../src/models/observation';
import type { OutcomeCatalog } from '../../../src/models/outcome-catalog';

const REQUEST: CapabilityRequest = {
  capability: {
    id: 'member.read-account-balance',
    version: '1.0.1',
    description: 'Read a balance',
    app: { product: 'legacy-member-console', surface: 'web' },
  },
  goal: 'Look up member {{memberId}} and read the balance of their {{accountType}} account',
  inputs: {
    memberId: { type: 'string', description: 'Member ID', pattern: '^[0-9]{1,12}$', sensitivity: 'internal', example: '10001' },
    accountType: { type: 'string', description: 'Account type', enum: ['Checking', 'Savings'], sensitivity: 'none', example: 'Savings' },
  },
  outputs: { balance: { type: 'string', description: 'Balance', sensitivity: 'financial' } },
  outcomes: ['member_not_found', 'interstitial'],
};

const CATALOG: OutcomeCatalog = {
  product: 'legacy-member-console',
  targets: { 'interstitial.continue': { frame: 'content', candidates: [{ strategy: 'role', role: 'button', name: 'Continue' }] } },
  outcomes: [
    { id: 'member_not_found', kind: 'business', when: { kind: 'text_visible', text: 'No records found.', frame: 'content' } },
    { id: 'member_restricted', kind: 'business', when: { kind: 'text_visible', text: 'not authorized', frame: 'content' } },
    {
      id: 'interstitial',
      kind: 'recoverable',
      when: { kind: 'text_visible', text: 'Click Continue to proceed', frame: 'content' },
      recover: { kind: 'click', target: 'interstitial.continue' },
    },
  ],
};

const PROVENANCE: Provenance = {
  method: 'discovered',
  createdAt: '2026-09-24T12:00:00.000Z',
  runId: '2026-09-24T12-00-00-000Z-discovery-member.read-account-balance',
  reasoner: { adapter: 'local', model: 'qwen3:14b' },
};

let nextId = 0;
function screen(nodes: ObservationNode[]): Observation {
  nextId += 1;
  return { observationId: nextId, url: 'http://localhost:8080/', frames: [{ name: null, url: 'http://localhost:8080/' }], nodes, dialog: null };
}

const MENU: ObservationNode = { ref: 'e1', role: 'link', name: 'Member Lookup', frame: null };
const MAIN_MENU: ObservationNode = { ref: 'e2', role: 'cell', name: 'MAIN MENU', frame: null };
const WELCOME = screen([MENU, MAIN_MENU, { role: 'text', name: 'Welcome', frame: 'content' }]);
const TEXTBOX: ObservationNode = { ref: 'e5', role: 'textbox', name: '', label: 'Member ID', value: '', frame: 'content' };
const SEARCH: ObservationNode = { ref: 'e6', role: 'button', name: 'Search', frame: 'content' };
const lookup = (value: string) =>
  screen([
    MENU,
    MAIN_MENU,
    { ref: 'e3', role: 'cell', name: `Member Lookup Member ID: ${value} Search`, frame: 'content' },
    { ref: 'e4', role: 'cell', name: 'Member ID:', frame: 'content' },
    { ...TEXTBOX, value },
    SEARCH,
  ]);
const MARIA: ObservationNode = { ref: 'e9', role: 'link', name: 'Maria Santos', frame: 'content' };
const RESULTS = screen([
  MENU,
  { ref: 'e7', role: 'generic', name: 'Member Search Results', frame: 'content' },
  { ref: 'e8', role: 'cell', name: '10001', frame: 'content' },
  MARIA,
]);
const BALANCE: ObservationNode = { ref: 'e12', role: 'cell', name: '4,812.37', frame: 'content' };
const DETAIL = screen([
  MENU,
  { ref: 'e10', role: 'generic', name: 'Member Detail', frame: 'content' },
  { ref: 'e11', role: 'cell', name: 'Savings', frame: 'content' },
  { ref: 'e13', role: 'cell', name: '*****2201', frame: 'content' },
  BALANCE,
]);

function decide(verb: AgentDecision['verb'], node: ObservationNode | undefined, argument: string | null = null): AgentDecision {
  return { verb, target: node?.ref ?? null, argument, rationale: 'test' };
}

function step(
  stepId: string,
  decision: AgentDecision,
  node: ObservationNode | undefined,
  descriptor: ElementDescriptor,
  observation: Observation,
  observationAfter: Observation,
  extra: Partial<AgentTraceStep> = {},
): AgentTraceStep {
  return {
    stepId,
    decision,
    observation,
    ...(node === undefined ? {} : { element: { node, descriptor } }),
    observationAfter,
    progressed: true,
    ...extra,
  };
}

const ASPNET = { name: 'ctl00$ContentPlaceHolder1$txtMemberId', id: 'ctl00_ContentPlaceHolder1_txtMemberId' };
const BALANCE_ROW = { column: 'Balance', row: { 'Acct Type': 'Savings', 'Acct Number': '*****2201', Balance: '4,812.37' } };

function readFlow(): AgentTraceStep[] {
  return [
    step('step-1', decide('click', MENU), MENU, { attributes: {} }, WELCOME, lookup('')),
    step('step-2', decide('click', MAIN_MENU), MAIN_MENU, { attributes: {} }, lookup(''), lookup(''), { progressed: false }),
    step('step-3', decide('fill', TEXTBOX, '10001'), TEXTBOX, { attributes: ASPNET, label: 'Member ID:' }, lookup(''), lookup('10001')),
    step('step-4', decide('click', SEARCH), SEARCH, { attributes: { name: 'ctl00$ContentPlaceHolder1$btnPrimary' } }, lookup('10001'), RESULTS),
    step(
      'step-5',
      decide('click', MARIA),
      MARIA,
      { attributes: {}, cell: { column: 'Name', row: { 'Member ID': '10001', Name: 'Maria Santos' } } },
      RESULTS,
      DETAIL,
    ),
    step('step-6', decide('read', BALANCE, 'balance'), BALANCE, { attributes: {}, cell: BALANCE_ROW }, DETAIL, DETAIL, { value: '4,812.37' }),
  ];
}

function artifact(synthesis: Synthesis): Capability {
  if (!synthesis.ok) throw new Error(`${synthesis.error.code}: ${synthesis.error.message}`);
  return synthesis.capability;
}

function errorOf(synthesis: Synthesis) {
  if (synthesis.ok) throw new Error('expected a synthesis error');
  return synthesis.error;
}

describe('synthesizeArtifact', () => {
  it('turns the steps that made progress into a parameterized artifact', () => {
    const capability = artifact(synthesizeArtifact(readFlow(), REQUEST, CATALOG, PROVENANCE));

    expect(capability.steps.map((item) => [item.id, item.action])).toEqual([
      ['click-member-lookup', { kind: 'click', target: 'page.memberLookup' }],
      ['fill-member-id', { kind: 'fill', target: 'content.memberId', value: '{{inputs.memberId}}' }],
      ['click-search', { kind: 'click', target: 'content.search' }],
      ['click-name', { kind: 'click', target: 'content.name' }],
      ['read-balance', { kind: 'read', target: 'content.balance', output: 'balance' }],
    ]);
    expect(capability.steps.every((item) => item.risk === 'safe')).toBe(true);
    expect(capability.inputs.memberId).toEqual({ type: 'string', description: 'Member ID', pattern: '^[0-9]{1,12}$', sensitivity: 'internal' });
    expect(capability.provenance).toEqual(PROVENANCE);
    expect(capability.preconditions).toEqual([{ kind: 'authenticated_session' }]);
  });

  it('locates elements in a row holding an input value only by their column in that row', () => {
    const { targets } = artifact(synthesizeArtifact(readFlow(), REQUEST, CATALOG, PROVENANCE));

    expect(targets['content.balance']).toEqual({
      frame: 'content',
      candidates: [{ strategy: 'table_cell', row: { column: 'Acct Type', equals: '{{inputs.accountType}}' }, column: 'Balance' }],
    });
    expect(targets['content.name']).toEqual({
      frame: 'content',
      candidates: [{ strategy: 'table_cell', row: { column: 'Member ID', equals: '{{inputs.memberId}}' }, column: 'Name', role: 'link' }],
    });
  });

  it('builds the ADR-008 chain from role, label and attributes elsewhere', () => {
    const { targets } = artifact(synthesizeArtifact(readFlow(), REQUEST, CATALOG, PROVENANCE));

    expect(targets['page.memberLookup'].candidates).toEqual([
      { strategy: 'role', role: 'link', name: 'Member Lookup' },
      { strategy: 'text', text: 'Member Lookup' },
    ]);
    expect(targets['content.memberId'].candidates).toEqual([
      { strategy: 'label', text: 'Member ID:' },
      { strategy: 'attribute', name: 'name', value: ASPNET.name },
      { strategy: 'attribute', name: 'id', value: ASPNET.id },
    ]);
  });

  it('checks each step with what it changed', () => {
    const { steps } = artifact(synthesizeArtifact(readFlow(), REQUEST, CATALOG, PROVENANCE));

    expect(steps.map((item) => item.checkpoint)).toEqual([
      { kind: 'text_visible', text: 'Member ID:', frame: 'content' },
      { kind: 'value_equals', target: 'content.memberId', value: '{{inputs.memberId}}' },
      { kind: 'text_visible', text: 'Member Search Results', frame: 'content' },
      { kind: 'text_visible', text: 'Member Detail', frame: 'content' },
      { kind: 'target_visible', target: 'content.balance' },
    ]);
  });

  it('copies the requested outcomes and their recovery targets from the catalog', () => {
    const capability = artifact(synthesizeArtifact(readFlow(), REQUEST, CATALOG, PROVENANCE));

    expect(capability.outcomes.map((outcome) => outcome.id)).toEqual(['member_not_found', 'interstitial']);
    expect(capability.targets['interstitial.continue']).toEqual(CATALOG.targets['interstitial.continue']);
  });

  it('refuses a read it cannot locate without the value itself', () => {
    const trace = readFlow();
    trace[5] = { ...trace[5], element: { node: BALANCE, descriptor: { attributes: {} } } };

    expect(errorOf(synthesizeArtifact(trace, REQUEST, CATALOG, PROVENANCE))).toMatchObject({ code: 'untargetable_element', stepId: 'step-6' });
  });

  it('drops candidates built from redacted text', () => {
    const trace = readFlow();
    trace[2] = { ...trace[2], element: { node: TEXTBOX, descriptor: { attributes: ASPNET, label: '[REDACTED:secret]' } } };

    const { targets } = artifact(synthesizeArtifact(trace, REQUEST, CATALOG, PROVENANCE));

    expect(targets['content.txtMemberId'].candidates.map((candidate) => candidate.strategy)).toEqual(['attribute', 'attribute']);
  });

  it('refuses an artifact that does not use every input', () => {
    const trace = readFlow();
    trace[5] = { ...trace[5], element: { node: BALANCE, descriptor: { attributes: { id: 'savingsBalance' } } } };

    expect(errorOf(synthesizeArtifact(trace, REQUEST, CATALOG, PROVENANCE))).toMatchObject({ code: 'input_not_used' });
  });

  it('refuses a trace that never read a declared output', () => {
    expect(errorOf(synthesizeArtifact(readFlow().slice(0, 5), REQUEST, CATALOG, PROVENANCE))).toMatchObject({ code: 'output_not_read' });
  });

  it('refuses a click whose effect it cannot check', () => {
    const trace = readFlow();
    trace[3] = { ...trace[3], observationAfter: screen([MENU, { role: 'text', name: '10001', frame: 'content' }]) };

    expect(errorOf(synthesizeArtifact(trace, REQUEST, CATALOG, PROVENANCE))).toMatchObject({ code: 'no_checkpoint', stepId: 'step-4' });
  });

  it('turns a handoff with a single click into a risky step checked by what it revealed', () => {
    const closeButton: ObservationNode = { ref: 'e14', role: 'button', name: 'Close Account', frame: 'content' };
    const before = screen([...DETAIL.nodes, closeButton]);
    const after = screen([MENU, { role: 'text', name: 'Return to Member Detail', frame: 'content' }]);
    const target = { frame: 'content', tag: 'input', role: 'button', name: 'Close Account' };
    const at = '2026-09-24T12:00:00.000Z';
    const human = (action: HumanTraceStep['action'], element?: HumanTraceStep['element']): HumanTraceStep => ({
      actor: 'human',
      stepId: 'step-7',
      interventionId: 'int-1',
      action,
      ...(element === undefined ? {} : { element }),
      observation: before,
      observationAfter: after,
    });
    const trace: TraceStep[] = [
      ...readFlow(),
      human({ kind: 'click', target, at }, { node: closeButton, descriptor: { attributes: {} } }),
      human({ kind: 'navigation', frame: 'content', url: 'http://localhost:8080/member/danger/close', at }),
    ];

    const { steps, targets } = artifact(synthesizeArtifact(trace, REQUEST, CATALOG, PROVENANCE));

    expect(steps.at(-1)).toEqual({
      id: 'click-close-account',
      action: { kind: 'click', target: 'content.closeAccount' },
      risk: 'risky',
      checkpoint: { kind: 'text_visible', text: 'Return to Member Detail', frame: 'content' },
    });
    expect(targets['content.closeAccount']).toEqual({ frame: 'content', candidates: [{ strategy: 'role', role: 'button', name: 'Close Account' }] });

    const typed = [...trace, human({ kind: 'input', target: { frame: 'content', tag: 'input' }, value: '[redacted]', at })];
    expect(errorOf(synthesizeArtifact(typed, REQUEST, CATALOG, PROVENANCE))).toMatchObject({ code: 'unsupported_human_steps', stepId: 'step-7' });
  });
});
