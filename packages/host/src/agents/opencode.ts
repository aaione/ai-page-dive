import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AgentDef, AgentEvent } from '@ai-page-dive/shared'

/**
 * opencode run --format json JSONL 解析器。
 * 实测形状（opencode 1.18.23）——多 step 流（读文件→作答各成一个 step）：
 *   {type:'step_start', part:{type:'step-start'}}   → 状态（每个 step 开始都会来一次）
 *   {type:'text', part:{type:'text', text}}         → 增量文本
 *   {type:'step_finish', part:{type:'step-finish', reason, tokens}} → 每个 step 结束都来
 *     ⚠ 不能在第一个 step_finish 封口——后续 step 的 text 会被吞；
 *     只收 usage（后一个覆盖前一个），终局交给进程 exit 事件
 */
export function createOpencodeParser() {
  let errored = false
  let resultSent = false
  return (line: string): AgentEvent[] => {
    let d: any
    try {
      d = JSON.parse(line)
    } catch {
      return []
    }
    const out: AgentEvent[] = []
    switch (d.type) {
      case 'step_start':
        out.push({ type: 'status', phase: 'thinking' })
        break
      case 'text':
        if (d.part?.text) out.push({ type: 'text-delta', text: d.part.text })
        break
      case 'step_finish': {
        const u = d.part?.tokens ?? {}
        if (u.input != null || u.output != null) {
          out.push({ type: 'usage', inputTokens: u.input, outputTokens: u.output })
        }
        // reason:'error' 的 step：报失败但不封口（后续可能有更多输出）
        if (d.part?.reason === 'error') errored = true
        break
      }
    }
    // result 恰发一次：errored 置位后每行都会走到这里，无 resultSent 门控会逐行重复
    // push result（当前靠 task.ts finished 门控兜住不炸，但解析器契约上 result 应唯一，
    // v2 多引擎并发下解析器契约干净更重要）
    if (errored && !resultSent) {
      resultSent = true
      out.push({ type: 'result', isError: true, text: '' })
    }
    return out
  }
}

export const opencodeDef: AgentDef = {
  id: 'opencode',
  bin: 'opencode',
  versionArgs: ['--version'],
  streamFormat: 'opencode-jsonl',
  // 探测时读 opencode.json 的 model 字段（best-effort，两个候选路径）
  probeModel: () => {
    const home = homedir()
    for (const p of [join(home, '.config/opencode/opencode.json'), join(home, '.opencode.json')]) {
      try {
        const j = JSON.parse(readFileSync(p, 'utf8'))
        if (typeof j.model === 'string') return j.model
      } catch { /* 下一候选 */ }
    }
    return undefined
  },
  buildArgs: (opts) => [
    'run',
    '--format', 'json',
    '--pure',
    // opencode 按 git root 解析工作区，会无视 cwd 跑到用户仓库去——必须 --dir 钉死
    '--dir', opts.agentCwd ?? process.cwd(),
  ],
  // 沙箱只准读工作区（--dir 目录）：正文软链进去后按相对路径引用
  filePathInPrompt: (opts) => opts.contentRelPath ?? opts.contentFile,
}
