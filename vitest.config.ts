import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      // 测试直接吃 TS 源码，不依赖先 build
      '@pagedive/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)),
    },
  },
})
