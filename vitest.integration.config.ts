import { mergeConfig, defineConfig } from 'vitest/config'
import base from './vitest.config'

/** 集成测试仅连接名称以 _test 结尾的真实 PostgreSQL 库。 */
export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: ['tests/integration/**/*.test.ts'],
      exclude: ['tests/unit/**', 'node_modules/**'],
      setupFiles: ['tests/integration/setup.ts'],
      fileParallelism: false,
      testTimeout: 15000,
    },
  }),
)
