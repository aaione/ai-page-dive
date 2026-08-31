import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AgentDef } from '@pagedive/shared'
import { claudeDef } from './claude.js'
import { codexDef } from './codex.js'

const execFileP = promisify(execFile)

export const AGENTS: AgentDef[] = [claudeDef, codexDef]

export function getAgent(id: string): AgentDef | undefined {
  return AGENTS.find((a) => a.id === id)
}

async function resolveBin(def: AgentDef): Promise<string | undefined> {
  const bins = [def.bin, ...(def.fallbackBins ?? [])]
  for (const b of bins) {
    try {
      await execFileP('which', [b])
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
        const { stdout } = await execFileP(bin, def.versionArgs, { timeout: 10_000 })
        version = stdout.trim().split('\n')[0]
      } catch {
        version = undefined
      }
      return { id: def.id, available: true, version }
    }),
  )
}
