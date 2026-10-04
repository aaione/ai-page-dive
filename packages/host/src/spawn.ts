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

/** SIGKILL 兜底宽限。与 stdio.ts 的收割窗口构成隐式时序耦合（窗口必须 > 本值 200ms），导出单一来源防手改一处静默破坏另一处 */
export const REAP_GRACE_MS = 3000

export interface SpawnOpts {
  bin: string
  args: string[]
  /** prompt 经 stdin 递送，写完即 end */
  stdinData: string
  onStdoutLine: (line: string) => void
  onStderr: (chunk: string) => void
  /** spawn 失败（ENOENT 等）—— 'error' 事件，exit 不会触发 */
  onSpawnError?: (err: Error) => void
}

export interface SpawnedProc {
  child: ChildProcess
  /** CLI 工作目录（恒固定工作区 stableCwd——claude 会话按 cwd 分区存储） */
  cwd: string
  reap: () => void
}

export function spawnCli(opts: SpawnOpts & { cwd?: string }): Promise<SpawnedProc> {
  return new Promise((resolve, reject) => {
    void (async () => {
      // cwd 缺省：一次性 tmp 子目录（测试/独立调用防读到用户项目配置；生产路径恒传固定工作区）
      const cwd = opts.cwd ?? await mkdtemp(join(tmpdir(), 'pagedive-'))
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
      // stdin 异步 EPIPE（r5-impl：大 prompt 塞管道 + CLI 快速退出——未登录/resume 失效会话）：写 stdin 的同步 try/catch 捕不到异步 error 事件，
      // 无监听则 uncaughtException 崩掉整个 host（连带杀死同 host 在途任务）。空监听吞掉——CLI 死亡由 exit 路径收割
      child.stdin!.on('error', () => {})
      // r8-host：删除 deferStdin/writeStdin 死代码（无调用方；opencode 的 cwd 需求已由 makeAgentCwd + cwd 选项解决），spawn 后直接写 prompt
      try {
        child.stdin!.write(opts.stdinData)
        child.stdin!.end()
      } catch { /* child 已死，error 事件已处理 */ }

      let pending = ''
      child.stdout!.setEncoding('utf8')
      child.stdout!.on('data', (d: string) => {
        pending += d
        // r8-host：病态单行超长输出上界——JSON 行正常 <1MB（claude result 行含全文
        // 亦只数百 KB），超 8MB 判 CLI 已疯，丢缓冲防 host 峰值内存被拉爆
        if (pending.length > 8 * 1024 * 1024) {
          console.error('[ai-page-dive] stdout single line >8MB, dropping buffer')
          pending = ''
        }
        // 按行拆给解析器，半行留在缓冲
        for (;;) {
          const i = pending.indexOf('\n')
          if (i < 0) break
          const line = pending.slice(0, i)
          pending = pending.slice(i + 1)
          if (line.trim()) opts.onStdoutLine(line)
        }
        // NM 出口背压：出口积压 >4MB 说明对端消费不动，停读 CLI stdout 让内核管道
        // 顶住上游，drain 排空即恢复——否则 write 缓冲在 host 内存无界涨（r47 C8）
        const nmOut = process.stdout
        if (!child.stdout!.isPaused() && nmOut.writableLength > 4 * 1024 * 1024) {
          child.stdout!.pause()
          nmOut.once('drain', () => child.stdout!.resume())
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
        // child 已退出后 pid 可能被 OS 复用——组杀会误杀复用者恰为组长的无关进程
        if (child.exitCode !== null || child.signalCode !== null) return
        const pgid = child.pid!
        try {
          process.kill(-pgid, 'SIGTERM')
        } catch { /* already gone */ }
        // r58（N2）：SIGKILL 兜底不得被「组长已退」短路——组长死于 TERM 而抗信号
        // 孙进程尚存时孙进程永久逃逸。3s 窗内 pgid 复用需 pid 绕回，不可达；ESRCH 被吞
        setTimeout(() => {
          try { process.kill(-pgid, 'SIGKILL') } catch { /* gone */ }
        }, REAP_GRACE_MS)
      }

      resolve({ child, cwd, reap })
    })().catch(reject)
  })
}
