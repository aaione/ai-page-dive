/** ai-page-dive install：写 NM host manifest（macOS）+ CLI 探测输出 */
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { probeAgents } from './agents/registry.js'
import { assertNotRoot } from './rootguard.js'

const HOST_NAME = 'com.pagedive.host'

/**
 * NM host 由 Chrome 以极简 PATH（/usr/bin:/bin:…）exec——nvm/brew 的 node 不在
 * 其中，#!/usr/bin/env node 会失败。生成写死当前 node 绝对路径的 wrapper；
 * 该路径失效时（nvm 切版本/卸载）回退 PATH 上的 node，面板再引导重装刷新。
 */
async function writeHostWrapper(hostEntry: string): Promise<string> {
  const nodeBin = process.execPath
  const wrapper = join(homedir(), '.ai-page-dive', 'host-wrapper.sh')
  await mkdir(join(homedir(), '.ai-page-dive'), { recursive: true })
  await writeFile(
    wrapper,
    `#!/bin/sh\n[ -x "${nodeBin}" ] || exec /usr/bin/env node "${hostEntry}" --stdio\nexec "${nodeBin}" "${hostEntry}" --stdio\n`,
    { mode: 0o755 },
  )
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

/**
 * 安静版注册（install 与 postinstall 共用）：写 wrapper + 各目录 manifest。
 * - origins 跨目录累计 union（追加不覆盖，末目录 prev 不丢已登记 ID）
 * - manifest 原子写（tmp + rename）：中途崩溃不留半写 JSON
 * - 旧 manifest path 变化时提示（开发态切全局包时的排查线索）
 * - 返回实际写入的 manifest 路径（postinstall 据此区分真成功/Chrome 未装）
 * 顺序约束：wrapper 必须先于所有 manifest 写入（半成功时 manifest 不指向死 wrapper）。
 */
export async function registerManifests(extIds: string[], quiet = false): Promise<string[]> {
  // host 入口：本文件编译产物的真实路径（解析 npm global symlink）。
  // fileURLToPath 而非 import.meta.dirname：后者 Node >=20.11 才有，engines 宣称 >=18。
  // PAGEDIVE_HOST_ENTRY：测试注入（vitest 跑 src/ 源码时 dist 入口不存在）
  const hostPath = process.env.PAGEDIVE_HOST_ENTRY ?? resolve(dirname(fileURLToPath(import.meta.url)), 'index.js')
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
  const written: string[] = []
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
      // 重指向排查线索：旧 manifest 指向别处（如开发仓库 → 全局包）。
      // 手动 install 排查时同样需要看到（受众恰是主动跑命令的人）
      if (typeof prev.path === 'string' && prev.path !== wrapperPath) {
        console.log(`[ai-page-dive] NM host 重定向: ${prev.path} → ${wrapperPath}`)
      }
    } catch { /* 首次 */ }
    for (const id of extIds) {
      // Chrome 扩展 ID 恒为 32 位 a-p（mpdecimal）。畸形 id 原样进 allowed_origins
      // 只会写出永不匹配的死条目——直接跳过并提示，避免污染 manifest
      if (!/^[a-p]{32}$/.test(id)) {
        if (!quiet) console.log(`⚠️  跳过非法扩展 ID（应为 32 位 a-p）：${JSON.stringify(id)}`)
        continue
      }
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
    // 原子写：同目录 tmp + rename，崩溃时旧 manifest 完整
    await writeFile(`${manifestPath}.tmp`, JSON.stringify(manifest, null, 2) + '\n')
    await rename(`${manifestPath}.tmp`, manifestPath)
    written.push(manifestPath)
    if (!quiet) console.log(`✅ NM host manifest 已写入 ${manifestPath}`)
  }
  return written
}

export async function install(extIds: string[]): Promise<void> {
  // root/sudo 守卫：与 postinstall 同一防线（install 是用户显式执行，直接中止而非跳过）
  assertNotRoot('install')
  const written = await registerManifests(extIds)
  if (!written.length) {
    console.log('⚠️  未发现 Chrome 数据目录（Chrome 从未启动过？）——启动一次 Chrome 后重新运行 install')
  } else if (!written.some((p) => readFileSyncSafe(p).allowed_origins?.length)) {
    console.log('⚠️  尚无 allowed_origins：开发期用 ai-page-dive install --ext-id <扩展ID>')
  }

  const agents = await probeAgents()
  console.log('本机 CLI 探测：')
  for (const a of agents) {
    console.log(a.available ? `  ✅ ${a.id} ${a.version ?? ''}` : `  ⛔ ${a.id} 未安装`)
  }
}

function readFileSyncSafe(p: string): any {
  // 小工具：install() 内部读回刚写的 manifest（失败当空处理）
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return {}
  }
}
