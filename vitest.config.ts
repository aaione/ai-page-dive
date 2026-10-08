import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // r33：apps 源码内单测（extension 纯函数）与 packages 测试同场收集；
    // r63（审计 medium#2）：起收 *.test.tsx（UI 组件冒烟还债第一锹）
    include: ['packages/*/test/**/*.test.{ts,tsx}', 'apps/*/src/**/*.test.{ts,tsx}'],
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      // 测试直接吃 TS 源码，不依赖先 build。r56（#6）：键名原为 @pagedive/shared
      // （.pagedive→.ai-page-dive 改名前的残留死键），别名从未命中——测试实际
      // 吃的是 workspace 链接的 dist，「不依赖先 build」一直没兑现
      '@ai-page-dive/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)),
    },
  },
})
