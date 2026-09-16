/** 正文临时文件：写全量 markdown，prompt 只递送路径 */
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = join(tmpdir(), 'pagedive')

/** 目录级可信判定（r8-sec）：/tmp 1777 下固定名目录可被预置 symlink 劫持（mkdir
 * 静默跟随，文件级防御只覆盖 DIR 内文件名不覆盖 DIR 本身）——真实目录且属主为
 * 当前 uid 才用固定名，否则 mkdtemp 随机目录兜底 */
let trustedDir: string | null = null
async function ensureDir(): Promise<string> {
  if (trustedDir) return trustedDir
  const owned = (p: string) =>
    lstat(p).then((st) => st.isDirectory() && !st.isSymbolicLink() && st.uid === process.getuid?.()).catch(() => false)
  if (!(await owned(DIR))) {
    await mkdir(DIR, { recursive: true, mode: 0o700 }).catch(() => {})
    if (!(await owned(DIR))) return (trustedDir = await mkdtemp(join(tmpdir(), 'pagedive-')))
  }
  return (trustedDir = DIR)
}

/** 启动清扫（r4-sec）：host 常规退出远早于 11min unref timer——正文/附件 md 在
 * /tmp/pagedive 无限累积。首次写文件时清一遍 >1h 的旧文件（运行中文件 11min
 * 生命周期，1h 阈值不会误删）；失败静默 */
let swept = false
async function sweep(dir: string): Promise<void> {
  swept = true
  try {
    for (const f of await readdir(dir)) {
      const p = join(dir, f)
      const st = await stat(p).catch(() => null)
      if (st?.isFile() && Date.now() - st.mtimeMs > 3_600_000) unlink(p).catch(() => {})
    }
  } catch { /* 清扫失败不阻断正常路径 */ }
}

export async function writeContentFile(name: string, markdown: string): Promise<string> {
  // name（taskId 或 taskId-att-附件安全名，来自 NM 消息）进文件名：拒绝路径分隔符/
  // 空字节/超长——join() 下无分隔符即无穿越面（r3-sec m1）。白名单式校验会误杀
  // CJK 附件名（materialize 的 safe 名合法含中文与点，曾致附件静默丢弃）
  if (/[\\/\x00]/.test(name) || name.length > 128) {
    throw new Error(`invalid temp file name: ${JSON.stringify(name)}`)
  }
  // 0o700 目录 + 文件名追加 randomUUID：taskId 熵仅毫秒时间戳 + 4 位随机（36^4≈1.7M），
  // 同 uid 恶意进程可预测文件名预置 symlink，让页面正文覆盖任意用户可写文件。
  // UUID 后缀 + 排他写关死该面（wx 拒绝跟随已存在的 symlink）
  const dir = await ensureDir()
  if (!swept) await sweep(dir)
  const p = join(dir, `${name}-${randomUUID()}.md`)
  await writeFile(p, markdown, { mode: 0o600, flag: 'wx' })
  return p
}

export function scheduleCleanup(path: string, ms = 60_000): void {
  setTimeout(() => {
    unlink(path).catch(() => {})
  }, ms).unref()
}
