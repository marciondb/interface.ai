import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['fixture/', '.local/']),
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: { '@typescript-eslint/switch-exhaustiveness-check': 'error' },
  },
  { files: ['**/*.js', '**/*.cjs'], extends: [tseslint.configs.disableTypeChecked] },
);
