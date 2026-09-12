/** skills 懒扫描：~/.ai-page-dive/skills/<name>/SKILL.md（目录即插件，与 workflows 同构）
 * 内置技能在 builtins-skills/（随 npm 包分发，默认关），用户目录 shadow 同名 */
import { mkdir, readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import type { SkillItem } from '@ai-page-dive/shared'
import { assertValidWorkflowName } from './workflows.js'
import { splitFrontmatter } from './frontmatter.js'

const DIR = join(homedir(), '.ai-page-dive', 'skills')
// fileURLToPath 而非 import.meta.dirname：后者 Node >=20.11 才有，engines 宣称 >=18
const BUILTIN_SKILL_DIRS = [join(dirname(fileURLToPath(import.meta.url)), '..', 'builtins-skills')]

/** SKILL.md 原文 → {description, body}（纯函数，export 供测试；description 缺省用目录名） */
export function parseSkillMd(raw: string, fallbackName: string): { description: string; body: string } {
  const parts = splitFrontmatter(raw)
  if (!parts) return { description: fallbackName, body: raw.trim() }
  const description = parts.fm.match(/^description: (.*)$/m)?.[1]?.trim() || fallbackName
  return { description, body: parts.body }
}

export async function listSkills(): Promise<SkillItem[]> {
  const out = new Map<string, SkillItem>()
  // 用户目录为主；内置目录留位（builtin 标记）
  for (const [dir, builtin] of [...BUILTIN_SKILL_DIRS.map((d) => [d, true] as const), [DIR, false] as const]) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      if (!e.isDirectory()) continue
      try {
        const raw = await readFile(join(dir, e.name, 'SKILL.md'), 'utf8')
        out.set(e.name, { name: e.name, description: parseSkillMd(raw, e.name).description, builtin })
      } catch { /* 坏目录跳过 */ }
    }
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** 读取启用技能的正文（供 prompt 注入）；读取失败的静默跳过。
 * 用户目录优先（shadow），未命中再查内置目录 */
export async function getSkillBodies(names: string[]): Promise<{ name: string; body: string }[]> {
  const out: { name: string; body: string }[] = []
  for (const name of names) {
    // name 来自 NM 消息，与 workflows 同一信任边界：白名单校验拒绝 ../ 穿越
    try {
      assertValidWorkflowName(name)
    } catch { continue }
    let raw = await readFile(join(DIR, name, 'SKILL.md'), 'utf8').catch(() => undefined)
    if (raw === undefined) {
      for (const d of BUILTIN_SKILL_DIRS) {
        raw = await readFile(join(d, name, 'SKILL.md'), 'utf8').catch(() => undefined)
        if (raw !== undefined) break
      }
    }
    if (raw === undefined) continue
    const body = parseSkillMd(raw, name).body
    if (body) out.push({ name, body })
  }
  return out
}

/** Finder 打开：name 缺省/不存在时开 DIR 本身（首次使用顺手建目录） */
export async function revealSkill(name?: string): Promise<void> {
  // 先建根目录：DIR 不存在时 `open` 静默失败（症状＝「打开目录」按钮无反应）
  await mkdir(DIR, { recursive: true })
  let target = DIR
  if (name) {
    assertValidWorkflowName(name)
    const raw = await readFile(join(DIR, name, 'SKILL.md'), 'utf8').catch(() => undefined)
    if (raw !== undefined) target = join(DIR, name)
  }
  // -R 是「在 Finder 中选中」；直接开目录本身则不用 -R
  const args = target === DIR ? [target] : ['-R', target]
  spawn('open', args, { stdio: 'ignore', detached: true }).unref()
}
