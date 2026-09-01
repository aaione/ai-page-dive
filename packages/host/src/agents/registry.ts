import { execFile } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { AgentDef } from '@pagedive/shared'
import { claudeDef } from './claude.js'
import { codexDef } from './codex.js'

const execFileP = promisify(execFile)

export const AGENTS: AgentDef[] = [claudeDef, codexDef]

/**
 * Chrome 从 Dock 启动时 PATH 极简（/usr/bin:/bin:...），nvm/homebrew 装的 CLI
 * 全部不可见。补上 macOS 常见安装目录 + 扫描 nvm 各版本 bin；
 * 用户 shell PATH 更完整时天然是超集，不影响。
 */
export function cliPath(): string {
  const extra = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/local/sbin']
  try {
    const nvmDir = join(process.env.HOME ?? '', '.nvm/versions/node')
    for (const v of readdirSync(nvmDir)) {
      extra.unshift(join(nvmDir, v, 'bin'))
    }
  } catch {
    // nvm 未安装或无版本
  }
  return [...extra, process.env.PATH ?? ''].join(':')
}

export function cliEnv(): Record<string, string> {
  return { ...process.env, PATH: cliPath() }
}

export function getAgent(id: string): AgentDef | undefined {
  return AGENTS.find((a) => a.id === id)
}

async function resolveBin(def: AgentDef): Promise<string | undefined> {
  const bins = [def.bin, ...(def.fallbackBins ?? [])]
  for (const b of bins) {
    try {
      await execFileP('which', [b], { env: cliEnv() })
      return b
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
}

export async function probeAgents(): Promise<ProbeResult[]> {
  return Promise.all(
    AGENTS.map(async (def) => {
      const bin = await resolveBin(def)
      if (!bin) return { id: def.id, available: false }
      let version: string | undefined
      try {
        const { stdout } = await execFileP(bin, def.versionArgs, { timeout: 10_000, env: cliEnv() })
        version = stdout.trim().split('\n')[0]
      } catch {
        version = undefined
      }
      return { id: def.id, available: true, version }
    }),
  )
}
