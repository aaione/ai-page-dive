/** 正文临时文件：写全量 markdown，prompt 只递送路径 */
import { randomUUID } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = join(tmpdir(), 'pagedive')

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
  await mkdir(DIR, { recursive: true, mode: 0o700 })
  const p = join(DIR, `${name}-${randomUUID()}.md`)
  await writeFile(p, markdown, { mode: 0o600, flag: 'wx' })
  return p
}

export function scheduleCleanup(path: string, ms = 60_000): void {
  setTimeout(() => {
    unlink(path).catch(() => {})
  }, ms).unref()
}
