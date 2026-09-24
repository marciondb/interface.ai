import { createRequire } from 'node:module';

type FixtureConfig = { readonly DEMO_USER: string; readonly DEMO_PASSWORD: string; readonly SUPERVISOR_CODE: string };

// The fixture's own configuration is the single source of its credentials.
const fixtureConfig = createRequire(import.meta.url)('../../fixture/lib/config.js') as FixtureConfig;

// Shown on the fixture's login page on purpose.
export const FIXTURE_USERNAME = fixtureConfig.DEMO_USER;
export const FIXTURE_PASSWORD = fixtureConfig.DEMO_PASSWORD;
// Passed to every fixture this repo starts; only the operator ever types it.
export const SUPERVISOR_CODE = fixtureConfig.SUPERVISOR_CODE;

// Seeded members (fixture/data/members.json), as read-account-balance inputs.
export const MARIA = { memberId: '10001', accountType: 'Savings' } as const;
export const MARIA_SAVINGS_BALANCE = '4,812.37';
export const JAMES = { memberId: '10002', accountType: 'Savings' } as const;
export const JAMES_SAVINGS_BALANCE = '3,100.55';
export const RESTRICTED = { memberId: '10009', accountType: 'Savings' } as const;
export const NOT_FOUND = { memberId: '99999', accountType: 'Savings' } as const;
