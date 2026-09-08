/**
 * 任务编排：正文缓冲 → 临时文件 → prompt 组装（workflow 正文即任务段）
 * → spawn → 归一化事件 → ≤512KB chunk → 历史落盘。
 */
import { mkdir, rm, symlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { MAX_CHUNK } from '@ai-page-dive/shared'
import type { AgentEvent, TaskInput } from '@ai-page-dive/shared'
import { createClaudeParser } from './agents/claude.js'
import { createCodexParser } from './agents/codex.js'
import { createOpencodeParser } from './agents/opencode.js'
import { getAgent } from './agents/registry.js'
import { getSkillBodies } from './skills.js'
import { appendHistoryTurn, buildHistoryPath, saveHistory } from './history.js'
import { makeAgentCwd, spawnCli, type SpawnedProc } from './spawn.js'
import { scheduleCleanup, writeContentFile } from './tmpfile.js'
import { getWorkflow } from './workflows.js'

const TASK_TIMEOUT_MS = 10 * 60_000

/**
 * CLI 会话 id → 首轮 spawn cwd 的映射（追问用，内存加速）。
 * claude 的会话记录按 cwd 分区存储（~/.claude/projects/<cwd 编码>/），
 * resume 轮 cwd 不一致会报 No conversation found。
 * 兜底：miss 时用固定工作区 ~/.ai-page-dive/agent-workspace/（host 重启后仍可复现）
 */
const sessionCwds = new Map<string, string>()

/** 固定 CLI 工作区（幂等创建）：claude 会话跨 host 重启可 resume 的关键 */
let stableCwd: string | null = null
async function getStableAgentCwd(): Promise<string> {
  const dir = join(homedir(), '.ai-page-dive', 'agent-workspace')
  // 每次 mkdir（幂等）：目录被误删后缓存短路会让后续所有 spawn 落在不存在 cwd 上
  await mkdir(dir, { recursive: true })
  return (stableCwd = dir)
}

export interface TaskCallbacks {
  onStatus: (phase: 'spawned' | 'reading' | 'thinking') => void
  onMeta: (info: { model?: string; sessionId?: string }) => void
  onChunk: (text: string, seq: number) => void
  onDone: (info: {
    historyPath: string
    isError: boolean
    errorText?: string
    usage?: { inputTokens?: number; outputTokens?: number }
    durationMs: number
    model?: string
    sessionId?: string
  }) => void
  onError: (code: 'spawn-fail' | 'timeout' | 'cancelled' | 'parse' | 'no-agent', message: string) => void
}

export class Task {
  readonly taskId: string
  private input!: TaskInput
  private contentParts: string[] = []
  private contentDone = false
  /** 已收正文总字符数（content-received 对账） */
  private contentChars = 0
  private proc?: SpawnedProc
  private cancelled = false
  private ran = false
  private startedAt = 0
  private accText = ''
  private usage?: { inputTokens?: number; outputTokens?: number }
  private meta?: { model?: string; sessionId?: string }
  private chunkSeq = 0
  private finished = false
  /** isError 路径已发终局（防 exit 事件二次发） */
  private doneSent = false
  /** timeout 终局已发（防 exit 后 finish() 再补发 cancelled） */
  private timeoutSent = false
  /** claude 已交付完整 result 且 is_error=false（exit code 异常时仍算成功——硬约束 #4 的精神） */
  private gotResultOk = false
  private historyPath = ''
  private timeoutTimer?: ReturnType<typeof setTimeout>

  constructor(taskId: string, private cb: TaskCallbacks) {
    this.taskId = taskId
  }

  start(input: TaskInput): void {
    this.input = input
  }

  appendContent(text: string, done: boolean): void {
    this.contentParts.push(text)
    this.contentChars += text.length
    if (done) this.contentDone = true
  }

  contentReady(): boolean {
    return this.contentDone
  }

  /** 已收正文总字符数（content-received 回执对账用） */
  receivedChars(): number {
    return this.contentChars
  }

  /** 附件落盘：每个附件写 tmp 文件（安全文件名），软链进 agent cwd 供沙箱 CLI 读。
   * 返回 [{name, path}] 供 prompt 附件段；空附件/写失败（跳过该个）都返回 []。 */
  private async materializeAttachments(): Promise<{ name: string; path: string }[]> {
    const atts = this.input.attachments ?? []
    if (!atts.length) return []
    const out: { name: string; path: string }[] = []
    for (const a of atts.slice(0, 5)) {
      // name 只保留安全字符做文件名（协议信任边界：NM 消息可能带任意字符串）
      const safe = a.name.replace(/[^A-Za-z0-9_.一-龥-]/g, '_').slice(0, 64) || 'attachment'
      try {
        const p = await writeContentFile(`${this.taskId}-att-${safe}`, a.text)
        scheduleCleanup(p, 300_000)
        out.push({ name: a.name, path: p })
      } catch { /* 单个失败跳过，不阻断任务 */ }
    }
    return out
  }

  cancel(): void {
    this.cancelled = true
    this.proc?.reap()
  }

  /** 正文齐了且 agent 可用 → 组装 prompt 并 spawn（幂等：重复 done:true 只跑一次） */
  async run(): Promise<void> {
    if (this.ran) return
    this.ran = true
    // spawn 前已取消（正文传输期间点停止）：不再起进程白烧 CLI 配额
    if (this.cancelled) {
      this.cb.onError('cancelled', 'task cancelled')
      return
    }
    const def = getAgent(this.input.agentId)
    if (!def) {
      this.cb.onError('no-agent', `unknown agent: ${this.input.agentId}`)
      return
    }
    const page = this.input.page
    // 追问轮：上下文在 CLI 会话里，无正文/临时文件，prompt 只剩 instruction
    const isResume = !!this.input.resumeSessionId
    const contentFile = isResume ? '' : await writeContentFile(this.taskId, this.contentParts.join(''))
    const lastMsgFile = isResume ? '' : `${contentFile}.last`
    // 统一在此调度清理：isError/spawn-fail/cancel/正常路径全覆盖
    if (!isResume) {
      scheduleCleanup(contentFile, 300_000)
      scheduleCleanup(lastMsgFile, 300_000)
    }

    // workflow 正文即任务段：用户目录 shadow 内置，未命中走 DEFAULT_TASKS
    const wfName = this.input.workflow ?? 'quick'
    const wf = await getWorkflow(wfName)

    // 技能注入：非 resume 轮读取启用技能正文（读取失败的已在 getSkillBodies 内跳过）
    const skillBodies = !isResume && this.input.skills?.length
      ? await getSkillBodies(this.input.skills)
      : undefined

    const parser =
      def.streamFormat === 'claude-stream-json' ? createClaudeParser()
      : def.streamFormat === 'opencode-jsonl' ? createOpencodeParser()
      : createCodexParser()

    // opencode 需先知道 cwd 才能组 argv（--dir 钉死工作区）+ 软链正文 + 相对路径 prompt。
    // claude 会话按 cwd 分区存储（~/.claude/projects/<cwd 编码>/）：cwd 必须跨 host 重启
    // 可复现，否则 --resume 报 No conversation found——统一用固定工作区
    // ~/.ai-page-dive/agent-workspace/，sessionCwds 仅作内存加速
    let agentCwd = def.filePathInPrompt && !isResume ? await makeAgentCwd() : undefined
    if (isResume) {
      const remembered = sessionCwds.get(this.input.resumeSessionId!)
      agentCwd = remembered ?? (await getStableAgentCwd())
    } else if (!agentCwd) {
      agentCwd = await getStableAgentCwd()
    }
    let fileForPrompt = contentFile
    if (def.filePathInPrompt && agentCwd) {
      await linkIntoCwd(contentFile, agentCwd)
      fileForPrompt = def.filePathInPrompt({ contentFile, contentRelPath: basename(contentFile), agentCwd })
    }
    // 占位符只展开 workflow 正文：用户 instruction 可能合法含 {xx} 字面量，不展开
    const wfBody = !isResume && wf?.body && !this.input.instruction
      ? expandWorkflowPlaceholders(wf.body, page, fileForPrompt)
      : wf?.body
    // 大纲从内存正文提取（resume 轮上下文在 CLI 会话里，不需要）
    const outline = !isResume ? buildOutline(this.contentParts.join('')) : undefined
    // 附件：panel 读的文本落临时文件 + 软链 cwd，prompt 附件段给路径（resume 轮同样生效）
    const attachFiles = await this.materializeAttachments()
    const prompt = isResume
      ? attachSection(attachFiles) + (this.input.instruction ?? '')
      : buildPrompt(page, fileForPrompt, wfName, this.input.instruction ?? wfBody, skillBodies, this.input.lang, outline, attachFiles)

    this.startedAt = Date.now()
    this.cb.onStatus('spawned')
    let stderrTail = ''
    try {
      this.proc = await spawnCli({
        bin: def.bin,
        args: def.buildArgs({ contentFile, lastMsgFile, agentCwd, resumeSessionId: this.input.resumeSessionId }),
        cwd: agentCwd,
        stdinData: prompt,
        onStdoutLine: (line) => {
          for (const ev of parser(line)) void this.handleEvent(ev, contentFile)
        },
        onStderr: (s) => {
          stderrTail = (stderrTail + s).slice(-2000)
        },
      })
    } catch (e: any) {
      // spawn 失败只回收 mkdtemp 的临时 cwd——固定工作区（stableCwd）是 resume 锚点，删了
      // 后续 claude/codex 任务连锁 spawn 失败 + 历史会话 resume 失效
      if (agentCwd && agentCwd !== stableCwd) rm(agentCwd, { recursive: true, force: true }).catch(() => {})
      this.cb.onError('spawn-fail', String(e?.message ?? e))
      return
    }

    // spawn 成功后又已取消（cancel 落在 await 窗口内）：立即收割，勿让进程跑满超时
    if (this.cancelled) {
      this.proc.reap()
      return
    }

    this.timeoutTimer = setTimeout(() => {
      if (this.finished) return
      // 终局标记前置：reap 触发的 exit 事件不得再走 finish() 二次发终局
      this.finished = true
      this.timeoutSent = true
      this.cb.onError('timeout', `task exceeded ${TASK_TIMEOUT_MS / 60_000}min`)
      this.cancel()
    }, TASK_TIMEOUT_MS)

    await new Promise<void>((resolve) => {
      this.proc!.child.on('exit', async (code, signal) => {
        if (this.doneSent || this.timeoutSent) return resolve() // isError/timeout 路径已发终局，勿重复
        this.finished = true
        await this.finish(code, signal, stderrTail, contentFile)
        resolve()
      })
      // spawn 成功后的运行期错误（罕见）：兜底收割
      this.proc!.child.on('error', () => {
        if (!this.finished) {
          this.finished = true
          resolve()
          this.cb.onError('spawn-fail', 'child runtime error')
        }
      })
    })
  }

  private async handleEvent(ev: AgentEvent, contentFile: string): Promise<void> {
    if (this.finished) return
    switch (ev.type) {
      case 'status':
        if (!this.cancelled) this.cb.onStatus(ev.phase)
        break
      case 'meta':
        this.meta = {
          model: ev.model ?? this.meta?.model,
          sessionId: ev.sessionId ?? this.meta?.sessionId,
        }
        // 记录会话 → cwd（追问轮 resume 需要同 cwd 才能找到会话）
        if (this.meta.sessionId && this.proc?.cwd) {
          sessionCwds.set(this.meta.sessionId, this.proc.cwd)
        }
        this.cb.onMeta(this.meta)
        break
      case 'text-delta':
        this.accText += ev.text
        if (!this.cancelled) this.sendChunk(ev.text)
        break
      case 'usage':
        this.usage = ev
        break
      case 'result':
        // claude 的运行内失败：退出码 0 也判失败（硬约束 #4）
        if (ev.isError) {
          this.finished = true
          this.doneSent = true
          clearTimeout(this.timeoutTimer)
          this.proc?.reap()
          if (!this.input.resumeSessionId) this.historyPath ||= buildHistoryPath(new Date(), this.input.page.title)
          // 落盘完成再发终局：host 若在 persist 期间断连退出，错误轮历史不再丢失
          await this.persist('error')
          this.cb.onDone({
            historyPath: this.effectiveHistoryPath,
            isError: true,
            errorText: ev.text,
            usage: this.usage,
            durationMs: Date.now() - this.startedAt,
            model: this.meta?.model,
            sessionId: this.meta?.sessionId,
          })
        } else if (ev.text && !this.accText) {
          // codex 无增量时 result 兜底出全文
          this.accText = ev.text
          this.sendChunk(ev.text)
          this.gotResultOk = true
        } else if (ev.text || this.accText) {
          // 已产出正文的成功 result：exit code 异常时仍按成功终局（硬约束 #4 的精神）
          this.gotResultOk = true
        }
        // 正常路径不设 finished：等 exit 事件统一走 finish()（onDone + 落盘）
        break
    }
  }

  private sendChunk(text: string): void {
    // NM 单帧 ≤1MB（字节维度）：CJK UTF-8 每字符 3 字节，按字符数切会击穿上限——
    // 按 Buffer.byteLength 收缩切片（尾段同样受检：短字符数 ≠ 短字节）
    let start = 0
    for (;;) {
      let end = Math.min(start + MAX_CHUNK, text.length)
      while (end > start && Buffer.byteLength(text.slice(start, end)) > MAX_CHUNK) {
        end = Math.floor((start + end) / 2)
      }
      this.cb.onChunk(text.slice(start, end), this.chunkSeq++)
      if (end >= text.length) return
      start = end
    }
  }

  private async finish(code: number | null, signal: string | null, stderrTail: string, contentFile: string): Promise<void> {
    clearTimeout(this.timeoutTimer)
    // CLI 临时工作目录（mkdtemp）回收——固定工作区（stableCwd）与已被会话映射
    // 记录的 cwd 不删（后续 resume 要用同 cwd）
    if (
      this.proc?.cwd &&
      this.proc.cwd !== stableCwd &&
      ![...sessionCwds.values()].includes(this.proc.cwd)
    ) {
      rm(this.proc.cwd, { recursive: true, force: true }).catch(() => {})
    }
    const durationMs = Date.now() - this.startedAt
    // 追问轮不建新历史路径（append 首轮文件）
    if (!this.input.resumeSessionId) {
      this.historyPath ||= buildHistoryPath(new Date(), this.input.page.title)
    }
    if (this.cancelled || signal === 'SIGTERM' || signal === 'SIGKILL') {
      await this.persist('interrupted')
      this.cb.onError('cancelled', 'task cancelled')
      return
    }
    const isError = code !== 0 || !this.accText
    await this.persist(isError ? 'error' : 'done')
    if (code !== 0 && !this.gotResultOk) {
      // result 已成功交付（is_error=false）后 exit code 异常：内容完整，按成功终局
      this.cb.onDone({
        historyPath: this.effectiveHistoryPath,
        isError: false,
        usage: this.usage,
        durationMs,
        model: this.meta?.model,
        sessionId: this.meta?.sessionId,
      })
    } else if (code !== 0) {
      this.cb.onError('parse', `exit ${code}: ${stderrTail.slice(-500)}`)
    } else if (!this.accText) {
      this.cb.onError('parse', `no output${stderrTail ? `: ${stderrTail.slice(-500)}` : ''}`)
    } else {
      this.cb.onDone({
        historyPath: this.effectiveHistoryPath,
        isError: false,
        usage: this.usage,
        durationMs,
        model: this.meta?.model,
        sessionId: this.meta?.sessionId,
      })
    }
  }

  /** 终局回传的历史路径：resume 轮用 input 带来的首轮路径（this.historyPath 为空——
   * SW 侧 `'' ?? fallback` 不生效会把 lastSession 覆盖成空串，第 2 次追问起不再落盘） */
  private get effectiveHistoryPath(): string {
    return this.input.historyPath || this.historyPath
  }

  private async persist(status: 'done' | 'interrupted' | 'error'): Promise<void> {
    if (!this.input) return
    const logFail = (e: unknown) =>
      console.error(`[ai-page-dive] history persist failed (${this.effectiveHistoryPath}):`, e instanceof Error ? e.message : e)
    // 追问轮：user + assistant append 到首轮历史文件（多轮对话完整记录）
    if (this.input.resumeSessionId) {
      if (this.input.historyPath && this.accText) {
        await appendHistoryTurn(this.input.historyPath, {
          user: this.input.instruction ?? '',
          assistant: this.accText,
        }).catch(logFail)
      }
      return
    }
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
        sessionId: this.meta?.sessionId,
      },
      this.accText,
    )
      .then((actual) => { this.historyPath = actual }) // 冲突重试换了文件名：终局回传实际路径
      .catch(logFail)
  }

  get accumulated(): string {
    return this.accText
  }
}

/** 把正文文件软链进 CLI cwd（opencode 沙箱只准读 cwd） */
async function linkIntoCwd(contentFile: string, cwd: string): Promise<void> {
  try {
    await symlink(contentFile, join(cwd, basename(contentFile)))
  } catch { /* EEXIST 等：沙箱内已有同名，直接用 */ }
}

/** 网页元数据单行拼装（{meta} 占位符与「## 网页元数据」段共用） */
function pageMetaLine(page: TaskInput['page']): string {
  return [
    `标题: ${page.title}`,
    `URL: ${page.url}`,
    page.byline && `作者: ${page.byline}`,
    page.publishedTime && `发布: ${page.publishedTime}`,
    page.siteName && `站点: ${page.siteName}`,
    page.lang && `语言: ${page.lang}`,
  ]
    .filter(Boolean)
    .join('  ')
}

/**
 * workflow 正文占位符展开（{url} {title} {file} {meta}）。
 * 只替换四个已知占位符，未知（含大小写变体）原样保留。
 */
export function expandWorkflowPlaceholders(
  body: string,
  page: TaskInput['page'],
  contentFile: string,
): string {
  return body.replace(
    /\{(url|title|file|meta)\}/g,
    (_, k: string) =>
      k === 'url' ? page.url
      : k === 'title' ? page.title
      : k === 'file' ? contentFile
      : pageMetaLine(page),
  )
}

/** 正文 H1-H3 标题大纲（长文分段读取导航）。无标题返回 ''；60 条 / 2000 字符双截断防 prompt 稀释 */
export function buildOutline(content: string): string {
  const out: string[] = []
  let total = 0
  let inCode = false
  for (const line of content.split('\n')) {
    // 代码围栏内的 # 注释行不是标题
    if (/^```/.test(line)) {
      inCode = !inCode
      continue
    }
    if (inCode) continue
    const m = line.match(/^(#{1,3})\s+(.+)$/)
    if (!m) continue
    const indent = '  '.repeat(m[1].length - 1)
    const item = `${indent}- ${m[2].trim()}`
    if (total + item.length > 2000 || out.length >= 60) break
    out.push(item)
    total += item.length
  }
  return out.join('\n')
}

/** prompt 组装：instruction（用户输入）优先，其次 workflow 正文；技能为可选增强指令；lang 为输出语言偏好 */
export function buildPrompt(
  page: TaskInput['page'],
  contentFile: string,
  workflow: string,
  workflowBody?: string,
  skills?: { name: string; body: string }[],
  lang?: string,
  outline?: string,
  attachments?: { name: string; path: string }[],
): string {
  const task =
    workflowBody ??
    DEFAULT_TASKS[workflow] ??
    `请深度总结这个网页。（workflow: ${workflow} 未找到，使用默认）`
  const meta = pageMetaLine(page)
  // 技能段：每个技能一行小标题 + 正文，--- 分隔；用户启用的可选增强指令（风格/输出格式等）
  const skillsSection = skills?.length
    ? `\n## 技能\n以下为用户启用的增强指令，在不与任务冲突的前提下遵循：\n\n${skills
        .map((s) => `### ${s.name}\n${s.body}`)
        .join('\n\n---\n\n')}\n`
    : ''
  // 正文导航（可选）：长文 H1-H3 大纲，给 agent 分段读取参考
  const outlineSection =
    outline ? `\n## 正文导航\n以下为正文 H1-H3 标题大纲（无行号，仅供分段读取参考）：\n${outline}\n` : ''
  // 输出语言（缺省自动）：固定尾部指令，优先级高于技能段
  const langSection =
    lang === 'zh' ? `\n无论正文是什么语言，始终使用中文回答。\n`
    : lang === 'en' ? `\nAlways respond in English, regardless of the page language.\n`
    : ''
  const attachSect = attachSection(attachments)
  return `你是深度阅读助手。请完成以下任务。

## 网页元数据
${meta}

## 正文
完整正文（markdown，约 ${page.approxTokens} tokens）已写入本地文件：
${contentFile}
请读取该文件全文后再作答，不要只读开头。
${outlineSection}${skillsSection}${attachSect}
## 任务
${task}
${langSection}`
}

/** 附件段：路径给 CLI 自行读取（与正文同一「文件即上下文」模式）。空数组返回空串 */
export function attachSection(attachments?: { name: string; path: string }[]): string {
  if (!attachments?.length) return ''
  return `\n## 附件\n用户随任务附带的参考文件（按需读取）：\n${attachments
    .map((a) => `- ${a.name}: ${a.path}`)
    .join('\n')}\n`
}

const DEFAULT_TASKS: Record<string, string> = {
  quick: `快速摘要：用 5-8 条要点概括正文核心内容，每条一句话。结尾给一行「适合谁读」。`,
  deep: `深度研读：通读全文后输出结构化研读报告——核心论点、论证链条、关键证据/数据、作者立场与盲点、对读者的行动建议。分节使用 markdown 标题。`,
  paper: `论文模式：按论文阅读框架输出——研究问题、方法、实验设置、主要结果（含关键数字）、局限、与你认知的既有工作对比、值得追问的问题。`,
}
