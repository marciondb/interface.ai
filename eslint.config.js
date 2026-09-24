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
  {
    files: ['src/**', 'scripts/**'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        { patterns: [{ group: ['**/tests', '**/tests/**'], message: 'src/ and scripts/ never import tests; move what both need to src/ or scripts/lib/.' }] },
      ],
    },
  },
  { files: ['**/*.js', '**/*.cjs'], extends: [tseslint.configs.disableTypeChecked] },
);
