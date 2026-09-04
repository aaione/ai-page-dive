/** workflow 懒扫描 + CRUD：每次 list 重扫，用户目录 shadow 内置同名 */
import { spawn } from 'node:child_process'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { WorkflowItem } from '@ai-page-dive/shared'

const USER_DIR = join(homedir(), '.pagedive', 'workflows')
const BUILTIN_DIR = join(import.meta.dirname, '..', 'builtins')

export interface LoadedWorkflow extends WorkflowItem {
  /** 正文即 prompt（占位符 {url} {file} {title} {meta}） */
  body: string
}

/** name 校验：字母数字/下划线/连字符，1-64 位（路径穿越防线，同 history 的 assertInRoot 思路） */
export function assertValidWorkflowName(name: string): void {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) {
    throw new Error(`invalid workflow name: ${JSON.stringify(name)}`)
  }
}

/** frontmatter + 正文 → WORKFLOW.md 原文（纯函数，供 save 与测试往返用） */
export function buildWorkflowMd(input: {
  name: string
  description: string
  category?: string
  body: string
}): string {
  const lines = [
    '---',
    `name: ${input.name}`,
    `description: ${input.description.replace(/\n/g, ' ')}`,
    input.category ? `category: ${input.category.replace(/\n/g, ' ')}` : null,
    '---',
    '',
    input.body.trimEnd(),
    '',
  ]
  return lines.filter((l) => l !== null).join('\n')
}

/** 原文 → LoadedWorkflow（纯函数，export 供测试） */
export function parseWorkflow(raw: string, name: string, builtin: boolean): LoadedWorkflow | undefined {
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

/** 读 WORKFLOW.md 原文（frontmatter + 正文）：先用户目录后内置，供设置页编辑 */
export async function readWorkflow(name: string): Promise<string | undefined> {
  for (const dir of [USER_DIR, BUILTIN_DIR]) {
    const raw = await readFile(join(dir, name, 'WORKFLOW.md'), 'utf8').catch(() => undefined)
    if (raw !== undefined) return raw
  }
  return undefined
}

/** 新建/覆盖用户副本（shadow 内置同名）：mkdir -p USER_DIR/<name>/ 再写 WORKFLOW.md */
export async function saveWorkflow(input: {
  name: string
  description: string
  category?: string
  body: string
}): Promise<void> {
  assertValidWorkflowName(input.name)
  const dir = join(USER_DIR, input.name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'WORKFLOW.md'), buildWorkflowMd(input), 'utf8')
}

/** 只删用户副本（内置不可删；用户副本删除 = 恢复内置默认） */
export async function deleteWorkflow(name: string): Promise<void> {
  assertValidWorkflowName(name)
  await rm(join(USER_DIR, name), { recursive: true, force: true })
}

/**
 * Finder 打开 workflow 目录。
 * 策略：目录不存在时直接 reject（由 stdio 层回 error 帧），不静默创建副本——
 * 避免用户在设置页点「打开目录」误落一份空副本 shadow 掉已有内置。
 */
export async function revealWorkflow(name: string): Promise<void> {
  assertValidWorkflowName(name)
  const dir = join(USER_DIR, name)
  const builtinDir = join(BUILTIN_DIR, name)
  // 用户副本优先；没有则校验内置存在（保证 name 有效），开内置目录
  const target =
    (await readFile(join(dir, 'WORKFLOW.md')).then(() => true).catch(() => false)) ? dir
    : (await readFile(join(builtinDir, 'WORKFLOW.md')).then(() => true).catch(() => false)) ? builtinDir
    : undefined
  if (!target) throw new Error(`workflow not found: ${name}`)
  spawn('open', ['-R', target], { stdio: 'ignore', detached: true }).unref()
}
