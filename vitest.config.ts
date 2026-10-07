import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

/** 单元与数据库测试分开，默认检查绝不修改开发数据。 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'server-only': fileURLToPath(new URL('./tests/server-only.ts', import.meta.url)),
    },
  },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
})
