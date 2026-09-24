// A small but complete capability file (the RFC-002 example), as raw JSON.
// Returns a fresh object so tests can mutate it.
export function capabilityFile() {
  return {
    schemaVersion: 1,
    capability: {
      id: 'member.read-account-balance',
      version: '1.0.0',
      description: 'Look up a member and read the balance of one account type',
      app: { product: 'legacy-member-console', surface: 'web' },
    },
    preconditions: [{ kind: 'authenticated_session' }],
    inputs: {
      memberId: {
        type: 'string',
        description: 'Member identifier',
        pattern: '^[0-9]{1,12}$',
        sensitivity: 'internal',
      },
      accountType: {
        type: 'string',
        description: 'Account type to read',
        enum: ['Checking', 'Savings', 'Money Market'],
        sensitivity: 'none',
      },
    },
    outputs: {
      balance: { type: 'string', description: 'Balance as displayed', sensitivity: 'financial' },
    },
    targets: {
      'lookup.memberId': {
        frame: 'content',
        candidates: [
          { strategy: 'label', text: 'Member ID:' },
          { strategy: 'attribute', name: 'name', value: 'ctl00$ContentPlaceHolder1$txtMemberId' },
        ],
      },
      'detail.balance': {
        frame: 'content',
        candidates: [
          { strategy: 'table_cell', row: { column: 'Acct Type', equals: '{{inputs.accountType}}' }, column: 'Balance' },
        ],
      },
      'interstitial.continue': {
        frame: 'content',
        candidates: [{ strategy: 'role', role: 'button', name: 'Continue' }],
      },
    },
    steps: [
      {
        id: 'enter-member-id',
        action: { kind: 'fill', target: 'lookup.memberId', value: '{{inputs.memberId}}' },
        risk: 'safe',
        checkpoint: { kind: 'value_equals', target: 'lookup.memberId', value: '{{inputs.memberId}}' },
      },
      {
        id: 'read-balance',
        action: { kind: 'read', target: 'detail.balance', output: 'balance' },
        risk: 'safe',
        checkpoint: { kind: 'value_matches', target: 'detail.balance', pattern: '^[0-9][0-9,]*\\.[0-9]{2}$' },
      },
    ],
    outcomes: [
      {
        id: 'member_not_found',
        kind: 'business',
        when: { kind: 'text_visible', text: 'No records found.', frame: 'content' },
      },
      {
        id: 'interstitial',
        kind: 'recoverable',
        when: { kind: 'text_visible', text: 'Click Continue to proceed', frame: 'content' },
        recover: { kind: 'click', target: 'interstitial.continue' },
      },
    ],
    provenance: { method: 'hand_written', createdAt: '2026-09-24T00:00:00Z' },
  };
}
