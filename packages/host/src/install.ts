/** pagedive install：写 NM host manifest（macOS）+ CLI 探测输出 */
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { probeAgents } from './agents/registry.js'

const HOST_NAME = 'com.pagedive.host'

function macOSManifestDir(): string {
  return join(
    homedir(),
    'Library/Application Support/Google/Chrome/NativeMessagingHosts',
  )
}

export async function install(extIds: string[]): Promise<void> {
  // host 入口：本文件编译产物的真实路径（解析 npm global symlink）
  const hostPath = resolve(import.meta.dirname, 'index.js')
  if (!existsSync(hostPath)) {
    throw new Error(`host entry not found: ${hostPath}`)
  }
  await chmod(hostPath, 0o755)

  const dir = macOSManifestDir()
  const manifestPath = join(dir, `${HOST_NAME}.json`)
  await mkdir(dir, { recursive: true })

  // origins 追加不覆盖（开发 ID 与正式 CWS ID 共存）
  let origins: string[] = []
  try {
    const prev = JSON.parse(await readFile(manifestPath, 'utf8'))
    origins = prev.allowed_origins ?? []
  } catch { /* 首次 */ }
  for (const id of extIds) {
    const origin = `chrome-extension://${id}/`
    if (!origins.includes(origin)) origins.push(origin)
  }

  const manifest = {
    name: HOST_NAME,
    description: 'PageDive native host',
    path: hostPath,
    type: 'stdio',
    allowed_origins: origins,
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  console.log(`✅ NM host manifest 已写入 ${manifestPath}`)
  if (!origins.length) {
    console.log('⚠️  尚无 allowed_origins：开发期用 pagedive install --ext-id <扩展ID>')
  }

  const agents = await probeAgents()
  console.log('本机 CLI 探测：')
  for (const a of agents) {
    console.log(a.available ? `  ✅ ${a.id} ${a.version ?? ''}` : `  ⛔ ${a.id} 未安装`)
  }
}
