// r53 #17：playwright-core 解析链——此前五个 e2e 脚本硬编码
// /Users/apple/.nvm/versions/node/v24.15.0/.../playwright-core/index.mjs，node 升版即全体断裂。
// 解析顺序（paths 语义 = 在该目录下找 node_modules/<spec>，故传父目录）：
//   repo node_modules（若日后加 devDep）→ npm 全局直接安装档 → @playwright/mcp
//   嵌套依赖（本机现状：playwright-core 经全局 @playwright/mcp 间接存在）。
// ponytail: 不把 playwright 塞进 repo devDeps（百 MB 级传递体），借用已有全局安装。
export async function loadChromium() {
  const { createRequire } = await import('node:module')
  const { execSync } = await import('node:child_process')
  const { dirname } = await import('node:path')
  const req = createRequire(import.meta.url)
  let globalRoot = ''
  try {
    globalRoot = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    // npm 不在 PATH：跳过全局档
  }
  // 空数组 = 从脚本自身 node_modules 向上解析（repo 档，若日后加 devDep）
  const chain = [
    [],
    ...(globalRoot ? [[dirname(globalRoot)], [`${globalRoot}/@playwright/mcp`]] : []),
  ]
  for (const paths of chain) {
    try {
      const mod = await import(req.resolve('playwright-core', { paths }))
      // CJS interop：cjs-module-lexer 对 playwright-core 的再导出探测不到 chromium
      const c = mod.chromium ?? mod.default?.chromium
      if (c) return c
    } catch {
      // 试下一档
    }
  }
  throw new Error(
    'playwright-core 未找到：请在 repo 安装 devDependency，或全局任装 playwright-core / @playwright/mcp 其一',
  )
}
