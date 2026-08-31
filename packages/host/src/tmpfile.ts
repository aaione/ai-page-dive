/** 正文临时文件：写全量 markdown，prompt 只递送路径 */
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = join(tmpdir(), 'pagedive')

export async function writeContentFile(taskId: string, markdown: string): Promise<string> {
  await mkdir(DIR, { recursive: true })
  const p = join(DIR, `${taskId}.md`)
  await writeFile(p, markdown, { mode: 0o600 })
  return p
}

export function scheduleCleanup(path: string, ms = 60_000): void {
  setTimeout(() => {
    unlink(path).catch(() => {})
  }, ms).unref()
}
