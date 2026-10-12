import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FlatCompat } from '@eslint/eslintrc'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const compat = new FlatCompat({ baseDirectory: __dirname })

const eslintConfig = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),

  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'build/**',
      'playwright-report/**',
      'test-results/**',
      'coverage/**',
      '.storage/**',
      '.backups/**', // 隔离候选与备份不属于应用源码
      '.test-backups/**',
      '.restore-test/**',
      'next-env.d.ts',
      'design/**', // 设计稿是独立静态 HTML，不参与应用 lint
    ],
  },

  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  {
    // CLI 工具与 seed 脚本：控制台输出是它们的正常职责
    files: ['scripts/**/*.mjs', 'scripts/**/*.ts', 'prisma/seed.ts', 'prisma.config.ts'],
    rules: {
      'no-console': 'off',
    },
  },
]

export default eslintConfig
