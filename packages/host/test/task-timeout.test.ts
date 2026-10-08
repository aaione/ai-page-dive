// r47-audit M4 回归：result 已交付但进程未退出时超时，终局必须是 done 而非 timeout。
// TASK_TIMEOUT_MS 是 task.ts 模块常量（读 env 兜底 600_000），必须在 import 前设好——
// vitest 按文件隔离模块图，独立文件内先设 env 再动态 import 即拿到短超时版本，不污染 task.test.ts
// r63（审计驳回保留项）：超时裕量 1500→5000——200ms 吐 result 对 1500ms 超时的
// margin 仅 1300ms，负载下可倒挂成 timeout 终局假红；孙进程持写端 8s 保持 > 超时。
process.env.PAGEDIVE_TASK_TIMEOUT_MS = '5000'

import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PAGE = { url: 'https://a.com/x', title: 'T', extractor: 'test', approxTokens: 10 }
const BODY = '# 正文\n\n内容'

describe('Task 超时终局（r47-audit M4）', () => {
  it('result 已交付但孙进程持 stdout 未退：超时终局是 done 不是 timeout/interrupted', async () => {
    const { Task } = await import('../src/task.js')
    const { AGENTS } = await import('../src/agents/registry.js')
    // 复用 r33 孙进程持写端机制（test/task.test.ts 同款）：孙进程 200ms 吐 result 后
    // 持 stdout 写端到 8s——5000ms 超时到点时 gotResultOk 已置位但 close 未触发。
    // 旧实现：onError('timeout') + persist('interrupted')——用户看到失败但结果已完整交付。
    // （r58 #1 后 reap 探组存活——组长已退也收割持组孙进程，close 及时到达，无需等自然退出）
    const dir = await mkdtemp(join(tmpdir(), 'pd-m4-'))
    const script = join(dir, 'cli.mjs')
    await writeFile(
      script,
      `import { spawn } from 'node:child_process'
spawn(process.execPath, ['-e', "setTimeout(()=>{console.log(JSON.stringify({type:'assistant',message:{content:[{type:'text',text:'完整回答'}]}}));console.log(JSON.stringify({type:'result',is_error:false,result:'完成',usage:{input_tokens:1,output_tokens:2}}));setTimeout(()=>{},8000)},200)"], { stdio: ['ignore','inherit','ignore'] })
process.exit(0)`,
      'utf8',
    )
    AGENTS[0].bin = 'node'
    const orig = AGENTS[0].buildArgs
    AGENTS[0].buildArgs = () => [script]
    const fakeHome = await mkdtemp(join(tmpdir(), 'pd-home-'))
    const origHome = process.env.HOME
    process.env.HOME = fakeHome
    const cbs = {
      status: [] as string[], meta: null as any, chunks: [] as [string, number][],
      done: null as any, errors: [] as [string, string][],
    }
    try {
      const task = new Task('t-m4-timeout-delivered', {
        onStatus: (p) => cbs.status.push(p),
        onMeta: (info) => (cbs.meta = info),
        onChunk: (text, seq) => cbs.chunks.push([text, seq]),
        onDone: (info) => (cbs.done = info),
        onError: (code, message) => cbs.errors.push([code, message]),
      })
      task.start({ taskId: 't-m4-timeout-delivered', agentId: 'claude', workflow: 'quick', page: PAGE as any })
      task.appendContent(BODY, true)
      await task.run() // 超时 → reap 收割孙进程 → close 触发（timeoutSent 守卫防二次终局）
      // r63：去真实时钟——固定 500ms 睡眠换事件驱动轮询（onDone 先于 cleanupCwd 的
      // fire-and-forget rm，残留检查单独轮询，链慢不再假红）
      await vi.waitFor(() => expect(cbs.done?.historyPath).toBeTruthy(), { timeout: 5_000 })
      expect(cbs.errors).toEqual([])
      expect(cbs.done?.isError).toBe(false)
      const raw = await readFile(cbs.done.historyPath, 'utf8')
      expect(raw).toContain('status: done')
      // r56（#2）：超时已交付终局此前漏删正文临时文件（a35d671 散点漏此路径）
      await vi.waitFor(async () => {
        const residue = (await readdir(join(tmpdir(), 'pagedive')).catch(() => [] as string[]))
          .filter((f) => f.startsWith('t-m4-timeout-delivered'))
        expect(residue).toEqual([])
      }, { timeout: 5_000 })
    } finally {
      process.env.HOME = origHome
      AGENTS[0].buildArgs = orig
      await rm(fakeHome, { recursive: true, force: true })
      await rm(dir, { recursive: true, force: true })
    }
  }, 30_000)
})
