import { describe, expect, it } from 'vitest';
import { toObservation } from '../../../src/adapters/aria-snapshot';
import { ObservationSchema, type Observation } from '../../../src/models/observation';
import { AriaSnapshotWireSchema, type AriaNode, type AriaSnapshotWire } from '../../../src/wire/in/aria-snapshot';

// Recorded from the fixture shell with Member Lookup open in the content frame
// (Playwright 1.63, ariaSnapshotJSON({ mode: 'ai' })), after typing 10001.
const memberLookupContent: AriaNode = {
  role: 'table',
  ref: 'f1e2',
  children: [
    {
      role: 'rowgroup',
      ref: 'f1e3',
      children: [
        {
          role: 'row',
          ref: 'f1e16',
          children: [
            {
              role: 'cell',
              name: 'Member Lookup Member ID: 10001 Search',
              ref: 'f1e17',
              children: [
                { role: 'generic', ref: 'f1e6', text: 'Member Lookup' },
                {
                  role: 'table',
                  ref: 'f1e8',
                  children: [
                    {
                      role: 'rowgroup',
                      ref: 'f1e9',
                      children: [
                        {
                          role: 'row',
                          ref: 'f1e18',
                          children: [
                            { role: 'cell', name: 'Member ID:', ref: 'f1e11' },
                            {
                              role: 'cell',
                              ref: 'f1e19',
                              children: [{ role: 'textbox', active: true, ref: 'f1e13', text: '10001' }],
                            },
                            {
                              role: 'cell',
                              ref: 'f1e14',
                              children: [{ role: 'button', name: 'Search', ref: 'f1e15', cursor: 'pointer' }],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

const shell: AriaNode[] = [
  {
    role: 'table',
    ref: 'e2',
    children: [
      {
        role: 'rowgroup',
        ref: 'e3',
        children: [
          {
            role: 'row',
            ref: 'e14',
            children: [
              {
                role: 'cell',
                ref: 'e15',
                children: [
                  {
                    role: 'table',
                    ref: 'e16',
                    children: [
                      {
                        role: 'rowgroup',
                        ref: 'e17',
                        children: [
                          { role: 'row', ref: 'e18', children: [{ role: 'cell', name: 'MAIN MENU', ref: 'e19' }] },
                          {
                            role: 'row',
                            ref: 'e25',
                            children: [
                              {
                                role: 'cell',
                                ref: 'e26',
                                children: [
                                  { role: 'link', name: 'Member Lookup', ref: 'e28', cursor: 'pointer', url: '/member/search' },
                                ],
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
              {
                role: 'cell',
                ref: 'e29',
                children: [
                  {
                    role: 'iframe',
                    ref: 'e30',
                    text: 'Your browser does not support frames.',
                    children: [memberLookupContent],
                  },
                ],
              },
            ],
          },
          {
            role: 'row',
            ref: 'e12',
            children: [
              { role: 'generic', ref: 'e40', children: ['Signed on: operator |', { role: 'link', name: 'Sign Off', ref: 'e13' }] },
            ],
          },
        ],
      },
    ],
  },
];

function wire(frames: AriaSnapshotWire['frames'] = [{ name: 'content', url: 'http://localhost:8080/member/search' }]) {
  return AriaSnapshotWireSchema.parse({ url: 'http://localhost:8080/', frames, nodes: shell });
}

function adapt(raw: AriaSnapshotWire): { observation: Observation; refTargets: ReadonlyMap<string, string> } {
  const result = toObservation(raw, 3);
  if (!result.ok) throw new Error(result.reason);
  return result;
}

function byName(observation: Observation, role: string, name: string) {
  return observation.nodes.find((node) => node.role === role && node.name === name);
}

describe('toObservation', () => {
  it('produces a valid observation with the top frame and the content frame', () => {
    const { observation } = adapt(wire());

    expect(ObservationSchema.safeParse(observation).success).toBe(true);
    expect(observation.observationId).toBe(3);
    expect(observation.url).toBe('http://localhost:8080/');
    expect(observation.frames).toEqual([
      { name: null, url: 'http://localhost:8080/' },
      { name: 'content', url: 'http://localhost:8080/member/search' },
    ]);
    expect(observation.dialog).toBeNull();
    expect(byName(observation, 'link', 'Member Lookup')?.frame).toBeNull();
    expect(byName(observation, 'button', 'Search')?.frame).toBe('content');
  });

  it('numbers refs densely in document order and maps them back to the raw refs', () => {
    const { observation, refTargets } = adapt(wire());
    const refs = observation.nodes.flatMap((node) => (node.ref === undefined ? [] : [node.ref]));

    expect(refs).toEqual(refs.map((_, index) => `e${String(index + 1)}`));
    expect(refTargets.size).toBe(refs.length);
    const search = byName(observation, 'button', 'Search');
    expect(search?.ref).toBeDefined();
    expect(refTargets.get(search?.ref ?? '')).toBe('f1e15');
  });

  it('leaves containers, nameless structure and the iframe out, and keeps plain text as context', () => {
    const { observation } = adapt(wire());
    const roles = new Set(observation.nodes.map((node) => node.role));

    for (const role of ['table', 'rowgroup', 'row', 'iframe']) expect(roles.has(role)).toBe(false);
    expect(observation.nodes.some((node) => node.name === '' && node.role === 'cell')).toBe(false);
    expect(observation.nodes.some((node) => node.name.includes('does not support frames'))).toBe(false);
    expect(observation.nodes).toContainEqual({ role: 'text', name: 'Signed on: operator |', frame: null });
  });

  it('labels the unnamed textbox from the previous cell and reports its text as value', () => {
    const { observation } = adapt(wire());
    const textbox = observation.nodes.find((node) => node.role === 'textbox');

    expect(textbox).toMatchObject({ name: '', label: 'Member ID', value: '10001', frame: 'content' });
    expect(textbox?.ref).toMatch(/^e\d+$/);
  });

  it('names a generic element from its own text', () => {
    const { observation } = adapt(wire());

    expect(byName(observation, 'generic', 'Member Lookup')?.ref).toMatch(/^e\d+$/);
  });

  it('rejects a snapshot whose iframes do not match the page frames', () => {
    const result = toObservation(wire([]), 1);

    expect(result.ok).toBe(false);
  });
});
