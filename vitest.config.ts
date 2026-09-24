import { configDefaults, defineConfig } from 'vitest/config';

const live = process.env.RUN_LIVE_MODEL === '1';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: live ? configDefaults.exclude : [...configDefaults.exclude, 'tests/live/**'],
  },
});
