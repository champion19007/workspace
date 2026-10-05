import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/cdk.out/**',
      '**/*.d.ts',
      '**/coverage/**',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  // Strict architectural boundary rule: packages/core must NEVER import adapters, apps, or cloud SDKs
  {
    files: ['packages/core/**/*.ts', 'packages/core/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@workspace/adapters',
                '@workspace/adapters/**',
                '**/adapters/**',
                '@workspace/web',
                '@workspace/web/**',
                '@workspace/api',
                '@workspace/api/**',
                '@workspace/worker',
                '@workspace/worker/**',
                '@workspace/lambdas',
                '@workspace/lambdas/**',
                '**/apps/**',
                '@aws-sdk/**',
                'aws-sdk',
                '@supabase/**',
                '@anthropic-ai/**',
                'pg-boss',
              ],
              message:
                'Architectural boundary violation: packages/core contains pure business logic and ports. It must never import from adapters, applications, or external cloud SDKs.',
            },
          ],
        },
      ],
    },
  }
);
