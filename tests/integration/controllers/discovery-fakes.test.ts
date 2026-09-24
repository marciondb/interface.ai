import { describe, expect, it } from 'vitest';
import { discover } from '../../../src/controllers/discovery';
import type { Reasoner, ReasonerInput } from '../../../src/diplomat/reasoner/port';
import type { ArtifactStore } from '../../../src/diplomat/store/port';
import type { AgentDecision } from '../../../src/models/action';
import { CapabilityRequestSchema } from '../../../src/models/capability-request';
import { DiscoveryResultSchema } from '../../../src/models/discovery';
import { createFakeClock, createFakeEscalation, createFakeEvidence, createFakeGateway, createFakeSession, FAKE_ORIGIN, type FakeGatewayOptions } from '../../support/fakes';

const MEMBER = '10001';
const BALANCE = '4,812.37';

const REQUEST = CapabilityRequestSchema.parse({
  capability: { id: 'member.read-balance', version: '1.0.0', description: 'Read a balance', app: { product: 'fake', surface: 'web' } },
  goal: 'Read the balance of member {{memberId}}',
  inputs: { memberId: { type: 'string', description: 'Member id', pattern: '^[0-9]+$', sensitivity: 'internal', example: MEMBER } },
  outputs: { balance: { type: 'string', description: 'Balance', sensitivity: 'financial' } },
  outcomes: [],
});

const EMPTY_STORE: ArtifactStore = {
  load: (id, version) => Promise.resolve({ ok: false, code: 'not_found', path: `/capabilities/${id}/${version}.json`, issues: [] }),
  loadLatest: (id) => Promise.resolve({ ok: false, code: 'not_found', path: `/capabilities/${id}`, issues: [] }),
  save: () => Promise.reject(new Error('fake store: save is not expected')),
};

type Turn = (input: ReasonerInput) => AgentDecision;

function scripted(turns: readonly Turn[]): Reasoner & { readonly inputs: ReasonerInput[] } {
  const inputs: ReasonerInput[] = [];
  return {
    adapter: 'ollama',
    model: 'fake-model',
    inputs,
    propose(input) {
      inputs.push(input);
      const turn = turns[inputs.length - 1];
      if (turn === undefined) throw new Error('script exhausted');
      return Promise.resolve({ decision: turn(input), meta: { provider: 'ollama', model: 'fake-model', evalCount: inputs.length } });
    },
  };
}

function refOf(input: ReasonerInput, name: string): string {
  const ref = input.observation.nodes.find((node) => node.name === name)?.ref;
  if (ref === undefined) throw new Error(`${name} is not on the screen`);
  return ref;
}

const readBalance: Turn = (input) => ({ kind: 'read', action: { kind: 'read', ref: refOf(input, 'detail.balance') }, output: 'balance', rationale: 'the balance' });
const askForHelp: Turn = () => ({ kind: 'request_help', message: 'I am done here', rationale: 'stop' });

async function run(reasoner: Reasoner, gatewayOptions: FakeGatewayOptions = {}) {
  const evidence = createFakeEvidence();
  const escalation = createFakeEscalation({ humanSurfaceAvailable: false });
  const gateway = createFakeGateway({ texts: [`Member ${MEMBER}`], ...gatewayOptions });
  gateway.page.elements.set('detail.balance', { count: 1, value: BALANCE });
  const result = await discover(
    { store: EMPTY_STORE, session: createFakeSession(), gateway, reasoner, evidence, escalation, clock: createFakeClock() },
    { request: REQUEST, catalog: { product: 'fake', targets: {}, outcomes: [] }, targetUrl: `${FAKE_ORIGIN}/`, secrets: [] },
    { stepTimeoutMs: 1_000, pollIntervalMs: 250 },
  );
  return { result, evidence, escalation, gateway };
}

describe('discovery controller with fakes', () => {
  it('stops showing the model a sensitive output once it is read, while the inputs stay visible', async () => {
    const reasoner = scripted([readBalance, askForHelp]);

    const { result, evidence } = await run(reasoner);

    expect(DiscoveryResultSchema.parse(result)).toMatchObject({ status: 'escalated', reason: 'no_operator_surface' });
    expect(evidence.results).toEqual([result]);
    const [before, after] = reasoner.inputs.map((input) => JSON.stringify(input.observation));
    expect(before).toContain(BALANCE);
    expect(after).not.toContain(BALANCE);
    expect(after).toContain('[REDACTED:financial]');
    expect(after).toContain(MEMBER);
  });

  it('masks the sensitive inputs and every output read so far in screenshots and handoffs', async () => {
    const { gateway, escalation } = await run(scripted([readBalance, askForHelp]));

    expect(gateway.screenshots).toEqual([{ maskTexts: [MEMBER] }, { maskTexts: [MEMBER, BALANCE] }]);
    expect(escalation.requests.map((request) => request.maskTexts)).toEqual([[MEMBER, BALANCE]]);
  });

  it('records what the provider said about each decision', async () => {
    const { evidence } = await run(scripted([readBalance, askForHelp]));

    expect(evidence.events.filter((event) => event.type === 'decision').map((event) => event.providerMeta)).toEqual([
      { provider: 'ollama', model: 'fake-model', evalCount: 1 },
      { provider: 'ollama', model: 'fake-model', evalCount: 2 },
    ]);
  });

  it('reports a surface failure as driver_error', async () => {
    const onObserve = () => {
      throw Object.assign(new Error('surface snapshot_mismatch: unexpected shape'), { name: 'SurfaceError' });
    };

    const { result } = await run(scripted([]), { onObserve });

    expect(result).toMatchObject({ status: 'failed', reason: 'driver_error', message: 'surface snapshot_mismatch: unexpected shape' });
  });

  it('rethrows a bug without finishing the run', async () => {
    const evidence = createFakeEvidence();
    const broken: Reasoner = { adapter: 'ollama', model: 'fake-model', propose: () => Promise.reject(new TypeError('undefined is not a function')) };
    const gateway = createFakeGateway({ texts: ['Welcome'], visible: ['menu.lookup'] });

    const discovered = discover(
      { store: EMPTY_STORE, session: createFakeSession(), gateway, reasoner: broken, evidence, escalation: createFakeEscalation({ humanSurfaceAvailable: false }), clock: createFakeClock() },
      { request: REQUEST, catalog: { product: 'fake', targets: {}, outcomes: [] }, targetUrl: `${FAKE_ORIGIN}/`, secrets: [] },
      { stepTimeoutMs: 1_000 },
    );

    await expect(discovered).rejects.toThrow(TypeError);
    expect(evidence.results).toEqual([]);
  });
});
