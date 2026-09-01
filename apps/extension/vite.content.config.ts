import { defineConfig } from 'vite'

/**
 * content script 单独构建为自包含 IIFE。
 * chrome.scripting.executeScript files 注入的是 classic script，不能含 import
 * 语句——主构建（ESM chunks）产物注入会静默 SyntaxError。
 */
export default defineConfig({
  // manifest/icons 已由主构建拷贝；本步只产出 content.js。publicDir 彻底关闭，
  // 否则 vite 会把 public/（此时已被 exit hook 还原为无权限版）再拷进 outDir，
  // 顶掉 E2E 变体主构建写入的 host_permissions。
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: new URL('./src/content/extract.ts', import.meta.url).pathname,
      name: '__pagedive',
      formats: ['iife'],
      fileName: () => 'content.js',
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
})
