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

  {
    // 铁律：middleware 运行在 Edge Runtime，禁止引入 Prisma
    // 见 docs/01-architecture.md §6.3
    files: ['src/middleware.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/lib/prisma',
              message:
                'middleware 运行在 Edge Runtime，不能使用 Prisma。请只做轻量 JWT 校验，授权在 service 层完成。见 docs/01-architecture.md §6.3',
            },
          ],
          patterns: [
            {
              group: ['**/lib/prisma', '@prisma/client'],
              message:
                'middleware 运行在 Edge Runtime，不能使用 Prisma。请只做轻量 JWT 校验，授权在 service 层完成。见 docs/01-architecture.md §6.3',
            },
          ],
        },
      ],
    },
  },
]

export default eslintConfig
