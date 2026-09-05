/** ai-page-dive install：写 NM host manifest（macOS）+ CLI 探测输出 */
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { probeAgents } from './agents/registry.js'

const HOST_NAME = 'com.pagedive.host'

/**
 * NM host 由 Chrome 以极简 PATH（/usr/bin:/bin:…）exec——nvm/brew 的 node 不在
 * 其中，#!/usr/bin/env node 会失败。生成写死当前 node 绝对路径的 wrapper。
 */
async function writeHostWrapper(hostEntry: string): Promise<string> {
  const nodeBin = process.execPath
  const wrapper = join(homedir(), '.ai-page-dive', 'host-wrapper.sh')
  await mkdir(join(homedir(), '.ai-page-dive'), { recursive: true })
  await writeFile(wrapper, `#!/bin/sh\nexec "${nodeBin}" "${hostEntry}" --stdio\n`, { mode: 0o755 })
  await chmod(wrapper, 0o755)
  return wrapper
}

/** macOS 下 NM manifest 目录：正式 Chrome + Chrome for Testing（E2E/开发用） */
export function macOSManifestDirs(): string[] {
  const base = join(homedir(), 'Library/Application Support/Google')
  return [join(base, 'Chrome'), join(base, 'Chrome for Testing')].map((d) =>
    join(d, 'NativeMessagingHosts'),
  )
}

export async function install(extIds: string[]): Promise<void> {
  // host 入口：本文件编译产物的真实路径（解析 npm global symlink）。
  // fileURLToPath 而非 import.meta.dirname：后者 Node >=20.11 才有，engines 宣称 >=18
  const hostPath = resolve(dirname(fileURLToPath(import.meta.url)), 'index.js')
  if (!existsSync(hostPath)) {
    throw new Error(`host entry not found: ${hostPath}`)
  }
  await chmod(hostPath, 0o755)
  const wrapperPath = await writeHostWrapper(hostPath)

  // origins 追加不覆盖（开发 ID 与正式 CWS ID 共存）
  let origins: string[] = []
  // E2E/开发：额外 NM 目录（如 CFT 的 user-data-dir/NativeMessagingHosts）
  const extra = process.env.PAGEDIVE_EXTRA_NM_DIR
  const dirs = [...macOSManifestDirs(), ...(extra ? [extra] : [])]
  for (const dir of dirs) {
    if (!existsSync(join(dir, '..'))) continue
    const manifestPath = join(dir, `${HOST_NAME}.json`)
    await mkdir(dir, { recursive: true })
    try {
      const prev = JSON.parse(await readFile(manifestPath, 'utf8'))
      // 跨目录累计 union（追加不覆盖）：末目录 prev 不能重置前面目录已登记的 ID
      for (const o of prev.allowed_origins ?? []) {
        if (!origins.includes(o)) origins.push(o)
      }
    } catch { /* 首次 */ }
    for (const id of extIds) {
      const origin = `chrome-extension://${id}/`
      if (!origins.includes(origin)) origins.push(origin)
    }
    const manifest = {
      name: HOST_NAME,
      description: 'AI PageDive native host',
      path: wrapperPath,
      type: 'stdio',
      allowed_origins: origins,
    }
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
    console.log(`✅ NM host manifest 已写入 ${manifestPath}`)
  }
  if (!origins.length) {
    console.log('⚠️  尚无 allowed_origins：开发期用 ai-page-dive install --ext-id <扩展ID>')
  }

  const agents = await probeAgents()
  console.log('本机 CLI 探测：')
  for (const a of agents) {
    console.log(a.available ? `  ✅ ${a.id} ${a.version ?? ''}` : `  ⛔ ${a.id} 未安装`)
  }
}
