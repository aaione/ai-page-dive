/** workflow 懒扫描 + CRUD：每次 list 重扫，用户目录 shadow 内置同名 */
import { spawn } from 'node:child_process'
import { access, chmod, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { WorkflowItem } from '@ai-page-dive/shared'
import { splitFrontmatter } from './frontmatter.js'

const USER_DIR = join(homedir(), '.ai-page-dive', 'workflows')
// fileURLToPath 而非 import.meta.dirname：后者 Node >=20.11 才有，engines 宣称 >=18
const BUILTIN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'builtins')

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
  const parts = splitFrontmatter(raw)
  if (!parts || !parts.body) return undefined
  const get = (k: string) => parts.fm.match(new RegExp(`^${k}: (.*)$`, 'm'))?.[1]?.trim() ?? ''
  return {
    name,
    description: get('description') || name,
    category: get('category') || undefined,
    builtin,
    body: parts.body,
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
        // r50：目录名防线（同 skills 列表）——非法名（如中文目录）进了下拉后，点选
        // 被 getWorkflow 的同名校验拒读，静默落回默认深度总结（用户以为在跑自定义档）
        assertValidWorkflowName(e.name)
        const raw = await readFile(join(dir, e.name, 'WORKFLOW.md'), 'utf8')
        const wf = parseWorkflow(raw, e.name, builtin)
        if (wf) out.set(e.name, wf)
      } catch { /* 坏目录跳过 */ }
    }
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export async function getWorkflow(name: string): Promise<LoadedWorkflow | undefined> {
  // 先用户目录后内置（shadow 语义）；name 来自 NM 消息，读路径同样校验（写/删已有防线）
  try {
    assertValidWorkflowName(name)
  } catch { return undefined }
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
  try {
    assertValidWorkflowName(name)
  } catch { return undefined }
  for (const dir of [USER_DIR, BUILTIN_DIR]) {
    const raw = await readFile(join(dir, name, 'WORKFLOW.md'), 'utf8').catch(() => undefined)
    if (raw !== undefined) return raw
  }
  return undefined
}

/** 新建/覆盖用户副本（shadow 内置同名）：mkdir -p USER_DIR/<name>/ 再写 WORKFLOW.md。
 * 带 originalName = 改名保存：撞其他用户模式名时拒绝（静默覆盖 = 原创内容不可恢复
 * 丢失，F7）；成功后删旧目录防孤儿。撞内置名不拒（shadow 是设计特性） */
export async function saveWorkflow(input: {
  name: string
  description: string
  category?: string
  body: string
  originalName?: string
}): Promise<void> {
  assertValidWorkflowName(input.name)
  if (input.originalName) assertValidWorkflowName(input.originalName)
  const dir = join(USER_DIR, input.name)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  // r58（#9）：recursive mkdir 对已存在目录 mode 是 no-op——存量装机 0755 靠 chmod 收敛（同 agent-workspace 谱系）
  await chmod(dir, 0o700).catch(() => {})
  const final = join(dir, 'WORKFLOW.md')
  // r58（#33）：副本不存在（已删/内置首存）走 wx 撞名守卫——rename 无条件覆盖会绕过 r54 #8
  // 并发守卫；存在则覆盖自己见过的副本（并发编辑后存者胜为编辑器通例，版本凭据 v2+）
  if (input.originalName !== input.name || (await access(final).then(() => false, () => true))) {
    try {
      await writeFile(final, buildWorkflowMd(input), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    } catch (e: any) {
      if (e?.code === 'EEXIST') throw new Error(`已存在同名用户模式「${input.name}」，未保存——请换一个名称`)
      throw e
    }
  } else {
    // 原地覆盖自己：tmp + rename 原子替换——读侧（设置页/下一轮 list）永不停在半截文件
    const tmp = join(dir, `WORKFLOW.md.${process.pid}.tmp`)
    await writeFile(tmp, buildWorkflowMd(input), { encoding: 'utf8', mode: 0o600 })
    await rename(tmp, final)
  }
  // 删旧目录在写新成功之后（r3-sec m2）：非原子操作里可重建的先做、不可恢复的（删原创）最后做
  if (input.originalName && input.originalName !== input.name) {
    await rm(join(USER_DIR, input.originalName), { recursive: true, force: true })
  }
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
  const target = // 用户副本优先；没有则校验内置存在（保证 name 有效），开内置目录
    (await readFile(join(dir, 'WORKFLOW.md')).then(() => true).catch(() => false)) ? dir
    : (await readFile(join(builtinDir, 'WORKFLOW.md')).then(() => true).catch(() => false)) ? builtinDir
    : undefined
  if (!target) throw new Error(`workflow not found: ${name}`)
  spawn('open', ['-R', target], { stdio: 'ignore', detached: true }).unref()
}
