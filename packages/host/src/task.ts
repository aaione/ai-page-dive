/**
 * 任务编排：正文缓冲 → 临时文件 → prompt 组装 → spawn → 归一化事件
 * → ≤1MB chunk → 历史落盘。
 */
import type { AgentEvent, TaskInput } from '@pagedive/shared'
import { MAX_CHUNK } from '@pagedive/shared'
import { createClaudeParser } from './agents/claude.js'
import { createCodexParser } from './agents/codex.js'
import { getAgent } from './agents/registry.js'
import { buildHistoryPath, saveHistory } from './history.js'
import { spawnCli, type SpawnedProc } from './spawn.js'
import { scheduleCleanup, writeContentFile } from './tmpfile.js'

export interface TaskCallbacks {
  onStatus: (phase: 'spawned' | 'reading' | 'thinking') => void
  onChunk: (text: string) => void
  onDone: (info: {
    historyPath: string
    isError: boolean
    errorText?: string
    usage?: { inputTokens?: number; outputTokens?: number }
    durationMs: number
  }) => void
  onError: (code: 'spawn-fail' | 'timeout' | 'cancelled' | 'parse' | 'no-agent', message: string) => void
}

export class Task {
  readonly taskId: string
  private input!: TaskInput
  private contentParts: string[] = []
  private contentDone = false
  private proc?: SpawnedProc
  private cancelled = false
  private startedAt = 0
  private accText = ''
  private usage?: { inputTokens?: number; outputTokens?: number }
  private chunkSeq = 0
  private finished = false

  constructor(taskId: string, private cb: TaskCallbacks) {
    this.taskId = taskId
  }

  start(input: TaskInput): void {
    this.input = input
  }

  appendContent(text: string, done: boolean): void {
    this.contentParts.push(text)
    if (done) this.contentDone = true
  }

  contentReady(): boolean {
    return this.contentDone
  }

  cancel(): void {
    this.cancelled = true
    this.proc?.reap()
  }

  /** 正文齐了且 agent 可用 → 组装 prompt 并 spawn */
  async run(): Promise<void> {
    const def = getAgent(this.input.agentId)
    if (!def) {
      this.cb.onError('no-agent', `unknown agent: ${this.input.agentId}`)
      return
    }
    const page = this.input.page
    const contentFile = await writeContentFile(this.taskId, this.contentParts.join(''))
    const lastMsgFile = `${contentFile}.last`
    const prompt = buildPrompt(page, contentFile, this.input.workflow ?? 'quick')
    const parser =
      def.streamFormat === 'claude-stream-json' ? createClaudeParser() : createCodexParser()

    this.startedAt = Date.now()
    this.cb.onStatus('spawned')
    let stderrTail = ''
    try {
      this.proc = await spawnCli({
        bin: def.bin,
        args: def.buildArgs({ contentFile, lastMsgFile }),
        stdinData: prompt,
        onStdoutLine: (line) => {
          for (const ev of parser(line)) this.handleEvent(ev)
        },
        onStderr: (s) => {
          stderrTail = (stderrTail + s).slice(-2000)
        },
      })
    } catch (e: any) {
      this.cb.onError('spawn-fail', String(e?.message ?? e))
      return
    }

    await new Promise<void>((resolve) => {
      this.proc!.child.on('exit', async (code, signal) => {
        if (this.finished) return resolve()
        this.finished = true
        resolve()
        await this.finish(code, signal, stderrTail, contentFile)
      })
    })
  }

  private handleEvent(ev: AgentEvent): void {
    if (this.finished) return
    switch (ev.type) {
      case 'status':
        this.cb.onStatus(ev.phase)
        break
      case 'text-delta':
        this.accText += ev.text
        this.sendChunk(ev.text)
        break
      case 'usage':
        this.usage = ev
        break
      case 'result':
        // claude 的运行内失败：退出码 0 也判失败（硬约束 #4）
        if (ev.isError) {
          this.finished = true
          this.proc?.reap()
          this.cb.onDone({
            historyPath: '',
            isError: true,
            errorText: ev.text,
            usage: this.usage,
            durationMs: Date.now() - this.startedAt,
          })
        } else {
          if (ev.text) {
            // codex 无增量时 result 兜底出全文
            if (!this.accText && ev.text) this.sendChunk(ev.text), (this.accText = ev.text)
          }
          this.finished = true
        }
        break
    }
  }

  private sendChunk(text: string): void {
    // NM 单帧 ≤1MB：按 MAX_CHUNK 切片（shared 协议 512KB）
    for (let i = 0; i < text.length; i += MAX_CHUNK) {
      this.cb.onChunk(text.slice(i, i + MAX_CHUNK))
    }
    this.chunkSeq++
  }

  private async finish(code: number | null, signal: string | null, stderrTail: string, contentFile: string): Promise<void> {
    scheduleCleanup(contentFile)
    const durationMs = Date.now() - this.startedAt
    if (this.cancelled || signal === 'SIGTERM' || signal === 'SIGKILL') {
      await this.persist('interrupted')
      this.cb.onError('cancelled', 'task cancelled')
      return
    }
    const isError = code !== 0 || !this.accText
    await this.persist(isError ? 'error' : 'done')
    if (code !== 0) {
      this.cb.onError('parse', `exit ${code}: ${stderrTail.slice(-500)}`)
    } else if (!this.accText) {
      this.cb.onError('parse', `no output${stderrTail ? `: ${stderrTail.slice(-500)}` : ''}`)
    } else {
      this.cb.onDone({
        historyPath: this.historyPath,
        isError: false,
        usage: this.usage,
        durationMs,
      })
    }
  }

  private historyPath = ''

  private async persist(status: 'done' | 'interrupted' | 'error'): Promise<void> {
    if (!this.input) return
    this.historyPath = this.historyPath || buildHistoryPath(new Date(), this.input.page.title)
    await saveHistory(
      this.historyPath,
      {
        title: this.input.page.title,
        url: this.input.page.url,
        agent: this.input.agentId,
        workflow: this.input.workflow,
        status,
        usage: this.usage,
        durationMs: Date.now() - this.startedAt,
      },
      this.accText,
    ).catch(() => {})
  }

  get accumulated(): string {
    return this.accText
  }
}

/** prompt 组装：workflow 正文即任务段，占位符 {url} {file} {title} */
export function buildPrompt(
  page: TaskInput['page'],
  contentFile: string,
  workflow: string,
  workflowBody?: string,
): string {
  const task =
    workflowBody ??
    DEFAULT_TASKS[workflow] ??
    `请深度总结这个网页。（workflow: ${workflow} 未找到，使用默认）`
  const meta = [
    `标题: ${page.title}`,
    `URL: ${page.url}`,
    page.byline && `作者: ${page.byline}`,
    page.publishedTime && `发布: ${page.publishedTime}`,
    page.siteName && `站点: ${page.siteName}`,
    page.lang && `语言: ${page.lang}`,
  ]
    .filter(Boolean)
    .join('  ')
  return `你是深度阅读助手。请完成以下任务。

## 网页元数据
${meta}

## 正文
完整正文（markdown，约 ${page.approxTokens} tokens）已写入本地文件：
${contentFile}
请读取该文件全文后再作答，不要只读开头。

## 任务
${task}
`
}

const DEFAULT_TASKS: Record<string, string> = {
  quick: `快速摘要：用 5-8 条要点概括正文核心内容，每条一句话。结尾给一行「适合谁读」。`,
  deep: `深度研读：通读全文后输出结构化研读报告——核心论点、论证链条、关键证据/数据、作者立场与盲点、对读者的行动建议。分节使用 markdown 标题。`,
  paper: `论文模式：按论文阅读框架输出——研究问题、方法、实验设置、主要结果（含关键数字）、局限、与你认知的既有工作对比、值得追问的问题。`,
}
