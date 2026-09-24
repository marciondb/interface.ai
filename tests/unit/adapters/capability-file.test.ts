import { describe, expect, it } from 'vitest';
import { fromCapabilityFile, toCapabilityFile } from '../../../src/adapters/capability-file';
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
  ])('rejects %s', (_, change, expected) => {
    expect(issuesOf(mutated(change))).toContain(expected);
  });

  it('rejects input that is not an object', () => {
    expect(issuesOf('{}')).toEqual(['(root): Invalid input: expected object, received string']);
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
});
