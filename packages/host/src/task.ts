/** 任务编排：正文缓冲 → 临时文件 → prompt 组装（workflow 正文即任务段）→ spawn → 归一化事件 → ≤512KB chunk → 历史落盘。 */
import { chmod, mkdir, readdir, readlink, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { AgentEvent, TaskInput } from '@ai-page-dive/shared'
import { MAX_CHUNK } from './nmconst.js'
import { createClaudeParser } from './agents/claude.js'
import { createCodexParser } from './agents/codex.js'
import { getAgent, resolveBin } from './agents/registry.js'
import { getSkillBodies } from './skills.js'
import { appendHistoryTurn, buildHistoryPath, escapePd, pruneHistory, saveHistory } from './history.js'
import { attachMarkers, attachSection, buildOutline, buildPrompt, expandWorkflowPlaceholders } from './prompt.js'
import { spawnCli, type SpawnedProc } from './spawn.js'
import { scheduleCleanup, writeContentFile } from './tmpfile.js'
import { getWorkflow } from './workflows.js'

// r47-audit：测试钩子——env 覆写任务超时（缺省/非法值兜底 10min，默认行为零变化），供短超时回归测试复现孙进程持写端场景
const TASK_TIMEOUT_MS = Number(process.env.PAGEDIVE_TASK_TIMEOUT_MS) || 10 * 60_000

/** 固定 CLI 工作区（幂等创建）：claude 会话跨 host 重启可 resume 的关键。每次 mkdir：目录被误删后缓存短路会让后续 spawn 落在不存在 cwd 上 */
let stableCwd: string | null = null
async function getStableAgentCwd(): Promise<string> {
  const dir = join(homedir(), '.ai-page-dive', 'agent-workspace')
  // r55（#9）：0700 与 workflows/skills/attachments 同谱（历史 slug 可枚举面）；
  // chmod 收敛存量装机的历史 0755（recursive mkdir 对已存在目录是 no-op）
  await mkdir(dir, { recursive: true, mode: 0o700 }).catch(() => {})
  await chmod(dir, 0o700).catch((e) => e?.code !== 'ENOENT' && console.error('[ai-page-dive] chmod 收敛失败:', e?.message ?? e))
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
    unrecognized?: number
  }) => void
  onError: (code: 'spawn-fail' | 'timeout' | 'cancelled' | 'parse' | 'no-agent', message: string) => void
  /** r57（#24）：prune 实删了超限旧历史（removed>0）——触达 panel 的唯一信号 */
  onPruned?: (removed: number, limit: number) => void
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
  /** r51 A2③：流中未识别事件数（task-done 透出——CLI 版本漂移的第一信号） */
  private unrecognized = 0
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
    // r53（#8）：先清往轮附件软链——链接文件名内联 taskId 每轮唯一，stable agentCwd 不随任务
    // 清理，不清则无界累积。判据收窄到「指向 ~/.ai-page-dive/attachments 的符号链接」，用户/
    // CLI 自己放进工作区的东西一律不碰；本轮链接随后原位重建（幂等）
    if (agentCwd) {
      const attRoot = join(homedir(), '.ai-page-dive', 'attachments')
      try {
        for (const e of await readdir(agentCwd)) {
          const lp = join(agentCwd, e)
          try {
            if (!(await readlink(lp)).startsWith(attRoot)) continue
            await unlink(lp)
          } catch { /* 非符号链接/已不存在：跳过 */ }
        }
      } catch { /* agentCwd 不可读：跳过清扫不阻断 */ }
    }
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
        // r59（审计 T2）：mkdir mode 不罩已存在目录——附件根与 YYYYMM 双双 chmod 收敛存量 0755
        if (!madeDir) { await mkdir(dir, { recursive: true, mode: 0o700 }); await chmod(join(dir, '..'), 0o700).catch((e) => e?.code !== 'ENOENT' && console.error('[ai-page-dive] chmod 收敛失败:', e?.message ?? e)); await chmod(dir, 0o700).catch((e) => e?.code !== 'ENOENT' && console.error('[ai-page-dive] chmod 收敛失败:', e?.message ?? e)); madeDir = true }
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
  /** r58（#2）：spawn 失败真实错误（ENOENT 等）——spawnCli 的 reject 在 resolve 后是 no-op，经 onSpawnError 捕获 */
  spawnErr: Error | null = null

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
    // r58（#1）：组长先退守卫删除（同 reap 修正）——孙进程持组时照杀；组亡/无 pid 由 catch 吞
    const { child } = this.proc ?? {}
    try { process.kill(-child!.pid!, 'SIGKILL') } catch { /* gone */ }
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

    // workflow 正文即任务段：用户目录 shadow 内置，未命中走通用兜底文案（r58 #17）
    const wfName = this.input.workflow ?? 'quick'
    const wf = await getWorkflow(wfName)

    // 技能注入：非 resume 轮读取启用技能正文（读取失败的已在 getSkillBodies 内跳过）。
    // r49（#64-① 按任务注入）：quick 档跳过——「十几秒出要点」与技能增强指令互相
    // 冲突（每技能 ~450 token 拖慢首字），快速档零负担；其余档（默认/深度/论文/
    // 改写/自定义）保留注入。面板徽标同语义降透明提示（SummarizeView PageTips）
    const skillBodies = !isResume && wfName !== 'quick' && this.input.skills?.length
      ? await getSkillBodies(this.input.skills)
      : undefined

    const parser = def.streamFormat === 'claude-stream-json' ? createClaudeParser() : createCodexParser()

    // cwd 语义：claude 会话按 cwd 分区存储（~/.claude/projects/<编码>/），跨 host 重启
    // 必须可复现否则 --resume 报错——统一固定工作区。r57（#6）：filePathInPrompt 沙箱
    // 分支随 opencode 删除已零使用方，死代码连 linkIntoCwd/makeAgentCwd 一并删除
    const agentCwd = await getStableAgentCwd()
    // 占位符只展开 workflow 正文：用户 instruction 可能合法含 {xx} 字面量，不展开
    const wfBody = !isResume && wf?.body && !this.input.instruction
      ? expandWorkflowPlaceholders(wf.body, page, contentFile)
      : wf?.body
    // 大纲从内存正文提取（resume 轮上下文在 CLI 会话里，不需要）
    const outline = !isResume ? buildOutline(this.contentParts.join('')) : undefined
    // 附件：落盘（持久化）+ 软链 cwd，prompt 附件段给路径（resume 轮同样生效）
    this.attachFiles = await this.materializeAttachments(agentCwd)
    // r57（#12）：首轮 prompt 里的正文文件路径在终局已删——追问轮不声明的话，
    // 模型按会话记忆复读死路径，工具失败噪声直接伤追问质量
    const prompt = isResume
      ? '（注：首轮正文源文件已清理，请勿再尝试读取，直接基于会话已有内容作答。）\n' +
        attachSection(this.attachFiles) + (this.input.instruction ?? '')
      : buildPrompt(page, contentFile, wfName, this.input.instruction || wfBody, skillBodies, this.input.lang, outline, this.attachFiles)

    this.startedAt = Date.now()
    this.cb.onStatus('spawned')
    let stderrTail = ''
    try {
      this.proc = await spawnCli({
        bin: (await resolveBin(def)) ?? def.bin, // r59（审计 T3）：绝对路径 spawn——探测与执行同源，杜绝 PATH 影子面/探测版本≠执行版本
        args: def.buildArgs({ contentFile, agentCwd, resumeSessionId: this.input.resumeSessionId }),
        cwd: agentCwd,
        stdinData: prompt,
        onStdoutLine: (line) => {
          for (const ev of parser(line)) void this.handleEvent(ev, contentFile)
        },
        onStderr: (s) => {
          stderrTail = (stderrTail + s).slice(-2000)
        },
        onSpawnError: (err) => { this.spawnErr = err }, // r58（#2）：ENOENT 等异步 spawn 失败
      })
    } catch (e: any) {
      this.cleanupCwd(contentFile)
      this.cb.onError('spawn-fail', String(e?.message ?? e))
      return
    }

    // spawn 成功后又已取消（cancel 落在 await 窗口内）：立即收割 + 必发 onError——否则 tasks Map 不 delete、panel running 永真锁死
    if (this.cancelled) {
      this.proc.reap()
      this.cleanupCwd(contentFile)
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
        void (async () => {
          await this.persist('done') // 落盘完成再发终局（对齐 isError 路径的持久化语义）
          this.cb.onDone(this.doneInfo(false, Date.now() - this.startedAt))
        })()
        // r53（#4）：先收割再删 cwd——对齐 M5 不变量（error 分支注释自述），
        // 防删仍在运行进程的工作目录
        this.proc?.reap()
        this.cleanupCwd(contentFile)
        return
      }
      this.cb.onError('timeout', `task exceeded ${TASK_TIMEOUT_MS / 60_000}min`)
      // 部分输出落盘（对称于 cancel 路径）；不 await——persist 在事件循环里自然完成
      void this.persist('interrupted')
      // r53（#4）：先收割再删 cwd（M5 不变量，对齐 error/cancelled 分支）。收割挂死 CLI：
      // 走 cancel() 会被其 finished 守卫挡回（终局已前置），detached 进程组永久泄漏烧配额
      // （r9-review 实证）；cwd 不经过 finish() 由本路径自回收（r4-impl）
      this.proc?.reap()
      this.cleanupCwd(contentFile)
    }, TASK_TIMEOUT_MS)

    await new Promise<void>((resolve) => {
      // close 而非 exit（r33）：exit 即刻触发时 stdout 尾部（pipe 异步）未派发完，result 未到即 finish() 会误判 parse 失败
      this.proc!.child.on('close', async (code, signal) => {
        if (this.finished || this.doneSent || this.timeoutSent) return resolve() // isError/timeout/error 已发终局勿重复（r11：error 后仍可触 exit）
        this.finished = true
        // r58（#2）：负退出码 = spawn 失败（UV errno，ENOENT=-2；实测 error 先于 close，此为事件序兜底）——防 parse 误判
        if (code !== null && code < 0) {
          clearTimeout(this.timeoutTimer)
          this.cleanupCwd(contentFile)
          this.cb.onError('spawn-fail', this.spawnErr ? String(this.spawnErr.message ?? this.spawnErr) : `spawn error (${code})`)
          return resolve()
        }
        await this.finish(code, signal, stderrTail, contentFile)
        resolve()
      })
      // spawn 成功后的运行期错误（罕见）：兜底收割。r46 C7：与其余终局对称——timer
      // 清理与 cwd 回收防 mkdtemp 临时目录泄漏（cwd 泄漏是真损失）
      this.proc!.child.on('error', (err) => {
        if (!this.finished) {
          this.finished = true
          clearTimeout(this.timeoutTimer)
          // r47-audit M5：先 reap 再删 cwd（对齐 cancelled 序，防删运行中进程的工作目录）
          this.proc?.reap()
          this.cleanupCwd(contentFile)
          // r72 C8：对称补齐 flush+persist（漏发则错误轮输出凭空消失）；零产出守卫
          // r76 收敛进 persist 单点（与 spawn-fail 同谱：空历史污染列表）
          this.flushDelta()
          void this.persist('interrupted')
          resolve()
          // r58（#2）：真实错误直达诊断（如 ENOENT）。r76（r75 medium#3）：运行期崩溃
          // 拆 'runtime-error' 码——spawn 已成功，复用 spawn-fail 会把用户引向重装错向
          this.cb.onError(this.spawnErr ? 'spawn-fail' : 'runtime-error', String((this.spawnErr ?? err) instanceof Error ? (this.spawnErr ?? err).message : (this.spawnErr ?? err)))
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
      case 'unrecognized':
        this.unrecognized++
        break
      case 'meta':
        if (this.cancelled) break // 取消后迟到 meta 不发（r5：曾把取消任务 A 的 model 写上新任务 B 的气泡）
        this.meta = {
          model: ev.model ?? this.meta?.model,
          sessionId: ev.sessionId ?? this.meta?.sessionId,
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
          this.cleanupCwd(contentFile) // 不经过 finish()：isError 路径自回收 cwd（r4-impl）
          // 落盘完成再发终局：host 若在 persist 期间断连退出，错误轮历史不再丢失。
          // r76：错误文案入册 body 首段（此前只进面板帧，面板错过即历史零痕迹）
          await this.persist('error', ev.text.slice(0, 4000))
          this.flushDelta() // isError 不经 finish()：终局前发完缓冲尾巴
          // errorText 截 4000：r46（review C9）——无上限直接进帧会在 >1MB 时 encodeFrame
          // throw、终局帧被静默丢弃、面板永久 running；诊断用途下 4000 字符绰绰有余
          this.cb.onDone(this.doneInfo(true, Date.now() - this.startedAt, ev.text.slice(0, 4000)))
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
    // 只测原文字节会让 encodeFrame 在 nm.ts 处 throw → chunk 静默丢失、正文缺段。
    // r71（r70 code L13）：码元切点不做边界回退——分片拼回无损，截断类（stdio 收缩）才须回退，两谱刻意不同
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

  /** 正文临时文件的终局回收。r56（#2）：rm(contentFile) 从 5 散点收敛到此——a35d671 漏了
   * is_error 与超时已交付两终局，PRIVACY「任务结束即删」曾在主失败通道为假。r57（#6）：
   * mkdtemp cwd 回收分支随 filePathInPrompt 死代码删除——cwd 恒固定工作区 */
  private cleanupCwd(contentFile?: string): void {
    if (contentFile) rm(contentFile, { force: true }).catch(() => {})
  }

  private async finish(code: number | null, signal: string | null, stderrTail: string, contentFile: string): Promise<void> {
    this.flushDelta() // 攒批兜底：终局前把缓冲里的尾部正文发完
    clearTimeout(this.timeoutTimer)
    this.cleanupCwd(contentFile)
    const durationMs = Date.now() - this.startedAt
    // r8-host：只有 cancelled/SIGTERM（reap 专属）算「已取消」；SIGKILL 可能来自 OOM killer/手杀，按被杀上报以免误导排障
    if (this.cancelled || signal === 'SIGTERM') {
      await this.persist('interrupted')
      this.cb.onError('cancelled', 'task cancelled')
      return
    }
    // r37 的 opencode Gatekeeper 文案随适配器删除（r55，DECISIONS D5 修订）——r37 排障
    // 记录见 git 历史
    if (signal === 'SIGKILL') {
      await this.persist('interrupted')
      this.cb.onError('parse', `killed by SIGKILL${stderrTail ? `: ${stderrTail.slice(-500)}` : ''}（可能被系统或用户终止）`)
      return
    }
    // 终局判定（r7-blocker：条件曾写反）：delivered=成功 result 已交付。① exit≠0 无 result → parse 错误（截断文本不得标成功）；② result 交付后 exit≠0 → 仍按成功（硬约束 #4：失败语义在 is_error 不在退出码）
    const delivered = this.gotResultOk && !!this.accText
    const isError = code !== 0 ? !delivered : !this.accText
    await this.persist(isError ? 'error' : 'done')
    if (code !== 0 && !delivered) {
      this.cb.onError('parse', `exit ${code}: ${stderrTail.slice(-500)}`)
    } else if (!this.accText) {
      // r51-review P2-③ 收尾 + 深审修正 altitude：no output 且流里有未识别事件，大概率是
      // CLI 版本高于解析器实测（格式漂移）而非真没输出——用户气泡只给用户向归因与反馈
      // 指引（重采样命令是维护者动作，已挪到扩展端 console.debug 排障信号里）
      this.cb.onError('parse', `no output${stderrTail ? `: ${stderrTail.slice(-500)}` : ''}${this.unrecognized ? `（流含 ${this.unrecognized} 个未识别事件——CLI 版本可能高于适配器实测，请到项目仓库反馈）` : ''}`)
    } else {
      this.cb.onDone(this.doneInfo(false, durationMs))
    }
  }

  /** r62 审计（code #6）：终局 payload 单源构造——此前三处手写曾是 r51 超时路径漏带
   * unrecognized 的根因；可选字段零防线，新增终局字段只改这里 */
  private doneInfo(isError: boolean, durationMs: number, errorText?: string): Parameters<TaskCallbacks['onDone']>[0] {
    return {
      historyPath: this.effectiveHistoryPath,
      isError,
      errorText,
      usage: this.usage,
      durationMs,
      model: this.meta?.model,
      sessionId: this.meta?.sessionId,
      unrecognized: this.unrecognized || undefined,
    }
  }

  /** 终局回传历史路径：resume 轮用 input 首轮路径；首轮 saveHistory 失败回传空串——虚构路径会让追问轮凭空创建孤儿文件（r7-review） */
  private get effectiveHistoryPath(): string {
    return this.input.historyPath || (this.persistOk ? this.historyPath : '')
  }

  private async persist(status: 'done' | 'interrupted' | 'error', errorText = ''): Promise<void> {
    if (!this.input) return
    // r76（r75 code medium#2）：零产出守卫单点——空正文无附件无错误文案不落盘
    // （空体文件污染历史列表；timeout/finish/:328 调用点同守）。is_error 传
    // errorText 例外：零产出失败轮也留排障痕迹
    if (!this.accText && !this.attachFiles.length && !errorText) return
    const logFail = (e: unknown) =>
      console.error(`[ai-page-dive] history persist failed (${this.effectiveHistoryPath}):`, e instanceof Error ? e.message : e)
    // 追问轮：user + assistant append 到首轮历史文件（多轮对话完整记录）
    if (this.input.resumeSessionId) {
      if (this.input.historyPath && (this.accText || errorText)) {
        await appendHistoryTurn(this.input.historyPath, {
          // r8-ux：纯附件追问轮兜底——空 user 段落盘后恢复会话时该轮凭空消失；
          // r12：附件以 [Image #N] 标记行落盘（恢复会话可还原带过哪些附件）
          user:
            attachMarkers(this.attachFiles) +
            (this.input.instruction ||
              (this.input.attachments?.length
                ? `（附件：${this.input.attachments.map((a) => a.name).join('、')}）`
                : '')),
          assistant: this.accText + (errorText ? `\n\n> ⚠️ ${errorText}` : ''),
        }).catch(logFail)
      }
      return
    }
    // 首轮路径统一在此生成（r74：child 运行期 error 分支曾漏生成——saveHistory('') 必败，
    // 有产出轮静默丢失落盘；四处终局调用点的重复 ||= 随之收敛到此）
    this.historyPath ||= buildHistoryPath(new Date(), this.input.page.title)
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
        // r54（#11）：输入体量观测——正文实际送达字符数落 frontmatter，为校准 MAX_CONTENT
        // 攒真实分布（200,000 恒值=触顶信号）；0/未传正文不落键
        contentChars: this.contentChars || undefined,
        // r53（#7）：附件路径记档——deleteHistory 据此连带删正文
        attachments: this.attachFiles.length ? this.attachFiles.map((f) => f.path) : undefined,
      },
      // r12：首轮带附件时以 pd:user 段先行落标记（恢复会话时附件轮次可还原）。r33-sec：accText
      // 转义同 appendHistoryTurn；r54（#6）：附件标记行同样过 escapePd——APFS 文件名可含 pd 标记
      // 字样，两路转义口径对称，防恢复会话时轮边界被附件名伪造
      (errorText ? `> ⚠️ ${escapePd(errorText)}\n\n` : '') +
      (this.attachFiles.length ? `<!-- pd:user -->\n${escapePd(attachMarkers(this.attachFiles))}\n` : '') + escapePd(this.accText),
    )
      .then((actual) => { // 冲突重试换了文件名：终局回传实际路径；成功才置 persistOk
        this.historyPath = actual
        this.persistOk = true
      })
      .catch(logFail)
    // r42：保留策略——首轮落盘后清理超出 historyLimit 的最旧历史（追问轮 append 不新增
    // 文件、无需清理；失败静默——清理失败不影响主流程，下次保存再清）。
    // r57（#24）：实删计数上报——静默永久删除两周后回查「不存在」且无人知晓是可调的
    const pruned = await pruneHistory(this.input.historyLimit ?? 200).catch(() => 0)
    if (pruned > 0) this.cb.onPruned?.(pruned, this.input.historyLimit ?? 200)
  }
}
