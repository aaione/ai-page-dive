/**
 * 进程 spawn + pgid 收割。
 * detached:true 使子进程自成进程组组长（pid === pgid），
 * process.kill(-pid) 杀整树（CLI 自己 spawn 的工具子进程同组）。
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { cliEnv } from './agents/registry.js'

export interface SpawnOpts {
  bin: string
  args: string[]
  /** prompt 经 stdin 递送，写完即 end；deferStdin 时由上层稍后调用 writeStdin */
  stdinData: string
  /** true: spawn 时不写 stdin（上层拿到 cwd 后再写，opencode 用） */
  deferStdin?: boolean
  onStdoutLine: (line: string) => void
  onStderr: (chunk: string) => void
  /** spawn 失败（ENOENT 等）—— 'error' 事件，exit 不会触发 */
  onSpawnError?: (err: Error) => void
}

export interface SpawnedProc {
  child: ChildProcess
  /** CLI 工作目录（tmpdir 下的空子目录，防读到用户项目配置） */
  cwd: string
  /** deferStdin 模式下写 prompt 并结束 stdin */
  writeStdin: (data: string) => void
  reap: () => void
}

/** 预建 CLI 工作目录（buildArgs 需要 cwd 时——opencode --dir），spawn 前调用 */
export async function makeAgentCwd(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'pagedive-'))
}

export function spawnCli(opts: SpawnOpts & { cwd?: string }): Promise<SpawnedProc> {
  return new Promise((resolve, reject) => {
    void (async () => {
      const cwd = opts.cwd ?? await makeAgentCwd()
      const child = spawn(opts.bin, opts.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true, // 子进程自成组长 → 可整树收割
        cwd,
        env: { ...cliEnv(), NO_COLOR: '1' },
      })

      // ENOENT 等只走 'error' 事件，exit 不触发——必须监听，否则上层永久挂起
      child.on('error', (err) => {
        opts.onSpawnError?.(err)
        reject(err)
      })

      const writeStdin = (data: string) => {
        try {
          child.stdin!.write(data)
          child.stdin!.end()
        } catch { /* child 已死，error 事件已处理 */ }
      }
      if (!opts.deferStdin) writeStdin(opts.stdinData)

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
      // 末行无换行符也要派发（CLI 非正常结尾时不丢最后一行事件）
      child.stdout!.on('end', () => {
        if (pending.trim()) {
          opts.onStdoutLine(pending)
          pending = ''
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

      resolve({ child, cwd, writeStdin, reap })
    })().catch(reject)
  })
}
