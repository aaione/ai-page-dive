import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// E2E 构建变体：临时加 host_permissions（浏览器手势无法自动化，E2E 需要注入权限
// 验证全链路；产品构建不含此权限，手势授权由人工验收）。
// 做法：整个 public/ 复制到 node_modules/.pd-e2e-public/ 副本，在副本 manifest 注入、
// publicDir 指向副本——绝不原地改 public/manifest.json（进程被 kill -9 时 `<all_urls>`
// 会残留在源文件，CWS 红线）。副本在 node_modules 里天然不入 git。
const BROAD = !!process.env.E2E_BROAD_PERMS
const E2E_PUBLIC = resolve(__dirname, 'node_modules/.pd-e2e-public')
if (BROAD) {
  rmSync(E2E_PUBLIC, { recursive: true, force: true })
  cpSync(resolve(__dirname, 'public'), E2E_PUBLIC, { recursive: true })
  const m = JSON.parse(readFileSync(resolve(E2E_PUBLIC, 'manifest.json'), 'utf8'))
  m.host_permissions = ['<all_urls>']
  writeFileSync(resolve(E2E_PUBLIC, 'manifest.json'), JSON.stringify(m, null, 2) + '\n')
}
process.on('exit', () => {
  // 构建结束清副本（源 public/ 从未被碰，无需恢复动作）
  if (BROAD) rmSync(E2E_PUBLIC, { recursive: true, force: true })
})

export default defineConfig({
  publicDir: BROAD ? E2E_PUBLIC : 'public',
  plugins: [react(), tailwindcss()],
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
