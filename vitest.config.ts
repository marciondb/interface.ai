import { configDefaults, defineConfig } from 'vitest/config';

const live = process.env.RUN_LIVE_MODEL === '1';

export default defineConfig({
  test: {
    exclude: live ? configDefaults.exclude : [...configDefaults.exclude, 'tests/live/**'],
    projects: [
      { extends: true, test: { name: 'unit', include: ['tests/unit/**/*.test.ts'] } },
      {
        extends: true,
        // A browser, a fixture process and, for discovery, several handoff round trips per test.
        test: { name: 'integration', include: ['tests/integration/**/*.test.ts', 'tests/live/**/*.test.ts'], testTimeout: 60_000, hookTimeout: 30_000 },
      },
    ],
  },
});
