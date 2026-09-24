import { describe, expect, expectTypeOf, it } from 'vitest';
import { fromCapabilityFile, toCapabilityFile } from '../../../src/adapters/capability-file';
import type { Capability } from '../../../src/models/capability';
import type { CapabilityFileOut } from '../../../src/wire/out/capability-file';
import { at } from '../../support/at';
import { capabilityFile } from '../../support/capabilities';

type File = ReturnType<typeof capabilityFile>;

function issuesOf(raw: unknown): string[] {
  const result = fromCapabilityFile(raw);
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.issues;
}

function mutated(change: (file: File & Record<string, unknown>) => void): unknown {
  const file = capabilityFile();
  change(file);
  return file;
}

describe('fromCapabilityFile', () => {
  it('accepts a valid file', () => {
    const result = fromCapabilityFile(capabilityFile());
    expect(result.ok).toBe(true);
    expect(result.ok && result.capability.steps.map((step) => step.id)).toEqual(['enter-member-id', 'read-balance']);
  });

  it.each<[string, (file: File & Record<string, unknown>) => void, string]>([
    ['a secret field', (f) => { Object.assign(f.inputs.memberId, { sensitivity: 'secret' }); }, 'inputs.memberId.sensitivity: secret fields are not allowed (ADR-013)'],
    ['a non-semver version', (f) => { f.capability.version = '1.0'; }, 'capability.version: version must be semver MAJOR.MINOR.PATCH'],
    ['an unknown schemaVersion', (f) => { Object.assign(f, { schemaVersion: 2 }); }, 'schemaVersion: Invalid input: expected 1'],
    ['an unknown target', (f) => { at(f.steps, 1).action.target = 'detail.nope'; }, 'steps.1.action.target: unknown target detail.nope'],
    ['an unknown checkpoint target', (f) => { at(f.steps, 0).checkpoint.target = 'lookup.nope'; }, 'steps.0.checkpoint.target: unknown target lookup.nope'],
    ['an unknown recover target', (f) => { at(f.outcomes, 1).recover = { kind: 'click', target: 'nope' }; }, 'outcomes.1.recover.target: unknown target nope'],
    ['an undeclared placeholder', (f) => { at(f.steps, 0).action.value = '{{inputs.nope}}'; }, 'steps.0.action.value: placeholder names undeclared input nope'],
    ['a malformed placeholder', (f) => { at(f.steps, 0).action.value = '{{memberId}}'; }, 'steps.0.action.value: placeholders must look like {{inputs.<name>}}'],
    ['an output without a read', (f) => { f.steps.pop(); }, 'outputs.balance: output must be produced by exactly one read step, found 0'],
    ['an output read twice', (f) => { f.steps.push({ ...at(f.steps, 1), id: 'read-again' }); }, 'outputs.balance: output must be produced by exactly one read step, found 2'],
    ['a read of an undeclared output', (f) => { at(f.steps, 1).action.output = 'total'; }, 'steps.1.action.output: undeclared output total'],
    ['a duplicate step id', (f) => { at(f.steps, 1).id = 'enter-member-id'; }, 'steps.1.id: duplicate step id enter-member-id'],
    ['a duplicate outcome id', (f) => { at(f.outcomes, 1).id = 'member_not_found'; }, 'outcomes.1.id: duplicate outcome id member_not_found'],
    ['an unknown key', (f) => { Object.assign(at(f.steps, 0), { retries: 3 }); }, 'steps.0: Unrecognized key: "retries"'],
    ['an enum on a number input', (f) => { f.inputs.accountType.type = 'number'; }, 'inputs.accountType: number inputs cannot declare pattern or enum'],
    ['an invalid input pattern', (f) => { f.inputs.memberId.pattern = '^[0-9'; }, 'inputs.memberId.pattern: pattern is not a valid regular expression'],
    ['an enum value outside the pattern', (f) => { Object.assign(f.inputs.accountType, { pattern: '^[A-Z]+$' }); }, 'inputs.accountType.enum.0: enum value does not match pattern'],
    ['an invalid checkpoint pattern', (f) => { at(f.steps, 1).checkpoint.pattern = '('; }, 'steps.1.checkpoint.pattern: pattern is not a valid regular expression'],
    ['a discovered provenance without run and reasoner', (f) => { Object.assign(f.provenance, { method: 'discovered' }); }, 'provenance.runId: Invalid input: expected string, received undefined'],
    ['a target without candidates', (f) => { f.targets['lookup.memberId'].candidates = []; }, 'targets.lookup.memberId.candidates: Too small: expected array to have >=1 items'],
    ['an unknown section', (f) => { Object.assign(f, { retries: 3 }); }, '(root): Unrecognized key: "retries"'],
    ['a missing section', (f) => { Object.assign(f, { outcomes: undefined }); }, 'outcomes: Invalid input: expected array, received undefined'],
    ['an unknown status', (f) => { Object.assign(f, { status: 'published' }); }, 'status: Invalid option: expected one of "draft"|"approved"'],
    ['an empty product version', (f) => { Object.assign(f.capability.app, { productVersion: '' }); }, 'capability.app.productVersion: Too small: expected string to have >=1 characters'],
    ['an overlong input pattern', (f) => { f.inputs.memberId.pattern = `^${'[0-9]'.repeat(40)}$`; }, 'inputs.memberId.pattern: pattern must be at most 200 characters'],
    ['a catastrophic input pattern', (f) => { f.inputs.memberId.pattern = '^([0-9]+)+$'; }, 'inputs.memberId.pattern: pattern repeats a group that holds an unbounded quantifier, which can backtrack catastrophically'],
    ['a catastrophic checkpoint pattern', (f) => { at(f.steps, 1).checkpoint.pattern = '^(\\w+\\s?)*$'; }, 'steps.1.checkpoint.pattern: pattern repeats a group that holds an unbounded quantifier, which can backtrack catastrophically'],
  ])('rejects %s', (_, change, expected) => {
    expect(issuesOf(mutated(change))).toContain(expected);
  });

  it('rejects input that is not an object', () => {
    expect(issuesOf('{}')).toEqual(['(root): Invalid input: expected object, received string']);
  });

  it('accepts a draft status and a product version, and treats both as optional', () => {
    const result = fromCapabilityFile(mutated((f) => {
      Object.assign(f, { status: 'draft' });
      Object.assign(f.capability.app, { productVersion: '4.2.1' });
    }));
    expect(result.ok && [result.capability.status, result.capability.capability.app.productVersion]).toEqual(['draft', '4.2.1']);
    const plain = fromCapabilityFile(capabilityFile());
    expect(plain.ok && [plain.capability.status, plain.capability.capability.app.productVersion]).toEqual([undefined, undefined]);
  });

  it.each(['^[0-9]+(\\.[0-9]{1,2})?$', '^[0-9][0-9,]*\\.[0-9]{2}$', '^.{1,40}$', '^([+*a-z])+$', '^(ab)+$'])('accepts the bounded pattern %s', (pattern) => {
    expect(fromCapabilityFile(mutated((f) => { f.inputs.memberId.pattern = pattern; })).ok).toBe(true);
  });
});

describe('toCapabilityFile', () => {
  it('round-trips a valid file', () => {
    const file = { ...capabilityFile(), notes: 'reviewed' };
    const result = fromCapabilityFile(file);
    expect(result.ok && toCapabilityFile(result.capability)).toEqual(file);
  });

  it('writes schemaVersion first and sections in RFC-002 order', () => {
    const result = fromCapabilityFile({ ...capabilityFile(), notes: 'reviewed' });
    expect(result.ok && Object.keys(toCapabilityFile(result.capability))).toEqual([
      'schemaVersion', 'capability', 'preconditions', 'inputs', 'outputs', 'targets', 'steps', 'outcomes', 'provenance', 'notes',
    ]);
  });

  it('writes status, when present, right after schemaVersion', () => {
    const { schemaVersion, ...sections } = capabilityFile();
    const file = { schemaVersion, status: 'draft', ...sections };
    const result = fromCapabilityFile(file);
    expect(result.ok && Object.keys(toCapabilityFile(result.capability)).slice(0, 3)).toEqual(['schemaVersion', 'status', 'capability']);
    expect(result.ok && toCapabilityFile(result.capability)).toEqual(file);
  });

  // The v1 file is declared at the wire, apart from the model: a model change that alters the
  // file shape fails typecheck here until the wire (and RFC-002) change with it.
  it('declares a v1 file shape identical to the capability model', () => {
    expectTypeOf<Omit<CapabilityFileOut, 'schemaVersion'>>().toEqualTypeOf<Capability>();
  });
});
