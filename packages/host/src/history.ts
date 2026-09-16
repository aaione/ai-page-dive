/** 历史落盘：~/.ai-page-dive/history/年/月/日/时间戳-slug.md（frontmatter 元数据）
 * 多轮对话：同一 CLI 会话的追问轮 append 到首轮文件，pd:user/pd:assistant
 * HTML 注释分段（对 markdown 渲染不可见，解析简单且不会被正文伪造的标记骗到
 * ——正文里的标记会被转义/包进代码块；即便伪造也只是显示分层问题，无安全面） */
import { mkdir, open, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, renameSync } from 'node:fs'
import type { HistoryItem } from '@ai-page-dive/shared'
import { splitFrontmatter } from './frontmatter.js'

/** v1 目录名 → v2：一次性迁移（rename 原子，已存在则逐项并入） */
function rootDir(): string {
  const home = homedir()
  const oldDir = join(home, '.pagedive')
  const newDir = join(home, '.ai-page-dive')
  if (existsSync(oldDir) && !existsSync(newDir)) {
    try {
      renameSync(oldDir, newDir)
    } catch { /* 并发/权限失败：退回旧目录可用 */ }
  }
  return newDir
}

const ROOT = join(rootDir(), 'history')

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
  /** CLI 会话 id：历史详情页「继续对话」用（claude --resume） */
  sessionId?: string
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
  // ponytail: 引号包裹 + 反斜杠转义。r8-review：C0 控制字符（含 \r——YAML 规范
  // 当换行，引号内裸 CR 会让标准 YAML 工具解析失败）一并替空格
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\x00-\x1f]+/g, ' ')}"`
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
): Promise<string> {
  await mkdir(join(path, '..'), { recursive: true })
  // 同秒同 slug 并发任务互不覆盖：wx 排他创建，EEXIST 时追加序号重试
  for (let n = 1; n < 100; n++) {
    const p = n === 1 ? path : path.replace(/\.md$/, `-${n}.md`)
    try {
      await writeNew(p, meta, body)
      return p
    } catch (e: any) {
      if (e?.code !== 'EEXIST') throw e
    }
  }
  throw new Error('history path conflict: too many collisions')
}

async function writeNew(path: string, meta: HistoryMeta, body: string): Promise<void> {
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
    meta.sessionId ? `session_id: ${meta.sessionId}` : null,
    '---',
    '',
  ]
    .filter((l) => l !== null)
    .join('\n')
  await writeFile(path, frontmatter + body + '\n', { flag: 'wx', mode: 0o600 })
}

/** 追问轮 append 到首轮历史文件（多轮对话完整记录） */
export async function appendHistoryTurn(
  path: string,
  turn: { user: string; assistant: string },
): Promise<void> {
  assertInRoot(path)
  await writeFile(path, `\n<!-- pd:user -->\n${turn.user}\n\n<!-- pd:assistant -->\n${turn.assistant}\n`, {
    flag: 'a',
    mode: 0o600,
  })
}

/** 扫描历史目录，按 ts 倒序，query 子串过滤 title/url。
 * r8-host：年/月/日/文件名（HHMMSS 前缀）零填充天然可排序——各层倒序遍历即近似
 * 时间倒序，无 query 时凑够 limit 提前返回（旧版全量读 frontmatter 再排序截断）。
 * r8-perf：query 须全量后过滤，逐文件串行 await 数千文件时单次搜索秒级——32 并发批读 */
export async function listHistory(query?: string, limit = 100): Promise<HistoryItem[]> {
  // files 层 readdir 返回 string[]，年/月/日层返回 Dirent[]——统一按 name 倒序。
  // 各层 readdir 兜底 []：单个年/月/日目录 EACCES（共享 mac 属主/手动 chmod）不再
  // 抛出未捕获 rejection 崩溃进程，只跳过该子树、其余历史照常返回
  const desc = (a: string | { name: string }, b: string | { name: string }) =>
    (typeof b === 'string' ? b : b.name).localeCompare(typeof a === 'string' ? a : a.name)
  const paths: string[] = []
  const years = (await readdir(ROOT, { withFileTypes: true }).catch(() => [] as any[])).sort(desc)
  for (const y of years) {
    if (!y.isDirectory() || !/^\d{4}$/.test(y.name)) continue
    const months = (await readdir(join(ROOT, y.name), { withFileTypes: true }).catch(() => [] as any[])).sort(desc)
    for (const m of months) {
      if (!m.isDirectory() || !/^\d{2}$/.test(m.name)) continue
      const days = (await readdir(join(ROOT, y.name, m.name), { withFileTypes: true }).catch(() => [] as any[])).sort(desc)
      for (const d of days) {
        if (!d.isDirectory() || !/^\d{2}$/.test(d.name)) continue
        const files = (await readdir(join(ROOT, y.name, m.name, d.name)).catch(() => [] as string[])).sort(desc)
        for (const f of files) if (f.endsWith('.md')) paths.push(join(ROOT, y.name, m.name, d.name, f))
      }
    }
  }
  const readOne = async (p: string): Promise<HistoryItem | undefined> => {
    try {
      const meta = await readFrontmatter(p)
      return meta ? { path: p, ...meta } : undefined
    } catch { /* 跳过坏文件 */ }
  }
  if (query) {
    const items: HistoryItem[] = []
    for (let i = 0; i < paths.length; i += 32) {
      const batch = await Promise.all(paths.slice(i, i + 32).map(readOne))
      for (const it of batch) if (it) items.push(it)
    }
    const q = query.toLowerCase()
    return items
      .sort((a, b) => b.ts - a.ts)
      .filter((i) => i.title.toLowerCase().includes(q) || i.url.toLowerCase().includes(q))
      .slice(0, limit)
  }
  // 无过滤：倒序遍历凑够即收（近似时间倒序）；全量走完时最终按 ts 精确排序
  const items: HistoryItem[] = []
  for (const p of paths) {
    const it = await readOne(p)
    if (it) items.push(it)
    if (items.length >= limit) return items.slice(0, limit)
  }
  return items.sort((a, b) => b.ts - a.ts)
}

async function readFrontmatter(path: string): Promise<Omit<HistoryItem, 'path'> | undefined> {
  // 只读头部 4KB：frontmatter 在文件头几十字节，正文可达数百 KB——列表页无需全量读
  let raw: string
  const fh = await open(path, 'r')
  try {
    const head = Buffer.alloc(4096)
    const { bytesRead } = await fh.read(head, 0, 4096, 0)
    raw = head.subarray(0, bytesRead).toString('utf8')
  } finally {
    // r8-host：read 抛错（目录名 .md 结尾的 EISDIR 等）也必须关句柄——每次 history-list 泄一个 fd
    await fh.close().catch(() => {})
  }
  let parts = splitFrontmatter(raw)
  if (!parts) {
    // 4KB 内没闭合：超大 frontmatter 回退全量读（罕见兜底）。r8-review：以 ---
    // 开头但永不闭合的文件（损坏/恶意）会把多 GB 文件整个载入——超 256KB 视为坏文件
    const full = (await stat(path)).size > 256 * 1024 ? '' : await readFile(path, 'utf8')
    parts = full ? splitFrontmatter(full) : undefined
    if (!parts) return undefined
  }
  return await parseFm(parts.fm, path)
}

async function parseFm(fm: string, path: string): Promise<Omit<HistoryItem, 'path'>> {
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
    sessionId: get('session_id') || undefined,
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

/** 打开历史根目录（设置页「打开历史目录」：目录即备份，拖走即导出） */
export function revealHistoryRoot(): void {
  // r8-host：mkdirSync——异步 mkdir 与 spawn('open') 竞态，首次点击时 open 先于
  // 目录创建而报错（stdio 'ignore' 静默），按钮表现为无反应
  try {
    mkdirSync(ROOT, { recursive: true })
  } catch { /* open 仍尝试，双失败走 UI 错误路径 */ }
  spawn('open', [ROOT], { stdio: 'ignore', detached: true }).unref()
}
