/** 正文临时文件：写全量 markdown，prompt 只递送路径 */
import { randomUUID } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = join(tmpdir(), 'pagedive')

export async function writeContentFile(name: string, markdown: string): Promise<string> {
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
