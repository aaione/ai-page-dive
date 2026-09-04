/** skills 懒扫描：~/.ai-page-dive/skills/<name>/SKILL.md（目录即插件，与 workflows 同构） */
import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import type { SkillItem } from '@ai-page-dive/shared'

const DIR = join(homedir(), '.ai-page-dive', 'skills')
// 当前无内置技能目录；留位：后续内置目录放入数组即自动并入扫描（false 标记用户侧）
const BUILTIN_SKILL_DIRS: string[] = []

/** SKILL.md 原文 → {description, body}（纯函数，export 供测试；description 缺省用目录名） */
export function parseSkillMd(raw: string, fallbackName: string): { description: string; body: string } {
  if (!raw.startsWith('---')) return { description: fallbackName, body: raw.trim() }
  const end = raw.indexOf('\n---', 3)
  if (end < 0) return { description: fallbackName, body: raw.trim() }
  const fm = raw.slice(4, end)
  const description = fm.match(/^description: (.*)$/m)?.[1]?.trim() || fallbackName
  return { description, body: raw.slice(end + 4).trim() }
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

/** 读取启用技能的正文（供 prompt 注入）；读取失败的静默跳过 */
export async function getSkillBodies(names: string[]): Promise<{ name: string; body: string }[]> {
  const out: { name: string; body: string }[] = []
  for (const name of names) {
    // name 即目录名：不允许路径穿越（/、.. 等在目录名语义下天然不存在）
    const raw = await readFile(join(DIR, name, 'SKILL.md'), 'utf8').catch(() => undefined)
    if (raw === undefined) continue
    const body = parseSkillMd(raw, name).body
    if (body) out.push({ name, body })
  }
  return out
}

/** Finder 打开：name 缺省/不存在时开 DIR 本身（首次使用顺手建目录） */
export async function revealSkill(name?: string): Promise<void> {
  let target = DIR
  if (name) {
    const raw = await readFile(join(DIR, name, 'SKILL.md'), 'utf8').catch(() => undefined)
    if (raw !== undefined) target = join(DIR, name)
  }
  // -R 是「在 Finder 中选中」；直接开目录本身则不用 -R
  const args = target === DIR ? [target] : ['-R', target]
  spawn('open', args, { stdio: 'ignore', detached: true }).unref()
}
