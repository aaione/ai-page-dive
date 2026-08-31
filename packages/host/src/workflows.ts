/** workflow 懒扫描：每次 list 重扫，用户目录 shadow 内置同名 */
import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { WorkflowItem } from '@pagedive/shared'

const USER_DIR = join(homedir(), '.pagedive', 'workflows')
const BUILTIN_DIR = join(import.meta.dirname, '..', 'builtins')

export interface LoadedWorkflow extends WorkflowItem {
  /** 正文即 prompt（占位符 {url} {file} {title} {meta}） */
  body: string
}

function parseWorkflow(raw: string, name: string, builtin: boolean): LoadedWorkflow | undefined {
  if (!raw.startsWith('---')) return undefined
  const end = raw.indexOf('\n---', 3)
  if (end < 0) return undefined
  const fm = raw.slice(4, end)
  const get = (k: string) => fm.match(new RegExp(`^${k}: (.*)$`, 'm'))?.[1]?.trim() ?? ''
  const body = raw.slice(end + 4).trim()
  if (!body) return undefined
  return {
    name,
    description: get('description') || name,
    category: get('category') || undefined,
    builtin,
    body,
  }
}

export async function listWorkflows(): Promise<LoadedWorkflow[]> {
  const out = new Map<string, LoadedWorkflow>()
  // 内置先入，用户目录后入覆盖（shadow）
  for (const [dir, builtin] of [[BUILTIN_DIR, true], [USER_DIR, false]] as const) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      if (!e.isDirectory()) continue
      try {
        const raw = await readFile(join(dir, e.name, 'WORKFLOW.md'), 'utf8')
        const wf = parseWorkflow(raw, e.name, builtin)
        if (wf) out.set(e.name, wf)
      } catch { /* 坏目录跳过 */ }
    }
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export async function getWorkflow(name: string): Promise<LoadedWorkflow | undefined> {
  // 先用户目录后内置（shadow 语义）
  for (const [dir, builtin] of [[USER_DIR, false], [BUILTIN_DIR, true]] as const) {
    try {
      const raw = await readFile(join(dir, name, 'WORKFLOW.md'), 'utf8')
      const wf = parseWorkflow(raw, name, builtin)
      if (wf) return wf
    } catch { /* next */ }
  }
  return undefined
}
