/** skills 懒扫描：~/.ai-page-dive/skills/<name>/SKILL.md；内置在 builtins-skills/（默认关），用户目录 shadow 同名 */
import { constants } from 'node:fs'
import { copyFile, mkdir, readdir, readFile } from 'node:fs/promises'
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
      const raw = await readFile(join(dir, e.name, 'SKILL.md'), 'utf8').catch(() => undefined) // 坏目录跳过
      if (raw !== undefined) out.set(e.name, { name: e.name, description: parseSkillMd(raw, e.name).description, builtin })
    }
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** 按名找技能目录：用户目录优先（shadow 同名覆盖），未命中查内置（r34 抽出共用） */
async function findSkillDir(name: string): Promise<string | undefined> {
  for (const d of [DIR, ...BUILTIN_SKILL_DIRS]) {
    if (await readFile(join(d, name, 'SKILL.md'), 'utf8').catch(() => undefined) !== undefined) return d
  }
  return undefined
}

/** 读取启用技能的正文（供 prompt 注入）；读取失败的静默跳过 */
export async function getSkillBodies(names: string[]): Promise<{ name: string; body: string }[]> {
  const out: { name: string; body: string }[] = []
  for (const name of names) {
    // name 来自 NM 消息，与 workflows 同一信任边界：白名单校验拒绝 ../ 穿越
    try { assertValidWorkflowName(name) } catch { continue }
    const dir = await findSkillDir(name)
    if (!dir) continue
    const body = parseSkillMd(await readFile(join(dir, name, 'SKILL.md'), 'utf8'), name).body
    if (body) out.push({ name, body })
  }
  return out
}

/** Finder 打开：name 缺省/未命中开 DIR；命中开技能目录（含内置——r34：内置技能
 * 原先落空退回空 DIR，「打开目录没有任何文件」即此） */
export async function revealSkill(name?: string): Promise<void> {
  // 先建根目录：DIR 不存在时 `open` 静默失败；同时从内置拷一份格式说明（wx 幂等，
  // 用户改过即不覆盖）——空目录首次打开不再是「没有任何文件」
  await mkdir(DIR, { recursive: true, mode: 0o700 })
  await copyFile(join(BUILTIN_SKILL_DIRS[0], 'README.md'), join(DIR, 'README.md'), constants.COPYFILE_EXCL).catch(() => {})
  let target = DIR
  if (name) {
    assertValidWorkflowName(name)
    const dir = await findSkillDir(name)
    if (dir) target = join(dir, name)
  }
  // -R 是「在 Finder 中选中」；直接开目录本身则不用 -R
  const args = target === DIR ? [target] : ['-R', target]
  spawn('open', args, { stdio: 'ignore', detached: true }).unref()
}
