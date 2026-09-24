/** 任务编排：正文缓冲 → 临时文件 → prompt 组装（workflow 正文即任务段）→ spawn → 归一化事件 → ≤512KB chunk → 历史落盘。 */
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { AgentEvent, TaskInput } from '@ai-page-dive/shared'
import { MAX_CHUNK } from './nmconst.js'
import { createClaudeParser } from './agents/claude.js'
import { createCodexParser } from './agents/codex.js'
import { createOpencodeParser } from './agents/opencode.js'
import { getAgent } from './agents/registry.js'
import { getSkillBodies } from './skills.js'
import { appendHistoryTurn, buildHistoryPath, escapePd, pruneHistory, saveHistory } from './history.js'
import { attachMarkers, attachSection, buildOutline, buildPrompt, expandWorkflowPlaceholders } from './prompt.js'
import { makeAgentCwd, spawnCli, type SpawnedProc } from './spawn.js'
import { scheduleCleanup, writeContentFile } from './tmpfile.js'
import { getWorkflow } from './workflows.js'

// r47-audit：测试钩子——env 覆写任务超时（缺省/非法值兜底 10min，默认行为零变化），供短超时回归测试复现孙进程持写端场景
const TASK_TIMEOUT_MS = Number(process.env.PAGEDIVE_TASK_TIMEOUT_MS) || 10 * 60_000

/** CLI 会话 id → 首轮 spawn cwd 的映射（追问用）。r7-review 现状澄清：当前三适配器下 value 恒为 stableCwd（唯一走 mkdtemp 的 opencode 不产 meta 事件）——「未来按会话隔离 cwd 的引擎」预留，届时 resume 取回同 cwd 才承重。 */
const sessionCwds = new Map<string, string>()

/** 固定 CLI 工作区（幂等创建）：claude 会话跨 host 重启可 resume 的关键。每次 mkdir：目录被误删后缓存短路会让后续 spawn 落在不存在 cwd 上 */
let stableCwd: string | null = null
async function getStableAgentCwd(): Promise<string> {
  const dir = join(homedir(), '.ai-page-dive', 'agent-workspace')
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
  /** 首轮 saveHistory 成功落盘（r7-review）：失败时终局回传空串——虚构路径会让
   * SW 记进 lastSession，追问轮 append 出无 frontmatter 的孤儿历史文件 */
  private persistOk = false
  private historyPath = ''
  private timeoutTimer?: ReturnType<typeof setTimeout>
  /** r8-perf：text-delta 攒批——逐 delta 直发 NM 帧且 panel 每 chunk 全树 reconcile，
   * 数千 delta 的长回答累计秒级主线程开销；≥8KB 或 50ms 合并（seq 仍连续） */
  private pendingDelta = ''
  private deltaTimer?: ReturnType<typeof setTimeout>
  /** 已落盘附件（r12）：prompt 引用与历史 [Image #N] 标记共用同一编号源 */
  private attachFiles: { name: string; path: string; kind: 'text' | 'image' }[] = []

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

  /** 附件落盘（r12 持久化）：写 ~/.ai-page-dive/attachments/<yyyymm>/（0600，不清理——历史恢复可追溯），
   *  软链进 agent cwd 供沙箱 CLI（opencode）读；图片写 b64 解码件。返回 [{name, path, kind}]。 */
  private async materializeAttachments(agentCwd?: string): Promise<{ name: string; path: string; kind: 'text' | 'image' }[]> {
    const atts = this.input.attachments ?? []
    if (!atts.length) return []
    const out: { name: string; path: string; kind: 'text' | 'image' }[] = []
    let madeDir = false
    for (const [i, a] of atts.slice(0, 5).entries()) {
      const kind = a.kind === 'image' && a.b64 ? 'image' : 'text'
      // name 只保留安全字符做文件名（协议信任边界：NM 消息可能带任意字符串）
      const safe = a.name.replace(/[^A-Za-z0-9_.一-龥-]/g, '_').slice(0, 64) || 'attachment'
      try {
        const dir = join(homedir(), '.ai-page-dive', 'attachments', new Date().toISOString().slice(0, 7).replace('-', ''))
        if (!madeDir) { await mkdir(dir, { recursive: true, mode: 0o700 }); madeDir = true }
        // taskId 内联消毒：resume 轮可绕过上层校验，此处兜底防路径穿越（净零行）
        const p = join(dir, `${this.taskId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 't'}-${i + 1}-${safe}`)
        await writeFile(p, kind === 'image' ? Buffer.from(a.b64!, 'base64') : a.text ?? '', { mode: 0o600 })
        if (agentCwd) await symlink(p, join(agentCwd, basename(p))).catch(() => {})
        out.push({ name: a.name, path: p, kind })
      } catch { /* 单个失败跳过，不阻断任务 */ }
    }
    return out
  }

  /** 被同 id 新任务顶掉（stdio 重入防御，r8-review）：置位后回调层静默全部帧 */
  superseded = false

  cancel(): void {
    if (this.finished) return
    this.cancelled = true
    this.proc?.reap()
    // r8-review：未起跑的任务（正文传输期点停止）没有 exit 事件会来——不主动终局
    // 就永留 tasks Map，心跳门禁(tasks.size>0)使 host 永生。置 ran 挡住迟到 done 片
    if (!this.ran) {
      this.ran = true
      this.finished = true
      this.cb.onError('cancelled', 'task cancelled')
    }
  }

  /** 同步 SIGKILL 整组（stdio exit 钩子专用）：事件循环已停，reap() 的 SIGTERM→3s→SIGKILL 异步链跑不完 */
  killNow(): void {
    const { child } = this.proc ?? {}
    if (child && child.exitCode === null && child.signalCode === null) { try { process.kill(-child.pid!, 'SIGKILL') } catch { /* gone */ } }
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
    // r8-review：sessionId 实际来源是历史文件 frontmatter（第三方可控——「目录即
    // 备份拖走即导出」），与 workflow 名同一信任边界：不让未校验字符串直拼 argv
    if (this.input.resumeSessionId && !/^[A-Za-z0-9_-]{8,128}$/.test(this.input.resumeSessionId)) {
      this.cb.onError('parse', 'invalid session id')
      return
    }
    const page = this.input.page
    // 追问轮：上下文在 CLI 会话里，无正文/临时文件，prompt 只剩 instruction
    const isResume = !!this.input.resumeSessionId
    const contentFile = isResume ? '' : await writeContentFile(this.taskId, this.contentParts.join(''))
    // 统一在此调度清理：isError/spawn-fail/cancel/正常路径全覆盖
    if (!isResume) {
      // 11min > 10min 任务超时：运行期文件必须存在，终局后再留 1min 缓冲给迟到的读取
      scheduleCleanup(contentFile, 11 * 60_000)
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

    // cwd 语义：opencode --dir 钉死工作区 + 相对路径 prompt；claude 会话按 cwd 分区存储
    // （~/.claude/projects/<编码>/），跨 host 重启必须可复现否则 --resume 报错——统一固定工作区
    let agentCwd = def.filePathInPrompt && !isResume ? await makeAgentCwd() : undefined
    if (isResume) {
      const remembered = sessionCwds.get(this.input.resumeSessionId!)
      agentCwd = remembered ?? (await getStableAgentCwd())
    } else if (!agentCwd) {
      agentCwd = await getStableAgentCwd()
    }
    let fileForPrompt = contentFile
    // resume 轮 contentFile 为 ''：symlink('') 必抛被 catch 吞——直接跳过（r7-review）
    if (def.filePathInPrompt && agentCwd && !isResume) {
      await linkIntoCwd(contentFile, agentCwd)
      fileForPrompt = def.filePathInPrompt({ contentFile, contentRelPath: basename(contentFile), agentCwd })
    }
    // 占位符只展开 workflow 正文：用户 instruction 可能合法含 {xx} 字面量，不展开
    const wfBody = !isResume && wf?.body && !this.input.instruction
      ? expandWorkflowPlaceholders(wf.body, page, fileForPrompt)
      : wf?.body
    // 大纲从内存正文提取（resume 轮上下文在 CLI 会话里，不需要）
    const outline = !isResume ? buildOutline(this.contentParts.join('')) : undefined
    // 附件：落盘（持久化）+ 软链 cwd，prompt 附件段给路径（resume 轮同样生效）
    this.attachFiles = await this.materializeAttachments(agentCwd)
    const prompt = isResume
      ? attachSection(this.attachFiles) + (this.input.instruction ?? '')
      : buildPrompt(page, fileForPrompt, wfName, this.input.instruction || wfBody, skillBodies, this.input.lang, outline, this.attachFiles)

    this.startedAt = Date.now()
    this.cb.onStatus('spawned')
    let stderrTail = ''
    try {
      this.proc = await spawnCli({
        bin: def.bin,
        args: def.buildArgs({ contentFile, agentCwd, resumeSessionId: this.input.resumeSessionId }),
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

    // spawn 成功后又已取消（cancel 落在 await 窗口内）：立即收割 + 必发 onError——否则 tasks Map 不 delete、panel running 永真锁死
    if (this.cancelled) {
      this.proc.reap()
      this.cleanupCwd()
      this.cb.onError('cancelled', 'task cancelled')
      return
    }

    this.timeoutTimer = setTimeout(() => {
      // r48（M4）：cancel() 只在 !ran 时同步置 finished——运行中取消后 exit 事件
      // 到达前 finished 仍 false，此处若不挡会误报 timeout 终局顶掉 cancelled
      if (this.finished || this.cancelled) return
      // 终局标记前置：reap 触发的 exit 事件不得再走 finish() 二次发终局
      this.finished = true
      this.timeoutSent = true
      this.flushDelta() // timeout 不经 finish()：终局前发完缓冲尾巴
      // r47-audit（M4 超时误杀）：result 成功帧已解析（gotResultOk）但进程未退出——典型如
      // CLI 工具孙进程持 stdout 写端（r33 机制）——时，到点仍走 onError('timeout') +
      // persist('interrupted')，用户看到失败但结果已完整交付。已交付则改走成功终局
      // （与 finish() 成功路径同款：persist('done') + onDone），收割照旧
      if (this.gotResultOk && this.accText) {
        if (!this.input.resumeSessionId) {
          this.historyPath ||= buildHistoryPath(new Date(), this.input.page.title)
        }
        void (async () => {
          await this.persist('done') // 落盘完成再发终局（对齐 isError 路径的持久化语义）
          this.cb.onDone({
            historyPath: this.effectiveHistoryPath,
            isError: false,
            usage: this.usage,
            durationMs: Date.now() - this.startedAt,
            model: this.meta?.model,
            sessionId: this.meta?.sessionId,
          })
        })()
        this.cleanupCwd()
        this.proc?.reap()
        return
      }
      this.cb.onError('timeout', `task exceeded ${TASK_TIMEOUT_MS / 60_000}min`)
      // 部分输出落盘（对称于 cancel 路径）；不 await——persist 在事件循环里自然完成
      if (!this.input.resumeSessionId) {
        this.historyPath ||= buildHistoryPath(new Date(), this.input.page.title)
      }
      void this.persist('interrupted')
      this.cleanupCwd() // 不经过 finish()：timeout 路径自回收 cwd（r4-impl）
      // 收割挂死 CLI：走 cancel() 会被其 finished 守卫挡回（终局已前置），detached 进程组永久泄漏烧配额（r9-review 实证）
      this.proc?.reap()
    }, TASK_TIMEOUT_MS)

    await new Promise<void>((resolve) => {
      // close 而非 exit（r33）：exit 即刻触发时 stdout 尾部（pipe 异步）未派发完，result 未到即 finish() 会误判 parse 失败
      this.proc!.child.on('close', async (code, signal) => {
        if (this.finished || this.doneSent || this.timeoutSent) return resolve() // isError/timeout/error 已发终局勿重复（r11：error 后仍可触 exit）
        this.finished = true
        await this.finish(code, signal, stderrTail, contentFile)
        resolve()
      })
      // spawn 成功后的运行期错误（罕见）：兜底收割。
      // r46（review C7）：与其余终局路径（isError/timeout/cancel/finish）对称——补
      // timer 清理与 cwd 回收，防 mkdtemp 临时目录泄漏（timeoutTimer 有 finished
      // 守卫自无害，cwd 泄漏是真损失）
      this.proc!.child.on('error', () => {
        if (!this.finished) {
          this.finished = true
          clearTimeout(this.timeoutTimer)
          // r47-audit（M5 终局不对称）：其余四条终局（cancel/isError/timeout/spawn 窗口取消）均
          // reap，error 分支此前缺失——detached 进程组泄漏烧配额；且先收割再删 cwd（对齐
          // 上方 cancelled 分支顺序，防删正在运行进程的工作目录）
          this.proc?.reap()
          this.cleanupCwd()
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
        if (this.cancelled) break // 取消后迟到 meta 不发（r5：曾把取消任务 A 的 model 写上新任务 B 的气泡）
        this.meta = {
          model: ev.model ?? this.meta?.model,
          sessionId: ev.sessionId ?? this.meta?.sessionId,
        }
        // 记录会话 → cwd（追问轮 resume 需要同 cwd 才能找到会话）
        if (this.meta.sessionId && this.proc?.cwd) {
          // FIFO 上限：长寿进程不泄漏。size>0 时 next().value 必有值，
          // 但迭代器类型是 string | undefined——显式收窄（tsc 严格态）
          if (sessionCwds.size > 256) {
            const oldest = sessionCwds.keys().next().value
            if (oldest !== undefined) sessionCwds.delete(oldest)
          }
          sessionCwds.set(this.meta.sessionId, this.proc.cwd)
        }
        this.cb.onMeta(this.meta)
        break
      case 'text-delta':
        this.accText += ev.text
        if (!this.cancelled) this.bufferDelta(ev.text)
        break
      case 'usage':
        this.usage = ev
        break
      case 'result':
        if (this.cancelled) break
        if (ev.isError) { // claude 运行内失败：退出码 0 也判失败（硬约束 #4）
          this.finished = true
          this.doneSent = true
          clearTimeout(this.timeoutTimer)
          this.proc?.reap()
          this.cleanupCwd() // 不经过 finish()：isError 路径自回收 cwd（r4-impl）
          if (!this.input.resumeSessionId) this.historyPath ||= buildHistoryPath(new Date(), this.input.page.title)
          // 落盘完成再发终局：host 若在 persist 期间断连退出，错误轮历史不再丢失
          await this.persist('error')
          this.flushDelta() // isError 不经 finish()：终局前发完缓冲尾巴
          this.cb.onDone({
            historyPath: this.effectiveHistoryPath,
            isError: true,
            // r46（review C9）：无上限直接进帧——>1MB 时 encodeFrame throw、终局帧
            // 被静默丢弃、面板永久 running。截断保终局帧恒可达（历史读取路径已有
            // 同款截断，此处补齐不对称）；诊断用途下 4000 字符绰绰有余
            errorText: ev.text.slice(0, 4000),
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

  /** ≥8KB 立刻发，否则 50ms 定时发（终局前 flushDelta 兜底） */
  private bufferDelta(text: string): void {
    this.pendingDelta += text
    if (Buffer.byteLength(this.pendingDelta, 'utf8') >= 8192) this.flushDelta()
    else if (!this.deltaTimer) this.deltaTimer = setTimeout(() => this.flushDelta(), 50)
  }

  private flushDelta(): void {
    clearTimeout(this.deltaTimer)
    this.deltaTimer = undefined
    const text = this.pendingDelta
    this.pendingDelta = ''
    if (text && !this.cancelled && !this.superseded) this.sendChunk(text)
  }

  private sendChunk(text: string): void {
    // NM 单帧 ≤1MB（字节维度）：CJK UTF-8 每字符 3 字节，按字符数切会击穿上限——
    // 按 JSON 序列化后字节收缩切片。用 JSON.stringify 而非裸 Buffer.byteLength：
    // 帧最终是 JSON（\ → \\、" → \"、控制字符 → \uXXXX），转义密集页最坏 2x 膨胀，
    // 只测原文字节会让 encodeFrame 在 nm.ts 处 throw → chunk 静默丢失、正文缺段
    let start = 0
    for (;;) {
      let end = Math.min(start + MAX_CHUNK, text.length)
      while (end > start && Buffer.byteLength(JSON.stringify(text.slice(start, end))) > MAX_CHUNK) {
        end = Math.floor((start + end) / 2)
      }
      this.cb.onChunk(text.slice(start, end), this.chunkSeq++)
      if (end >= text.length) return
      start = end
    }
  }

  /** CLI 临时工作目录（mkdtemp）回收——固定工作区（stableCwd）与已被会话映射记录的 cwd 不删
   * （后续 resume 要用同 cwd）。isError/timeout/spawn 窗口期 cancel 不经过 finish()，各自补调（r4-impl） */
  private cleanupCwd(): void {
    const cwd = this.proc?.cwd
    if (cwd && cwd !== stableCwd && ![...sessionCwds.values()].includes(cwd)) {
      rm(cwd, { recursive: true, force: true }).catch(() => {})
    }
  }

  private async finish(code: number | null, signal: string | null, stderrTail: string, contentFile: string): Promise<void> {
    this.flushDelta() // 攒批兜底：终局前把缓冲里的尾部正文发完
    clearTimeout(this.timeoutTimer)
    this.cleanupCwd()
    const durationMs = Date.now() - this.startedAt
    if (!this.input.resumeSessionId) { // 追问轮不建新历史路径（append 首轮文件）
      this.historyPath ||= buildHistoryPath(new Date(), this.input.page.title)
    }
    // r8-host：只有 cancelled/SIGTERM（reap 专属）算「已取消」；SIGKILL 可能来自 OOM killer/手杀，按被杀上报以免误导排障
    if (this.cancelled || signal === 'SIGTERM') {
      await this.persist('interrupted')
      this.cb.onError('cancelled', 'task cancelled')
      return
    }
    // r37：Chrome→host→opencode（Bun）链释放的 JSC dylib 被内核打上 Chrome quarantine 归因，Gatekeeper 按「下载文件」评估拦杀；每次 hash 皆新，xattr/「仍要打开」均无效。
    // r37-ux：文案不再指挥用户去系统设置加豁免（普通用户不该被要求做系统级操作）——说明性归因 + 可行动建议=改用 claude/codex；豁免路径留给进阶用户自行检索
    const gate = this.input.agentId === 'opencode' && durationMs < 15_000 ? '；若屏幕弹出「Apple 无法验证 .dylib」：这是 macOS 对浏览器拉起的程序所释放运行组件的已知拦截（opencode 为实验档，组件每次都换新名，无法预先放行），非 PageDive 故障——建议改用 claude / codex 总结本页（不受此限制）' : ''
    if (signal === 'SIGKILL') {
      await this.persist('interrupted')
      this.cb.onError('parse', `killed by SIGKILL${stderrTail ? `: ${stderrTail.slice(-500)}` : ''}（可能被系统或用户终止）${gate}`)
      return
    }
    // 终局判定（r7-blocker：条件曾写反）：delivered=成功 result 已交付。① exit≠0 无 result → parse 错误（截断文本不得标成功）；② result 交付后 exit≠0 → 仍按成功（硬约束 #4：失败语义在 is_error 不在退出码）
    const delivered = this.gotResultOk && !!this.accText
    const isError = code !== 0 ? !delivered : !this.accText
    await this.persist(isError ? 'error' : 'done')
    if (code !== 0 && !delivered) {
      this.cb.onError('parse', `exit ${code}: ${stderrTail.slice(-500)}${gate}`)
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

  /** 终局回传历史路径：resume 轮用 input 首轮路径；首轮 saveHistory 失败回传空串——虚构路径会让追问轮凭空创建孤儿文件（r7-review） */
  private get effectiveHistoryPath(): string {
    return this.input.historyPath || (this.persistOk ? this.historyPath : '')
  }

  private async persist(status: 'done' | 'interrupted' | 'error'): Promise<void> {
    if (!this.input) return
    const logFail = (e: unknown) =>
      console.error(`[ai-page-dive] history persist failed (${this.effectiveHistoryPath}):`, e instanceof Error ? e.message : e)
    // 追问轮：user + assistant append 到首轮历史文件（多轮对话完整记录）
    if (this.input.resumeSessionId) {
      if (this.input.historyPath && this.accText) {
        await appendHistoryTurn(this.input.historyPath, {
          // r8-ux：纯附件追问轮兜底——空 user 段落盘后恢复会话时该轮凭空消失；
          // r12：附件以 [Image #N] 标记行落盘（恢复会话可还原带过哪些附件）
          user:
            attachMarkers(this.attachFiles) +
            (this.input.instruction ||
              (this.input.attachments?.length
                ? `（附件：${this.input.attachments.map((a) => a.name).join('、')}）`
                : '')),
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
      // r12：首轮带附件时以 pd:user 段先行落标记（恢复会话时附件轮次可还原）。r33-sec：accText 转义同 appendHistoryTurn
      (this.attachFiles.length ? `<!-- pd:user -->\n${attachMarkers(this.attachFiles)}\n` : '') + escapePd(this.accText),
    )
      .then((actual) => { // 冲突重试换了文件名：终局回传实际路径；成功才置 persistOk
        this.historyPath = actual
        this.persistOk = true
      })
      .catch(logFail)
    // r42：保留策略——首轮落盘后清理超出 historyLimit 的最旧历史（追问轮 append 不新增
    // 文件、无需清理；失败静默——清理失败不影响主流程，下次保存再清）
    await pruneHistory(this.input.historyLimit ?? 200).catch(() => {})
  }
}

/** 把正文文件软链进 CLI cwd（opencode 沙箱只准读 cwd） */
async function linkIntoCwd(contentFile: string, cwd: string): Promise<void> {
  try {
    await symlink(contentFile, join(cwd, basename(contentFile)))
  } catch { /* EEXIST 等：沙箱内已有同名，直接用 */ }
}
