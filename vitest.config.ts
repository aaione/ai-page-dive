import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // r33：apps 源码内单测（extension 纯函数）与 packages 测试同场收集
    include: ['packages/*/test/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      // 测试直接吃 TS 源码，不依赖先 build
      '@pagedive/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)),
    },
  },
})
