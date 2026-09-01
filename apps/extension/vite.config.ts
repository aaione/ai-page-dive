import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// E2E 构建变体：临时加 host_permissions（浏览器手势无法自动化，E2E 需要注入权限
// 验证全链路；产品构建不含此权限，手势授权由人工验收）。
// 用法：E2E_BROAD_PERMS=1 pnpm build
const BROAD = !!process.env.E2E_BROAD_PERMS
if (BROAD) {
  const src = resolve(__dirname, 'public/manifest.json')
  const m = JSON.parse(readFileSync(src, 'utf8'))
  m.host_permissions = ['<all_urls>']
  writeFileSync(src, JSON.stringify(m, null, 2))
}
process.on('exit', () => {
  // 构建结束恢复原 manifest（git 工作树不残留）
  if (BROAD) {
    const src = resolve(__dirname, 'public/manifest.json')
    const m = JSON.parse(readFileSync(src, 'utf8'))
    delete m.host_permissions
    writeFileSync(src, JSON.stringify(m, null, 2))
  }
})

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, 'sidepanel.html'),
        background: resolve(__dirname, 'src/background/sw.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        format: 'es',
      },
    },
  },
})
