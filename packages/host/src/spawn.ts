/**
 * 进程 spawn + pgid 收割。
 * detached:true 使子进程自成进程组组长（pid === pgid），
 * process.kill(-pid) 杀整树（CLI 自己 spawn 的工具子进程同组）。
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface SpawnOpts {
  bin: string
  args: string[]
  /** prompt 经 stdin 递送，写完即 end */
  stdinData: string
  onStdoutLine: (line: string) => void
  onStderr: (chunk: string) => void
}

export interface SpawnedProc {
  child: ChildProcess
  /** CLI 工作目录（tmpdir 下的空子目录，防读到用户项目配置） */
  cwd: string
  reap: () => void
}

export function spawnCli(opts: SpawnOpts): Promise<SpawnedProc> {
  return new Promise(async (resolve) => {
    const cwd = await mkdtemp(join(tmpdir(), 'pagedive-'))
    const child = spawn(opts.bin, opts.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true, // 子进程自成组长 → 可整树收割
      cwd,
      env: { ...process.env, NO_COLOR: '1' },
    })
    child.stdin!.write(opts.stdinData)
    child.stdin!.end()

    let pending = ''
    child.stdout!.setEncoding('utf8')
    child.stdout!.on('data', (d: string) => {
      pending += d
      // 按行拆给解析器，半行留在缓冲
      for (;;) {
        const i = pending.indexOf('\n')
        if (i < 0) break
        const line = pending.slice(0, i)
        pending = pending.slice(i + 1)
        if (line.trim()) opts.onStdoutLine(line)
      }
    })
    child.stderr!.setEncoding('utf8')
    child.stderr!.on('data', opts.onStderr)

    const reap = () => {
      try {
        process.kill(-child.pid!, 'SIGTERM')
      } catch { /* already gone */ }
      setTimeout(() => {
        try { process.kill(-child.pid!, 'SIGKILL') } catch { /* gone */ }
      }, 3000)
    }

    resolve({ child, cwd, reap })
  })
}
