/** 历史落盘：~/.pagedive/history/年/月/日/时间戳-slug.md（frontmatter 元数据） */
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'
import type { HistoryItem } from '@pagedive/shared'

const ROOT = join(homedir(), '.pagedive', 'history')

/** 路径校验：resolve 消除 .. 与同前缀绕过（history-evil/ 等） */
function assertInRoot(p: string): void {
  const r = resolve(p)
  if (r !== ROOT && !r.startsWith(ROOT + sep)) {
    throw new Error('path outside history root')
  }
}

export interface HistoryMeta {
  title: string
  url: string
  agent: string
  workflow?: string
  status: 'done' | 'interrupted' | 'error'
  usage?: { inputTokens?: number; outputTokens?: number }
  durationMs?: number
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      // CJK 与控制字符直接剔除，保留字母数字连字符
      .replace(/[^a-z0-9一-鿿]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'page'
  )
}

function escapeYaml(s: string): string {
  // ponytail: 引号包裹 + 反斜杠转义，够覆盖标题里的引号/换行
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`
}

/** test 用：暴露转义行为 */
export const escapeYamlForTest = escapeYaml

export function buildHistoryPath(ts: Date, title: string): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}`
  return join(
    ROOT,
    String(ts.getFullYear()),
    pad(ts.getMonth() + 1),
    pad(ts.getDate()),
    `${stamp}-${slugify(title)}.md`,
  )
}

export async function saveHistory(
  path: string,
  meta: HistoryMeta,
  body: string,
): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  const frontmatter = [
    '---',
    `title: ${escapeYaml(meta.title)}`,
    `url: ${escapeYaml(meta.url)}`,
    `agent: ${meta.agent}`,
    meta.workflow ? `workflow: ${meta.workflow}` : null,
    `status: ${meta.status}`,
    `ts: ${Math.floor(Date.now() / 1000)}`,
    meta.usage ? `usage: ${JSON.stringify(meta.usage)}` : null,
    meta.durationMs != null ? `duration_ms: ${meta.durationMs}` : null,
    '---',
    '',
  ]
    .filter((l) => l !== null)
    .join('\n')
  await writeFile(path, frontmatter + body + '\n', { mode: 0o600 })
}

/** 扫描历史目录，按 ts 倒序，query 子串过滤 title/url */
export async function listHistory(query?: string, limit = 100): Promise<HistoryItem[]> {
  const items: HistoryItem[] = []
  const years = await readdir(ROOT, { withFileTypes: true }).catch(() => [])
  for (const y of years) {
    if (!y.isDirectory() || !/^\d{4}$/.test(y.name)) continue
    const months = await readdir(join(ROOT, y.name), { withFileTypes: true })
    for (const m of months) {
      if (!m.isDirectory() || !/^\d{2}$/.test(m.name)) continue
      const days = await readdir(join(ROOT, y.name, m.name), { withFileTypes: true })
      for (const d of days) {
        if (!d.isDirectory() || !/^\d{2}$/.test(d.name)) continue
        const files = await readdir(join(ROOT, y.name, m.name, d.name))
        for (const f of files) {
          if (!f.endsWith('.md')) continue
          const full = join(ROOT, y.name, m.name, d.name, f)
          try {
            const meta = await readFrontmatter(full)
            if (meta) items.push({ path: full, ...meta })
          } catch { /* 跳过坏文件 */ }
        }
      }
    }
  }
  let out = items.sort((a, b) => b.ts - a.ts)
  if (query) {
    const q = query.toLowerCase()
    out = out.filter(
      (i) => i.title.toLowerCase().includes(q) || i.url.toLowerCase().includes(q),
    )
  }
  return out.slice(0, limit)
}

async function readFrontmatter(path: string): Promise<Omit<HistoryItem, 'path'> | undefined> {
  const raw = await readFile(path, 'utf8')
  if (!raw.startsWith('---')) return undefined
  const end = raw.indexOf('\n---', 3)
  if (end < 0) return undefined
  const fm = raw.slice(4, end)
  const get = (key: string): string => {
    const m = fm.match(new RegExp(`^${key}: (.*)$`, 'm'))
    if (!m) return ''
    let v = m[1].trim()
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    return v
  }
  return {
    title: get('title') || 'untitled',
    url: get('url'),
    agent: get('agent') || '?',
    ts: Number(get('ts')) * 1000 || (await stat(path)).mtimeMs,
  }
}

export async function readHistory(path: string): Promise<string> {
  assertInRoot(path)
  return readFile(path, 'utf8')
}

export async function deleteHistory(path: string): Promise<void> {
  assertInRoot(path)
  await rm(path)
}

export function revealInFinder(path: string): void {
  assertInRoot(path)
  spawn('open', ['-R', path], { stdio: 'ignore', detached: true }).unref()
}
