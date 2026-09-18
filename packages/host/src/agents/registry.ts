import { execFile } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { AgentDef } from '@ai-page-dive/shared'
import { claudeDef } from './claude.js'
import { codexDef } from './codex.js'
import { opencodeDef } from './opencode.js'

const execFileP = promisify(execFile)

export const AGENTS: AgentDef[] = [claudeDef, codexDef, opencodeDef]

/** r11：HOME 残缺（空串/缺失）时从 passwd 推导——homedir() 仅 HOME 完全缺失才走
 *  passwd、空串原样返回空（实测），故先删再取；取完还原不动全局状态 */
function userHome(): string {
  if (process.env.HOME) return process.env.HOME
  const had = 'HOME' in process.env
  delete process.env.HOME
  const h = homedir()
  if (had) process.env.HOME = ''
  return h
}

/**
 * Chrome 从 Dock 启动时 PATH 极简（/usr/bin:/bin:...），nvm/homebrew 装的 CLI
 * 全部不可见。补上 macOS 常见安装目录 + 扫描 nvm 各版本 bin + 常见自定义 Homebrew 路径；
 * 用户 shell PATH 更完整时天然是超集，不影响。
 */
export function cliPath(): string {
  const extra = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/local/sbin']
  const home = userHome() // r11：HOME 残缺时 passwd 兜底，防 CLI 全量误报 unavailable
  if (home) {
    extra.push(join(home, 'homebrew/bin'))
    extra.push(join(home, '.homebrew/bin'))
    extra.push(join(home, '.linuxbrew/bin'))
    // Node 版本管理器：npm i -g 的 CLI 落在这些 bin 下（NM 极简 PATH 看不见）
    extra.push(join(home, '.volta/bin'))
    extra.push(join(home, '.asdf/shims'))
    // claude native installer 默认路径（2026 起官方首选安装形态，免 Node——
    // 用户「明明装了 claude 却探测不到」的主因）；亦覆盖 pipx/uv 等 ~/.local 生态
    extra.push(join(home, '.local/bin'))
  }
  try {
    const nvmDir = join(home, '.nvm/versions/node')
    for (const v of readdirSync(nvmDir)) {
      extra.unshift(join(nvmDir, v, 'bin'))
    }
  } catch {
    // nvm 未安装或无版本
  }
  // fnm 版本目录结构同 nvm（…/node-versions/<ver>/installation/bin）
  for (const fnmRoot of [join(home, '.local/share/fnm/node-versions'), join(home, 'Library/Application Support/fnm/node-versions')]) {
    try {
      for (const v of readdirSync(fnmRoot)) extra.unshift(join(fnmRoot, v, 'installation/bin'))
    } catch { /* fnm 未安装 */ }
  }
  return [...extra, process.env.PATH ?? ''].join(':')
}

export function cliEnv(): Record<string, string> {
  return { ...process.env, HOME: process.env.HOME || userHome(), PATH: cliPath() } // r11：空 HOME 会让 CLI 把 ~/.claude 解析到根目录
}

export function getAgent(id: string): AgentDef | undefined {
  return AGENTS.find((a) => a.id === id)
}

async function resolveBin(def: AgentDef): Promise<string | undefined> {
  const bins = [def.bin, ...(def.fallbackBins ?? [])]
  for (const b of bins) {
    try {
      const { stdout } = await execFileP('which', [b], { env: cliEnv() })
      return stdout.trim()
    } catch {
      // try next
    }
  }
  return undefined
}

export interface ProbeResult {
  id: string
  available: boolean
  version?: string
  model?: string
}

export async function probeAgents(): Promise<ProbeResult[]> {
  return Promise.all(
    AGENTS.map(async (def) => {
      const binPath = await resolveBin(def)
      if (!binPath) return { id: def.id, available: false }
      let version: string | undefined
      try {
        const { stdout } = await execFileP(binPath, def.versionArgs, { timeout: 10_000, env: cliEnv() })
        version = stdout.trim().split('\n')[0]
      } catch {
        version = undefined
      }
      // 探测时读 CLI 本地配置的默认模型（下拉免跑任务即有三行信息）：
      // 各家路径/格式知识在 AgentDef.probeModel（r8-review：id 特判曾下沉 registry）
      return { id: def.id, available: true, version, model: def.probeModel?.() }
    }),
  )
}
