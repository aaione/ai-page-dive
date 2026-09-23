/** 历史落盘：~/.ai-page-dive/history/年/月/日/时间戳-slug.md（frontmatter 元数据）。
 * 多轮对话 append 首轮文件、pd:user/pd:assistant 注释分段；伪造标记注入由 escapePd 消（r33-sec） */
import { mkdir, open, readdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, realpathSync, renameSync } from 'node:fs'
import type { HistoryItem } from '@ai-page-dive/shared'
import { splitFrontmatter } from './frontmatter.js'

/** v1 目录名 → v2：一次性迁移（rename 原子，已存在则逐项并入） */
function rootDir(): string {
  const home = homedir()
  const oldDir = join(home, '.pagedive')
  const newDir = join(home, '.ai-page-dive')
  if (existsSync(oldDir) && !existsSync(newDir)) {
    try { renameSync(oldDir, newDir) } catch { /* 并发/权限失败 */ }
    if (!existsSync(newDir)) return oldDir // 迁移失败指回旧目录，防旧历史搁浅（r9-review：原注释宣称回退却从未实现）
  }
  return newDir
}

const ROOT = join(rootDir(), 'history')

/** 符号链接解析（不存在则退一级解析父目录 + 拼回名字；父目录也没有则原样返回）。
 *  r47-sec：assertInRoot 原先只用 resolve——resolve 不解析 symlink，
 *  history/ 下一条指向树外的链接可通过前缀校验，而 readFile/rm 会跟着链接走。 */
function realOrSelf(p: string): string {
  try { return realpathSync(p) } catch { /* 不存在：退一级 */ }
  try { return join(realpathSync(join(p, '..')), basename(p)) } catch { return p }
}

/** 路径校验：resolve 消除 .. 与同前缀绕过（history-evil/ 等），realpath 复核穿链。
 *  ROOT 自身可能是链接（用户把 ~/.ai-page-dive 挪走再链回），故两侧同口径解析 */
function assertInRoot(p: string): void {
  const root = realOrSelf(ROOT)
  const r = realOrSelf(resolve(p))
  if (r !== root && !r.startsWith(root + sep)) {
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
      .replace(/[^a-z0-9一-鿿]+/g, '-') // CJK 与控制字符直接剔除，保留字母数字连字符
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'page'
  )
}

function escapeYaml(s: string): string {
  // ponytail: 引号+反斜杠转义；C0 控制字符（含 \r，YAML 规范当换行、裸 CR 破坏引号解析）替空格（r8-review）
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
  await mkdir(join(path, '..'), { recursive: true, mode: 0o700 }) // r10：目录含标题 slug，0700 防枚举
  for (let n = 1; n < 100; n++) { // 同秒同 slug 并发任务互不覆盖：wx 排他创建，EEXIST 时追加序号重试
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
    meta.workflow ? `workflow: ${escapeYaml(meta.workflow)}` : null,
    `status: ${meta.status}`,
    `ts: ${Math.floor(Date.now() / 1000)}`,
    meta.usage ? `usage: ${JSON.stringify(meta.usage)}` : null,
    meta.durationMs != null ? `duration_ms: ${meta.durationMs}` : null,
    meta.sessionId ? `session_id: ${escapeYaml(meta.sessionId)}` : null,
    '---',
    '',
  ]
    .filter((l) => l !== null)
    .join('\n')
  await writeFile(path, frontmatter + body + '\n', { flag: 'wx', mode: 0o600 })
}

/** 轮正文分段标记转义（r33-sec）：正文含标记原样落盘会被 parseHistoryTurns 误切成轮边界——实体化冒号，渲染不变，读侧还原 */
export const escapePd = (s: string): string => s.replaceAll('<!-- pd:', '<!-- pd&#58;')

/** 追问轮 append 到首轮历史文件（多轮对话完整记录） */
export async function appendHistoryTurn(
  path: string,
  turn: { user: string; assistant: string },
): Promise<void> {
  assertInRoot(path)
  await writeFile(path, `\n<!-- pd:user -->\n${escapePd(turn.user)}\n\n<!-- pd:assistant -->\n${escapePd(turn.assistant)}\n`, {
    flag: 'a',
    mode: 0o600,
  })
}

/** 正文命中片段：命中点前后各 ~40 字符、空白压扁；未命中 undefined。r17：搜索从 title/url 扩全文（「之前总结过讲 X 的那篇」常只记得内容词） */
export function extractSnippet(body: string, q: string): string | undefined {
  const idx = body.toLowerCase().indexOf(q.toLowerCase())
  if (idx < 0) return undefined
  return body.slice(Math.max(0, idx - 40), idx + q.length + 40).replace(/\s+/g, ' ').trim()
}

/** 扫描历史目录，按 ts 倒序，query 匹配 title/url/正文（r8-perf：32 并发批读）。
 * 年/月/日/文件名零填充天然可排序——倒序遍历即近似时间倒序；readdir 兜底 []：单目录 EACCES 只跳过不崩 */
export async function listHistory(query?: string, limit = 200): Promise<HistoryItem[]> {
  const desc = (a: string | { name: string }, b: string | { name: string }) =>
    (typeof b === 'string' ? b : b.name).localeCompare(typeof a === 'string' ? a : a.name)
  const paths: string[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    const entries = (await readdir(dir, { withFileTypes: true }).catch(() => [] as any[])).sort(desc)
    for (const e of entries) {
      if (depth === 3) { if (e.isFile() && e.name.endsWith('.md')) paths.push(join(dir, e.name)) }
      else if (e.isDirectory() && (depth === 0 ? /^\d{4}$/ : /^\d{2}$/).test(e.name)) await walk(join(dir, e.name), depth + 1)
    }
  }
  await walk(ROOT, 0)
  // r17：query 时 title/url 命中免读全文，未命中才全量读正文搜 snippet（巨文件
  // >2MB 跳过——正文扫描 IO 上界）；坏文件一律跳过
  const readOne = async (p: string, q?: string): Promise<HistoryItem | undefined> => {
    try {
      const meta = await readFrontmatter(p)
      if (!meta) return undefined
      if (q) {
        if (meta.title.toLowerCase().includes(q) || meta.url.toLowerCase().includes(q)) return { path: p, ...meta }
        if ((await stat(p)).size > 2 * 1024 * 1024) return undefined
        const raw = await readFile(p, 'utf8')
        const snippet = extractSnippet(splitFrontmatter(raw)?.body ?? raw, q) // 剥 frontmatter：元数据字段（url/ts）不进搜索域
        if (!snippet) return undefined
        return { path: p, ...meta, snippet }
      }
      return { path: p, ...meta }
    } catch { /* 跳过坏文件 */ }
  }
  if (query) {
    const items: HistoryItem[] = []
    for (let i = 0; i < paths.length; i += 32) {
      const batch = await Promise.all(paths.slice(i, i + 32).map((p) => readOne(p, query.toLowerCase())))
      for (const it of batch) if (it) items.push(it)
    }
    return items.sort((a, b) => b.ts - a.ts).slice(0, limit)
  }
  const items: HistoryItem[] = [] // 无过滤：倒序遍历凑够即收（近似时间倒序）；全量走完时最终按 ts 精确排序
  for (const p of paths) {
    const it = await readOne(p)
    if (it) items.push(it)
    if (items.length >= limit) return items.slice(0, limit)
  }
  return items.sort((a, b) => b.ts - a.ts)
}

/** r42：历史保留策略——删除超出 limit 的最旧文件（保存新历史后调用）。按路径序
 * 排（年/月/日/时间戳零填充天然可排序），不读 frontmatter（快）；返回删除数。
 * ponytail: 空出的 年/月/日 目录留着不删——无害且省一次递归；root 可注入供测试 */
export async function pruneHistory(limit: number, root: string = ROOT): Promise<number> {
  if (!(limit >= 10)) return 0
  const paths: string[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    const entries = (await readdir(dir, { withFileTypes: true }).catch(() => [] as any[]))
    for (const e of entries) {
      if (depth === 3) { if (e.isFile() && e.name.endsWith('.md')) paths.push(join(dir, e.name)) }
      else if (e.isDirectory() && (depth === 0 ? /^\d{4}$/ : /^\d{2}$/).test(e.name)) await walk(join(dir, e.name), depth + 1)
    }
  }
  await walk(root, 0)
  paths.sort() // 升序 = 最旧在前
  let removed = 0
  for (const p of paths.slice(0, Math.max(0, paths.length - limit))) {
    try { await unlink(p); removed++ } catch { /* 并发写入等：跳过，下次保存再清 */ }
  }
  return removed
}

async function readFrontmatter(path: string): Promise<Omit<HistoryItem, 'path'> | undefined> {
  let raw: string // 只读头部 4KB：frontmatter 在文件头几十字节，正文可达数百 KB——列表页无需全量读
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
  // r8-host：mkdirSync——异步 mkdir 与 spawn('open') 竞态，首次点击 open 先于建目录而报错（表现为按钮无反应）
  try {
    mkdirSync(ROOT, { recursive: true })
  } catch { /* open 仍尝试，双失败走 UI 错误路径 */ }
  spawn('open', [ROOT], { stdio: 'ignore', detached: true }).unref()
}
