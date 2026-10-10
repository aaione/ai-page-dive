/**
 * sw.ts 回归测试网（r52 排期，报告 #2）——807 行并发编排此前零覆盖，注释链
 * （r6/r8/r12/r15/r30/r46/r47/r52）记录的恰恰是真机手测发现的已修 bug。
 * 本网先锚五个历史修复：
 * ①session-lost 冷唤醒竞态（r52 P1：persist 必须晚于 restoreSession 的宏任务级
 *   storage.get——用可注入延迟的 storage.get 模拟竞态窗，修复前代码会用空内存态
 *   全量覆写持久化会话）
 * ②断连清 currentTask + __host-disconnected 带 taskId（r6-sec）
 * ③丢片对账：content-received 数目不符 → cancel + content-mismatch（r8-review）
 * ④分片 ≤ MAX_CHUNK：JSON 字节口径（转义密集正文强制走二分收缩）+ done 片 total
 * ⑤onClicked 同步契约：open 只认同步手势、toggle 广播先于 anchor、setOptions 先于
 *   open（r15/r30-2），状态提交挪恢复完成后（r52）
 *
 * 手法：chrome 全局 shim + vi.mock nmport（SW 侧唯一 IO 依赖，Proxy 转发到每次
 * boot 换新的实例）。sw.ts 是副作用模块（import 即注册 listener + 发起顶层
 * restoreSession）——vi.resetModules 每用例重挂。
 */
import { describe, expect, it, vi } from 'vitest'
import { MAX_CHUNK } from '@ai-page-dive/shared'

const nmState: { port: any } = { port: null as any }
vi.mock('../lib/nmport.js', () => ({
  nmPort: new Proxy(
    {},
    {
      get: (_t, k: string) => {
        const v = nmState.port?.[k]
        return typeof v === 'function' ? (...a: unknown[]) => v(...a) : v
      },
    },
  ),
}))

type Deferred = { p: Promise<Record<string, any>>; res: (v: Record<string, any>) => void }
const defer = (): Deferred => {
  const d = {} as Deferred
  d.p = new Promise((res) => (d.res = res))
  return d
}

const PAGE = { url: 'https://x/art', title: 'Art', extractor: 'test', approxTokens: 7 }
const CLAUDE_SESS = { agentId: 'claude', sessionId: 's-111' }

async function boot(opts: { seed?: Record<string, any>; seedLocal?: Record<string, any>; slowGets?: number; hostVersion?: string; receiverOnline?: boolean; activeUrl?: string; queryTab?: Record<string, any> } = {}) {
  const calls = {
    /** runtime.sendMessage 全部广播（含任务帧转发） */
    sent: [] as any[],
    /** 跨 API 全序（k: send/setOptions/open/persist）——锚「先于」类断言 */
    order: [] as { k: string; v?: unknown }[],
    storageSet: [] as any[],
    setOptions: [] as any[],
    open: [] as any[],
    badge: [] as any[],
    /** tabs.query 入参序列（windowId 过滤断言用） */
    queries: [] as any[],
    nmSent: [] as any[],
    nmHandlers: [] as Array<(m: any) => void>,
    nmDisconnect: [] as Array<() => void>,
  }
  const store: Record<string, any> = { ...(opts.seed ?? {}) }
  // r55（#10）：storage.local 独立于 session（跨扩展重载存活）——孤儿任务指针域
  const localStore: Record<string, any> = { ...(opts.seedLocal ?? {}) }
  let slowLeft = opts.slowGets ?? 0
  const pending: Deferred[] = []
  const snapshot = () => ({ ...store })

  const listeners = (arr: any[]) => ({
    addListener: (f: any) => arr.push(f),
    removeListener: (f: any) => {
      const i = arr.indexOf(f)
      if (i >= 0) arr.splice(i, 1)
    },
  })
  const onClicked: any[] = []
  const onActivated: any[] = []
  const onCreated: any[] = []
  const onUpdated: any[] = []
  const onRemoved: any[] = []
  const onMessageL: any[] = []
  const tabsDb = new Map<number, any>([[5, { id: 5, windowId: 1, url: 'https://a/5', title: 'A' }]])

  const chrome: any = {
    runtime: {
      id: 'test-ext-id',
      // r53（#1）横幅钉版用：与仓库版本同步的假 manifest
      getManifest: () => ({ version: '0.1.4' }),
      onMessage: listeners(onMessageL),
      sendMessage: (m: any) => {
        calls.sent.push(m)
        calls.order.push({ k: 'send', v: m?.t })
        // r58 #5：默认无接收端（面板收起常态——真机 sendMessage reject），emitTerminal
        // 的入箱判据靠它；receiverOnline 模拟 panel listener 在听（有接收端不入箱）
        return opts.receiverOnline ? Promise.resolve() : Promise.reject(new Error('Receiving end does not exist'))
      },
    },
    storage: {
      session: {
        get: async (_keys: string[]) => {
          if (slowLeft > 0) {
            slowLeft--
            const d = defer()
            pending.push(d)
            return d.p
          }
          return snapshot()
        },
        set: (obj: any) => {
          calls.storageSet.push(obj)
          calls.order.push({ k: 'persist' })
          Object.assign(store, obj)
          return Promise.resolve()
        },
      },
      local: {
        get: async (k: string) => (k in localStore ? { [k]: localStore[k] } : {}),
        set: (obj: any) => {
          Object.assign(localStore, obj)
          return Promise.resolve()
        },
        remove: (k: string) => {
          delete localStore[k]
          return Promise.resolve()
        },
      },
    },
    action: {
      onClicked: listeners(onClicked),
      setBadgeText: (o: any) => {
        calls.badge.push(o)
        return Promise.resolve()
      },
    },
    sidePanel: {
      setPanelBehavior: () => Promise.resolve(),
      setOptions: (o: any) => {
        calls.setOptions.push(o)
        calls.order.push({ k: 'setOptions', v: o })
        return Promise.resolve()
      },
      open: (o: any) => {
        calls.open.push(o)
        calls.order.push({ k: 'open', v: o })
        return Promise.resolve()
      },
    },
    tabs: {
      onActivated: listeners(onActivated),
      onCreated: listeners(onCreated),
      onUpdated: listeners(onUpdated),
      onRemoved: listeners(onRemoved),
      get: async (id: number) => tabsDb.get(id) ?? null,
      // r69：带 windowId 的 query（panel-ready 异窗锚界定）从 tabsDb 取该窗页签，
      // 无匹配退默认活跃页（老用例零改动）；queryTab 可覆写默认活跃页（r68 code#3
      // 误杀向用例——mock 恒返 11 时 seed 22 的「零 cancel」断言无鉴别力）
      query: async (q?: any) => {
        calls.queries.push(q)
        if (q?.windowId != null) {
          const inWin = [...tabsDb.values()].filter((t: any) => t.windowId === q.windowId)
          if (inWin.length) return inWin
        }
        return [opts.queryTab ?? { id: 11, windowId: 2, url: opts.activeUrl ?? 'https://x/active', title: 'Active' }]
      },
    },
    scripting: {
      // 第 1 次 = content.js files 注入；之后 = func 提取（默认正文可被各用例覆写）
      executeScript: vi.fn().mockResolvedValueOnce([]).mockResolvedValue([{ result: { ...PAGE, contentMarkdown: 'x' } }]),
    },
  }
  ;(globalThis as any).chrome = chrome
  nmState.port = {
    // r61（代码审）：mock 对齐 NmPort 真实接口——sw 的 bare-cancel 守卫读 connected；
    // 用例内可覆写为 false 模拟断连（host 已死不拉空）
    connected: true,
    send: (m: any) => {
      calls.nmSent.push(m)
      return true
    },
    onMessage: (h: (m: any) => void) => calls.nmHandlers.push(h),
    onDisconnect: (h: () => void) => calls.nmDisconnect.push(h),
    lastError: '',
    probe: async () => ({ ok: true, hostVersion: opts.hostVersion ?? '9.9.9' }),
  }

  vi.resetModules()
  await import('./sw.js')

  // 放开延迟并解决所有挂起的 storage.get，让被测逻辑走完宏任务
  const flush = async () => {
    slowLeft = 0
    while (pending.length) pending.shift()!.res(snapshot())
    await new Promise((r) => setTimeout(r, 20))
  }
  const fireMessage = (msg: any, sender: any = { id: chrome.runtime.id }) =>
    new Promise<any>((resolve) => {
      onMessageL.at(-1)!(msg, sender, resolve)
    })
  return {
    chrome,
    calls,
    local: localStore,
    /** r69：tabs.get/query(windowId) 的可写 tab 台账——异窗锚/内容源用例注入页签 */
    tabs: tabsDb,
    flush,
    fireMessage,
    fireNm: (m: any) => calls.nmHandlers.forEach((h) => h(m)),
    fireDisconnect: () => calls.nmDisconnect.forEach((h) => h()),
    events: {
      onClicked: (tab: any) => onClicked.forEach((f) => f(tab)),
      onRemoved: (tabId: number) => onRemoved.forEach((f) => f(tabId)),
      onActivated: (info: any) => onActivated.forEach((f) => f(info)),
      onCreated: (tab: any) => onCreated.forEach((f) => f(tab)),
    },
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('sw.ts 回归网', () => {
  it('冷唤醒竞态：非锚 tab 关闭的 persist 必须等恢复完成——持久化会话不得被空内存态覆写（r52 P1）', async () => {
    const h = await boot({
      seed: { sessions: [[5, CLAUDE_SESS]], panelTabId: 5, panelWindowId: 1, currentAgentId: 'claude' },
      slowGets: 3,
    })
    // 冷唤醒：顶层 restoreSession 的 storage.get 仍挂起（宏任务竞态窗），此时关掉非锚 tab
    h.events.onRemoved(9)
    await wait(50)
    // 竞态锚点：恢复未完成不得 persist——修复前此处已用空 sessions 全量覆写持久化
    expect(h.calls.storageSet.length).toBe(0)
    await h.flush()
    expect(h.calls.storageSet.length).toBe(1)
    // r46 C1：非锚关闭也落盘，但落的是「恢复后的内存态」——种子会话幸存
    expect(h.calls.storageSet[0].sessions).toEqual([[5, CLAUDE_SESS]])
    expect(h.calls.storageSet[0].panelTabId).toBe(5)
  })

  it('自家页面开在普通 tab 的消息不被拒收，外来扩展仍拒（r58 N4）', async () => {
    const h = await boot({})
    // 历史页等自家页面以 chrome.tabs.create 打开——其 runtime.sendMessage 的
    // sender 带 tab。旧守卫 sender.tab != null 直接丢弃：自家页面一旦开进 tab
    // 即静默失联。panel-ready 有响应即证明消息被处理
    const resp = await Promise.race([
      h.fireMessage({ t: 'panel-ready' }, { id: chrome.runtime.id, tab: { id: 7 } }),
      wait(500).then(() => 'DROPPED'),
    ])
    expect(resp).not.toBe('DROPPED')
    expect((resp as any).ok).toBe(true)
    // 守卫收窄后安全属性不回退：外来扩展同形消息仍无响应（无特权操作触发）
    const foreign = await Promise.race([
      h.fireMessage({ t: 'cancel' }, { id: 'other-extension' }),
      wait(300).then(() => 'NO-RESPONSE'),
    ])
    expect(foreign).toBe('NO-RESPONSE')
  })

  it('冷唤醒竞态：resume-history 先恢复再落盘——新会话写进恢复出的锚页签', async () => {
    const h = await boot({ seed: { sessions: [[5, CLAUDE_SESS]], panelTabId: 5, panelWindowId: 1 }, slowGets: 3 })
    const resp = h.fireMessage({ t: 'resume-history', agentId: 'codex', sessionId: 'sx-2' })
    await wait(50)
    expect(h.calls.storageSet.length).toBe(0) // 同上：恢复前不得 persist
    await h.flush()
    expect(await resp).toEqual({ ok: true })
    // 修复前 panelTabId 尚未恢复（null）→ sessions.set 被跳过 → 落盘丢掉全部会话
    expect(h.calls.storageSet.at(-1).sessions).toEqual([[5, { agentId: 'codex', sessionId: 'sx-2' }]])
  })

  it('断连：清 currentTask + __host-disconnected 广播带 taskId（r6-sec）', async () => {
    const h = await boot({ seed: { sessions: [[5, CLAUDE_SESS]], panelTabId: 5, panelWindowId: 1 } })
    const r1 = await h.fireMessage({ t: 'summarize', followUp: true, instruction: '继续' })
    expect(r1.ok).toBe(true)
    const tid = r1.taskId
    expect(h.calls.nmSent[0]).toMatchObject({ t: 'task-start', task: { taskId: tid, resumeSessionId: 's-111' } })
    h.fireDisconnect()
    expect(h.calls.sent.find((m) => m.t === '__host-disconnected')).toMatchObject({ taskId: tid })
    // 句柄已清：下一轮 followUp 不被「已有在跑」误挡，拿到新 taskId
    const r2 = await h.fireMessage({ t: 'summarize', followUp: true, instruction: '再来' })
    expect(r2.ok).toBe(true)
    expect(r2.taskId).not.toBe(tid)
  })

  it('分片 ≤ MAX_CHUNK（JSON 字节口径，转义密集正文强制走二分收缩）+ done 片 total 对账', async () => {
    const h = await boot()
    // 60 万原始字符、JSON 转义后 ~1.2MB：首个 512K 字符切片按字节口径必然超限，
    // 必须二分收缩（只按原文字节分片会击穿 NM 1MB 帧限——r8 家族坑）
    const HEAVY = '"\\\n'.repeat(200_000)
    ;(h.chrome.scripting.executeScript as any).mockResolvedValue([{ result: { ...PAGE, contentMarkdown: HEAVY } }])
    const r = await h.fireMessage({ t: 'summarize', agentId: 'claude', workflow: 'quick' })
    expect(r.ok).toBe(true)
    const chunks = h.calls.nmSent.filter((m) => m.t === 'task-content')
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) {
      expect(new Blob([JSON.stringify(c.text)]).size).toBeLessThanOrEqual(MAX_CHUNK)
    }
    expect(h.calls.nmSent[0].t).toBe('task-start')
    expect(chunks.at(-1).done).toBe(true)
    expect(chunks.at(-1).total).toBe(HEAVY.length)
  })

  it('r56 #4：旧任务的迟到注入失败不清新任务句柄——task2 不被击穿成 cancelled', async () => {
    const h = await boot()
    // task1 的 content.js 注入挂起；task2 随后发起（入口收割 task1、接管 currentTask）。
    // 修复前：task1 注入失败晚归时无条件 currentTask = null → task2 在归位守卫处
    // 折算 { error: 'cancelled' }——迟到失败杀活任务
    let rej1!: (e: Error) => void, res2!: (v: any) => void
    ;(h.chrome.scripting.executeScript as any)
      .mockReset()
      .mockImplementationOnce(() => new Promise((_, re) => { rej1 = re })) // task1 注入（挂起）
      .mockImplementationOnce(() => Promise.resolve([])) // task2 注入
      .mockImplementationOnce(() => new Promise((re) => { res2 = re })) // task2 提取（挂起）
    const p1 = h.fireMessage({ t: 'summarize', agentId: 'claude', workflow: 'quick' })
    await wait(10)
    const p2 = h.fireMessage({ t: 'summarize', agentId: 'claude', workflow: 'quick' })
    await wait(10)
    rej1(new Error('frame went away')) // 旧任务注入失败晚归
    expect(await p1).toMatchObject({ error: 'no-permission' })
    res2([{ result: { ...PAGE, contentMarkdown: 'y' } }])
    const r2 = await p2
    expect(r2.ok).toBe(true)
    // nmSent[0] 是入口收割 task1 的 task-cancel；task2 自己的 task-start 必须发出
    const start = h.calls.nmSent.find((m: any) => m.t === 'task-start')
    expect(start?.task?.taskId).toBe(r2.taskId)
  })

  it('r56 #10：正文来自 iframe 时 task-start 携带顶层 tab 的 url/title（不以内帧失锚）', async () => {
    const h = await boot()
    // allFrames 择优可能选中内帧——提取结果的 url/title 是 frame 级（location.href/内帧
    // 标题）；历史 frontmatter 与 tips 必须锚在用户视角的顶层页（tabs.query 的活跃 tab）
    ;(h.chrome.scripting.executeScript as any).mockResolvedValue([
      { result: { ...PAGE, url: 'https://embed.frame.io/i.html', title: '内帧标题', contentMarkdown: 'z' } },
    ])
    const r = await h.fireMessage({ t: 'summarize', agentId: 'claude', workflow: 'quick' })
    expect(r.ok).toBe(true)
    expect(h.calls.nmSent[0].task.page.url).toBe('https://x/active')
    expect(h.calls.nmSent[0].task.page.title).toBe('Active')
    expect(h.calls.sent.find((m: any) => m.t === 'page-meta').page.title).toBe('Active')
  })

  it('丢片对账：content-received 数目相符静默；不符 → task-cancel + content-mismatch（r8-review）', async () => {
    const h = await boot()
    const BODY = 'x'.repeat(1200)
    ;(h.chrome.scripting.executeScript as any).mockResolvedValue([{ result: { ...PAGE, contentMarkdown: BODY } }])
    const r = await h.fireMessage({ t: 'summarize', agentId: 'claude', workflow: 'quick' })
    const tid = r.taskId
    h.fireNm({ t: 'content-received', taskId: tid, chars: BODY.length })
    await wait(20)
    expect(h.calls.nmSent.filter((m) => m.t === 'task-cancel')).toEqual([])
    expect(h.calls.sent.filter((m) => m.t === 'task-error')).toEqual([])
    // 半截正文会被 CLI 总结得有模有样，比失败更误导——必须取消
    h.fireNm({ t: 'content-received', taskId: tid, chars: 3 })
    await wait(20)
    expect(h.calls.nmSent).toContainEqual({ t: 'task-cancel', taskId: tid })
    expect(h.calls.sent.find((m) => m.t === 'task-error')).toMatchObject({ taskId: tid, code: 'content-mismatch' })
  })

  it('onClicked 同步契约：open 同步发出、toggle 先于 anchor 广播、per-tab setOptions 先于 open（r15/r30-2），锚定态在恢复后才提交（r52）', async () => {
    const h = await boot({ slowGets: 2 })
    h.events.onClicked({ id: 5, windowId: 1, url: 'https://a/5', title: 'A' })
    // —— 同步段（user gesture 窗口内，恢复未完成也必须完成锚定+open）——
    const idx = (k: string, pred?: (v: any) => boolean) =>
      h.calls.order.findIndex((e) => e.k === k && (!pred || pred(e.v)))
    expect(h.calls.open).toEqual([{ tabId: 5 }])
    expect(idx('send', (v) => v === 'panel-toggle')).toBeLessThan(idx('send', (v) => v === 'panel-anchor'))
    expect(idx('setOptions', (v: any) => v.tabId === 5 && v.enabled)).toBeLessThan(idx('open'))
    // —— 状态提交挪到恢复完成后（冷唤醒时旧锚此刻才回来，换锚判定才有据）——
    expect(h.calls.storageSet.length).toBe(0)
    await h.flush()
    expect(h.calls.storageSet.at(-1)).toMatchObject({ panelTabId: 5, panelWindowId: 1 })
  })

  it('heartbeat 转译 task-alive（taskId/tabId/elapsedMs）+ task-done 终局清任务位并打 ✓ 角标（r16）', async () => {
    const h = await boot({ seed: { sessions: [[5, CLAUDE_SESS]], panelTabId: 5, panelWindowId: 1 } })
    const r1 = await h.fireMessage({ t: 'summarize', followUp: true, instruction: '继续' })
    const tid = r1.taskId
    h.fireNm({ t: 'heartbeat' })
    const aliveMsg = h.calls.sent.find((m) => m.t === 'task-alive')
    expect(aliveMsg).toMatchObject({ taskId: tid, tabId: 5 })
    expect(typeof aliveMsg.elapsedMs).toBe('number')
    h.fireNm({ t: 'task-done', taskId: tid, agentId: 'claude', sessionId: 's-111' })
    expect(h.calls.badge).toContainEqual({ text: '✓' })
    // 终局后任务位已清：新一轮 followUp 拿到新 taskId
    const r2 = await h.fireMessage({ t: 'summarize', followUp: true, instruction: '再问' })
    expect(r2.taskId).not.toBe(tid)
  })

  it('isError 角标：isError=true 的 done 打 !——CLI 运行内失败不得误报成功 ✓（r53 #1/#2）', async () => {
    const h = await boot({ seed: { sessions: [[5, CLAUDE_SESS]], panelTabId: 5, panelWindowId: 1 } })
    const r = await h.fireMessage({ t: 'summarize', followUp: true, instruction: 'x' })
    h.fireNm({ t: 'task-done', taskId: r.taskId, agentId: 'claude', isError: true, errorText: '运行内失败' })
    expect(h.calls.badge).toContainEqual({ text: '!' })
    expect(h.calls.badge).not.toContainEqual({ text: '✓' })
  })

  // r57 盲区5（不变式④）：收件箱条随页签消亡——tab 复用同 id 的新会话不收过期终局。
  // 锚 tab 关闭会连带 panelTabId=null 掩蔽读取面，故走非锚 tab + 落盘证据（r46 C1 骨架）
  it('r57 盲区5：非锚 tab 关闭 → 其收件箱条随删（落盘证据），锚 tab 条目不受牵连', async () => {
    const frame5 = { t: 'task-error', taskId: 'keep-1', code: 'timeout', tabId: 5 }
    const h = await boot({
      seed: {
        lastTerminals: [[5, frame5], [9, { t: 'task-error', taskId: 'old-9', code: 'parse', tabId: 9 }]],
        panelTabId: 5,
        panelWindowId: 1,
      },
    })
    await h.flush() // 种子恢复完成
    h.events.onRemoved(9)
    await h.flush()
    // 9 的条目随页签消亡；5（锚）的条目不受非锚关闭牵连
    expect(h.calls.storageSet.at(-1).lastTerminals).toEqual([[5, frame5]])
  })

  it('task-error（currentTask 匹配）打 ! 角标 + 面板收起期间的错过进 lastTerminals 收件箱（r53 #1/#5）', async () => {
    const h = await boot({ seed: { sessions: [[5, CLAUDE_SESS]], panelTabId: 5, panelWindowId: 1 } })
    const r = await h.fireMessage({ t: 'summarize', followUp: true, instruction: 'x' })
    h.fireNm({ t: 'task-error', taskId: r.taskId, code: 'timeout', message: '超时' })
    expect(h.calls.badge).toContainEqual({ text: '!' })
    // 广播帧无接收端是常态（面板收起）——SW 必须记收件箱，重开面板一次性补发
    const st = await h.fireMessage({ t: 'panel-ready' })
    expect(st.missedTerminal).toMatchObject({ t: 'task-error', taskId: r.taskId, code: 'timeout', tabId: 5 })
    // 消费即清：再次 panel-ready 不重复补发
    const st2 = await h.fireMessage({ t: 'panel-ready' })
    expect(st2.missedTerminal).toBeUndefined()
  })

  // r57（#4/#14）：SW 自合成的三路终局（连坐取消/断连/丢片）此前只广播——面板
  // 收起即丢，重开零交代；丢片帧还缺 tabId 邮戳（提前 return 盖不到统一 stamp）
  it('r57 #4/#14：SW 合成终局（取消/断连/丢片）入收件箱 + mismatch 帧盖 tabId 邮戳', async () => {
    // —— 连坐取消：锚 5 在跑追问，再起一轮收割它——收件箱留 cancelled 交代 ——
    const h = await boot({ seed: { sessions: [[5, CLAUDE_SESS]], panelTabId: 5, panelWindowId: 1 } })
    const r1 = await h.fireMessage({ t: 'summarize', followUp: true, instruction: 'x' })
    const r2 = await h.fireMessage({ t: 'summarize', followUp: true, instruction: 'y' })
    expect(r2.ok).toBe(true)
    expect((await h.fireMessage({ t: 'panel-ready' })).missedTerminal).toMatchObject({ taskId: r1.taskId, code: 'cancelled', tabId: 5 })
    // —— 断连：在跑任务随 host 连接死亡 → 收件箱留 host-disconnected ——
    h.fireDisconnect()
    expect((await h.fireMessage({ t: 'panel-ready' })).missedTerminal).toMatchObject({ taskId: r2.taskId, code: 'host-disconnected', tabId: 5 })
    // —— 丢片：mismatch 终局帧自带 tabId 邮戳 + 入箱（panel-ready 已把 target 锚到
    //    tab 5，正文任务源页签即 5——修复前帧裸发无 tabId，跨页签穿透新面板）——
    ;(h.chrome.scripting.executeScript as any).mockResolvedValue([{ result: { ...PAGE, contentMarkdown: 'body' } }])
    const r3 = await h.fireMessage({ t: 'summarize', agentId: 'claude', workflow: 'quick' })
    h.fireNm({ t: 'content-received', taskId: r3.taskId, chars: 3 })
    await wait(20)
    expect(h.calls.sent.find((m) => m.t === 'task-error' && m.code === 'content-mismatch')).toMatchObject({ taskId: r3.taskId, tabId: 5 })
    expect((await h.fireMessage({ t: 'panel-ready' })).missedTerminal).toMatchObject({ taskId: r3.taskId, code: 'content-mismatch', tabId: 5 })
  })

  // r58（#5）：入箱判据 = 广播无接收端。面板在听（receiverOnline）时取消终局不入箱
  // ——修复前无条件入箱，收起再重开复读陈旧「已取消」；无接收端路径由上测（r57 #4）锚定
  it('r58 #5：广播有接收端 → 不入收件箱——重开不复读面板已看过的取消', async () => {
    const h = await boot({ seed: { sessions: [[5, CLAUDE_SESS]], panelTabId: 5, panelWindowId: 1 }, receiverOnline: true })
    await h.fireMessage({ t: 'summarize', followUp: true, instruction: 'x' })
    const r2 = await h.fireMessage({ t: 'summarize', followUp: true, instruction: 'y' }) // 连坐取消上一轮
    expect(r2.ok).toBe(true)
    expect((await h.fireMessage({ t: 'panel-ready' })).missedTerminal).toBeUndefined()
  })

  it('r58 #5：task-done 清同页签收件箱陈条——新终局后重开不再补发旧「已取消」', async () => {
    const h = await boot({ seed: { sessions: [[5, CLAUDE_SESS]], panelTabId: 5, panelWindowId: 1 } })
    await h.fireMessage({ t: 'summarize', followUp: true, instruction: 'x' }) // r1 在跑
    const r2 = await h.fireMessage({ t: 'summarize', followUp: true, instruction: 'y' }) // r1 连坐取消 → 收件箱留 cancelled
    h.fireNm({ t: 'task-done', taskId: r2.taskId, agentId: 'claude', historyPath: '/tmp/h.md' })
    expect((await h.fireMessage({ t: 'panel-ready' })).missedTerminal).toBeUndefined()
  })

  it('r58 #6：丢片取消登记 cancelledTaskIds——host 迟到的 cancelled 不覆写收件箱 content-mismatch', async () => {
    const h = await boot({ seed: { sessions: [[5, CLAUDE_SESS]], panelTabId: 5, panelWindowId: 1 } })
    ;(h.chrome.scripting.executeScript as any).mockResolvedValue([{ result: { ...PAGE, contentMarkdown: 'body' } }])
    await h.fireMessage({ t: 'panel-ready' }) // 锚 target 到面板页签 5（收件箱按页签键存，同 r57 #4 的 r3 流程）
    const r = await h.fireMessage({ t: 'summarize', agentId: 'claude', workflow: 'quick' })
    h.fireNm({ t: 'content-received', taskId: r.taskId, chars: 3 }) // 丢片 → 取消 + content-mismatch 入箱
    await wait(20)
    h.fireNm({ t: 'task-error', taskId: r.taskId, code: 'cancelled', message: 'task cancelled' }) // host 迟到同义终局
    await wait(20)
    expect((await h.fireMessage({ t: 'panel-ready' })).missedTerminal).toMatchObject({ code: 'content-mismatch' })
  })

  // r58（#7）：终局清理绑死「currentTask 匹配」——迟到/重复终局清不掉指针，已交付
  // 终局的任务被下次冷启动折算成 ext-restarted 幻影。本地注入残留指针忠实复现竞态
  //（remove IPC 落盘前 SW 被回收），迟到重复 done 应走同 id 兜底清理
  it('r58 #7：迟到重复终局清同 id 残留指针——不被冷启动折算成 ext-restarted 幻影', async () => {
    const h = await boot({ seed: { sessions: [[5, CLAUDE_SESS]], panelTabId: 5, panelWindowId: 1 } })
    const r = await h.fireMessage({ t: 'summarize', followUp: true, instruction: 'x' })
    h.fireNm({ t: 'task-done', taskId: r.taskId, agentId: 'claude' })
    expect(h.local.pdRunningTask).toBeUndefined() // 正常路径已清
    h.local.pdRunningTask = { taskId: r.taskId, tabId: 5 } // 模拟清理竞态残留
    h.fireNm({ t: 'task-done', taskId: r.taskId, agentId: 'claude' }) // 迟到重复终局（r11）
    await wait(20)
    expect(h.local.pdRunningTask, '迟到终局应清同 id 残留指针').toBeUndefined()
    expect((await h.fireMessage({ t: 'panel-ready' })).missedTerminal, '残留指针不再折算 ext-restarted').toBeUndefined()
  })

  it('迟到终局帧盖原 tab 邮戳（r53 #5 / r54 #3）：currentTask 清空后 tabOf 台账仍供邮戳，panel foreignAdopt 可核拒', async () => {
    const h = await boot({ seed: { sessions: [[5, CLAUDE_SESS]], panelTabId: 5, panelWindowId: 1 } })
    const r = await h.fireMessage({ t: 'summarize', followUp: true, instruction: 'x' })
    const tid = r.taskId
    h.fireNm({ t: 'task-done', taskId: tid, agentId: 'claude' }) // 终局 → currentTask = null
    // 管道内同 taskId 迟到流帧：非 currentTask 也必须带源页签邮戳（修复前裸发，
    // 穿透新面板 pending 态——panel 侧按 tabId 核收养才成立的前提）
    h.fireNm({ t: 'task-chunk', taskId: tid, seq: 99, text: '尾随' })
    const late = h.calls.sent.find((m) => m.t === 'task-chunk' && m.seq === 99)
    expect(late).toMatchObject({ taskId: tid, tabId: 5 })
  })

  it('版本横幅：host 过旧 → 命令钉 manifest 版本 + 两段到底（r53 #1——裸 npm i -g 可被镜像/缓存喂旧版）', async () => {
    const h = await boot({ hostVersion: '0.0.9' })
    const st = await h.fireMessage({ t: 'panel-ready' })
    expect(st.outdated).toContain('@aaione/ai-page-dive@0.1.4')
    expect(st.outdated).toContain('install --ext-id test-ext-id')
  })

  // r57（#8）：升级触达——host ≥ 下限但落后于扩展钉版时给非阻断软提示；此前升级
  // 无任何触达（已装机用户永远收不到 host 修复），与 Onboarding「仅此一次」矛盾
  it('r57 #8：host 落后钉版（≥下限）→ upgrade 软提示；过旧阻断优先；同版不打扰', async () => {
    const h = await boot({ hostVersion: '0.1.3' })
    const st = await h.fireMessage({ t: 'panel-ready' })
    expect(st.upgrade).toContain('0.1.3 → 0.1.4')
    expect(st.upgrade).toContain('install --ext-id test-ext-id')
    expect(st.outdated).toBeUndefined() // 非阻断：不下限横幅
    // 过旧仍走阻断横幅，upgrade 与之互斥
    const h2 = await boot({ hostVersion: '0.0.9' })
    const st2 = await h2.fireMessage({ t: 'panel-ready' })
    expect(st2.outdated).toBeTruthy()
    expect(st2.upgrade).toBeUndefined()
    // 同版零提示
    const h3 = await boot({ hostVersion: '0.1.4' })
    const st3 = await h3.fireMessage({ t: 'panel-ready' })
    expect(st3.upgrade).toBeUndefined()
    expect(st3.outdated).toBeUndefined()
  })

  it('r12：会话按任务源页签归档——锚在 6、任务跑在 11 的会话不写进 6（多 tab 隔离）', async () => {
    const h = await boot({ seed: { panelTabId: 6, panelWindowId: 1 } })
    const r = await h.fireMessage({ t: 'summarize', agentId: 'claude', workflow: 'quick' })
    expect(r.ok).toBe(true)
    // 任务源 tab = query 活跃页 11（tabsDb 的 5 仅 tabs.get 命中，query mock 恒返 11）
    h.fireNm({ t: 'task-meta', taskId: r.taskId, agentId: 'claude', sessionId: 's-9' })
    const persist = h.calls.storageSet.filter((s) => Array.isArray(s.sessions)).at(-1)
    // r57（#19）：来源页随会话归档（任务源页签的真实顶层锚，不是锚定页签 6）
    expect(persist.sessions).toContainEqual([11, { agentId: 'claude', sessionId: 's-9', page: { url: 'https://x/active', title: 'Active' } }])
    expect(persist.sessions.some((e: any) => e[0] === 6)).toBe(false)
  })

  it('r13：预 disable 幂等——同 tab 反复 onActivated 不重发 setOptions（disabledTabs 记账去重）', async () => {
    const h = await boot({ seed: { panelTabId: 5, panelWindowId: 1 } })
    h.events.onActivated({ tabId: 9, windowId: 1 })
    await h.flush()
    const count9 = () => h.calls.setOptions.filter((o: any) => o.tabId === 9 && o.enabled === false).length
    const first = count9()
    expect(first).toBeGreaterThanOrEqual(1)
    h.events.onActivated({ tabId: 9, windowId: 1 })
    await h.flush()
    expect(count9()).toBe(first)
  })

  // r67（r66 code#3）：windowId 零钉住——双窗不拆台契约（r9-backlog 语义）此前无
  // 任何测试：锚在窗 2 时他窗（窗 1）激活/新建均不 disable 不扰动；同窗照收且
  // ensureTabsDisabled 只扫锚窗口；panelWindowId 缺失（旧持久化态）宁可收起
  it('r67（r66 code#3）：双窗不拆台——他窗 onActivated/onCreated 不 disable，同窗照收只扫锚窗口', async () => {
    const h = await boot({ seed: { panelTabId: 7, panelWindowId: 2 } })
    const q0 = h.calls.queries.length
    // 他窗（窗 1）激活 tab 15：零 setOptions、ensureTabsDisabled 不跑
    h.events.onActivated({ tabId: 15, windowId: 1 })
    await h.flush()
    expect(h.calls.setOptions.filter((o: any) => o.tabId === 15)).toHaveLength(0)
    expect(h.calls.queries.length).toBe(q0)
    // 他窗新建 tab 17 同理不预 disable（onCreated 同窗过滤）
    h.events.onCreated({ id: 17, windowId: 1 })
    await h.flush()
    expect(h.calls.setOptions.filter((o: any) => o.tabId === 17)).toHaveLength(0)
    // 同窗（窗 2）激活 tab 16：收起 + 预 disable 只扫锚窗口
    h.events.onActivated({ tabId: 16, windowId: 2 })
    await h.flush()
    expect(h.calls.setOptions.filter((o: any) => o.tabId === 16 && o.enabled === false).length).toBeGreaterThanOrEqual(1)
    expect(h.calls.queries.some((q: any) => q && q.windowId === 2)).toBe(true)

    // 旧持久化态：panelWindowId 缺失 → 宁可收起（页签独立硬诉求，安全方向）
    const h2 = await boot({ seed: { panelTabId: 7 } })
    h2.events.onActivated({ tabId: 15, windowId: 1 })
    await h2.flush()
    expect(h2.calls.setOptions.filter((o: any) => o.tabId === 15 && o.enabled === false).length).toBeGreaterThanOrEqual(1)
  })

  // r55（#10）：扩展更新/重载打断在跑任务——storage.session 随之清空，收件箱/
  // currentTask 全灭，重开面板零痕迹。storage.local 的任务指针是唯一残留凭证，
  // 冷启动 restoreSession 折算成 ext-restarted 终局补进收件箱（消费即清）
  it('r55（#10）：孤儿任务指针 → 冷启动折算 ext-restarted 进收件箱，panel-ready 一次性消费', async () => {
    const h = await boot({
      seed: { panelTabId: 5, panelWindowId: 1 },
      seedLocal: { pdRunningTask: { taskId: 'orphan-1', tabId: 5 } },
    })
    await h.flush()
    const st = await h.fireMessage({ t: 'panel-ready' })
    expect(st.missedTerminal).toMatchObject({ t: 'task-error', taskId: 'orphan-1', code: 'ext-restarted', tabId: 5 })
    // 指针折算即耗：再次 panel-ready 不重复补发
    const st2 = await h.fireMessage({ t: 'panel-ready' })
    expect(st2.missedTerminal).toBeUndefined()
    expect(h.local.pdRunningTask).toBeUndefined()
  })

  it('r55（#10）：任务起跑立指针 + 终局成对清理——不留陈旧指针在下次冷启动误报', async () => {
    const h = await boot({ seed: { sessions: [[5, CLAUDE_SESS]], panelTabId: 5, panelWindowId: 1 } })
    const r = await h.fireMessage({ t: 'summarize', followUp: true, instruction: 'x' })
    expect(h.local.pdRunningTask).toEqual({ taskId: r.taskId, tabId: 5 })
    h.fireNm({ t: 'task-done', taskId: r.taskId, agentId: 'claude' })
    expect(h.local.pdRunningTask).toBeUndefined()
  })

  // r57（#19）：会话来源页随 sessions 持久化并经 panel-ready 透出——「关面板→页签
  // 导航→重开」路径 ctxAnchor 不再错标导航后的新页（活 pageMeta 只是兜底）
  it('r57 #19：panel-ready 透出 sessionPage（SW 会话来源页），无 page 的旧会话不透出', async () => {
    const h = await boot({
      seed: {
        sessions: [[5, { agentId: 'claude', sessionId: 's-1', page: { url: 'https://a/origin', title: '来源页' } }]],
        panelTabId: 5,
        panelWindowId: 1,
      },
    })
    const st = await h.fireMessage({ t: 'panel-ready' })
    expect(st.sessionPage).toEqual({ url: 'https://a/origin', title: '来源页' })
    // 无 page（旧版本落盘的会话 / codex 纯 historyPath 还原）：不透出，panel 走 pageMeta 兜底
    const h2 = await boot({
      seed: {
        sessions: [[5, { agentId: 'codex', sessionId: '', historyPath: '~/.ai-page-dive/history/2026/10/a.md' }]],
        panelTabId: 5,
        panelWindowId: 1,
      },
    })
    const st2 = await h2.fireMessage({ t: 'panel-ready' })
    expect(st2.sessionPage).toBeUndefined()
    // r57 盲区3：codex 自 r7-impl 起也产 sessionId（thread_id）——正常轮 canResume=true
    // （旧注释「codex 不产 sessionId」是漂移口径）；空串降级轮才 false
    const h3 = await boot({
      seed: {
        sessions: [[5, { agentId: 'codex', sessionId: 'th-9', historyPath: '~/.ai-page-dive/history/2026/10/b.md' }]],
        panelTabId: 5,
        panelWindowId: 1,
      },
    })
    const st3 = await h3.fireMessage({ t: 'panel-ready' })
    expect(st3.canResume).toBe(true)
    expect(st2.canResume).toBe(false)
  })

  // r55（#11）：nm 通用转发缺帧限门禁——超限帧会被 host 当协议失步自杀（连带收割
  // 全部在跑任务）。门禁必须在 SW 侧拒发（任务起跑帧 frameTooLarge 的转发面同类）
  it('r55（#11）：nm 转发帧限门禁——超 1MB 的 workflow-save 拒发 frame-too-large，不进 NM', async () => {
    const h = await boot()
    const resp = await h.fireMessage({ t: 'nm', msg: { t: 'workflow-save', name: 'big', description: '', body: 'x'.repeat(1_100_000) } })
    expect(resp).toEqual({ error: 'frame-too-large' })
    expect(h.calls.nmSent).toEqual([])
  })

  // r60（代码审）：帧类型白名单——未知/畸形帧拒转发，panel 被攻陷也不成任意 host 命令通道
  it('r60：nm 转发白名单——未知帧类型/非对象拒发 ok:false，合法帧照发', async () => {
    const h = await boot()
    expect(await h.fireMessage({ t: 'nm', msg: { t: 'rm -rf' } })).toEqual({ ok: false })
    expect(await h.fireMessage({ t: 'nm', msg: 'not-an-object' })).toEqual({ ok: false })
    expect(await h.fireMessage({ t: 'nm', msg: {} })).toEqual({ ok: false })
    expect(h.calls.nmSent).toEqual([])
    expect(await h.fireMessage({ t: 'nm', msg: { t: 'list-skills' } })).toEqual({ ok: true })
    expect(h.calls.nmSent).toEqual([{ t: 'list-skills' }])
  })

  // r60（审计 T5 后半）：孤儿任务帧（有 taskId、台账无源页签）不裸发——无邮戳帧会
  // 穿透新面板 pending 态；终局兜底（收件箱/归档）按各自 tabOf 守卫独立成立
  it('r60：孤儿任务帧不转发——ghost taskId 无 tabOf 记录，task-chunk/task-done 均不进 sent', async () => {
    const h = await boot()
    h.fireNm({ t: 'task-chunk', taskId: 'ghost', seq: 1, text: 'x' })
    h.fireNm({ t: 'task-done', taskId: 'ghost' })
    await new Promise((r) => setTimeout(r, 0))
    expect(h.calls.sent.filter((m) => m?.t === 'task-chunk' || m?.t === 'task-done')).toEqual([])
    // r61（代码审）：孤儿 done 也不打角标——帧已弃发而角标照打是「有通知无内容」半开态
    expect(h.calls.badge.filter((b) => b?.text === '✓' || b?.text === '!')).toEqual([])
  })

  // r58（#30）：SW 指针空 ≠ host 侧空——扩展 reload 折叠指针后 host 可能还在跑。
  // idle 的 cancel 发无 taskId 的 task-cancel 让 host 取本连接最近任务；任务在跑
  // 时仍带 taskId（精确收割不误杀）。r61（代码审）：断连时不发——NM 一连接一 host，
  // port 断即 host 进程已死无任务可收割，发只会冷启动空 host
  it('r58 #30：cancel 空闲发无 taskId task-cancel；在跑带 taskId；断连不发', async () => {
    const h = await boot()
    expect(await h.fireMessage({ t: 'cancel' })).toEqual({ ok: true })
    expect(h.calls.nmSent).toContainEqual({ t: 'task-cancel' }) // 无 taskId——host 取最近任务
    const r = await h.fireMessage({ t: 'summarize', agentId: 'claude', workflow: 'quick' })
    expect(r.ok).toBe(true)
    await h.fireMessage({ t: 'cancel' })
    expect(h.calls.nmSent).toContainEqual({ t: 'task-cancel', taskId: r.taskId })
    // r61：断连后空闲 cancel 不再发——全程恰好 1 条无 taskId 的 task-cancel
    ;(nmState.port as any).connected = false
    expect(await h.fireMessage({ t: 'cancel' })).toEqual({ ok: true })
    expect(h.calls.nmSent.filter((m) => m.t === 'task-cancel' && m.taskId === undefined)).toHaveLength(1)
  })

  // r65（r64 code#1）：resume-history/new-session 的 SW 侧收割定向化——r63 M1 只修了
  // 面板侧半边，SW 侧无条件 cancelCurrent 会连坐别窗在跑任务（白烧订阅额度）。
  // 别窗任务的尾随 chunk 由 panel 侧 foreignAdopt 按锚页签拒收，砍任务无依据
  it('r65：resume-history/new-session 只收割本锚页签任务——别窗在跑不连坐', async () => {
    const h = await boot({ seed: { panelTabId: 6, panelWindowId: 1 } })
    const r = await h.fireMessage({ t: 'summarize', agentId: 'claude', workflow: 'quick' })
    expect(r.ok).toBe(true)
    // 任务源 tab = 11（query mock 恒返 11）≠ 锚 6：历史降级/新对话不得杀它
    await h.fireMessage({ t: 'resume-history', agentId: 'claude', sessionId: 's-h', historyPath: '/tmp/h.md' })
    await h.fireMessage({ t: 'new-session' })
    expect(h.calls.nmSent.filter((m) => m.t === 'task-cancel')).toEqual([])
    // 对照组：任务源 = 锚页签本尊（11）→ 收割照旧
    const h2 = await boot({ seed: { panelTabId: 11, panelWindowId: 1 } })
    const r2 = await h2.fireMessage({ t: 'summarize', agentId: 'claude', workflow: 'quick' })
    expect(r2.ok).toBe(true)
    await h2.fireMessage({ t: 'new-session' })
    expect(h2.calls.nmSent).toContainEqual({ t: 'task-cancel', taskId: r2.taskId })
  })

  // r67（r66 code#1）：r65 收割定向化以 panelTabId 单例为基准——双窗后开面板覆盖
  // 单例后双向错位：A 窗操作命中别窗锚误杀 / A 窗锚失配漏杀（CLI 空跑 10min 白烧
  // 额度）。帧携带发起面板锚 anchorTabId 后闭合；sessions 键与追问会话读取同锚对号
  it('r67：帧内 anchorTabId 对号收割——单例被别窗覆盖后误杀/漏杀双向闭合', async () => {
    // 双窗：A 面板锚 11 起任务（query mock 恒返 11 = 任务源页签），B 后开面板覆盖 panelTabId=22
    const h = await boot({ seed: { panelTabId: 22, panelWindowId: 2 } })
    const r = await h.fireMessage({ t: 'summarize', agentId: 'claude', workflow: 'quick', anchorTabId: 11 })
    expect(r.ok).toBe(true)
    // B 窗（帧锚 22）新对话：不得误杀 A 在 11 页签的在跑任务
    await h.fireMessage({ t: 'new-session', anchorTabId: 22 })
    expect(h.calls.nmSent.filter((m) => m.t === 'task-cancel')).toEqual([])
    // A 窗（帧锚 11）恢复历史：收割本窗在跑任务——r65 语义下 11 ≠ 单例 22 会漏杀
    await h.fireMessage({ t: 'resume-history', agentId: 'claude', sessionId: 's-x', historyPath: '/tmp/x.md', anchorTabId: 11 })
    expect(h.calls.nmSent).toContainEqual({ t: 'task-cancel', taskId: r.taskId })
    // sessions 按帧锚对号：A 锚 11 追问 resume 到刚装载的会话；B 锚 22 读不到 → session-lost
    const fu = await h.fireMessage({ t: 'summarize', agentId: 'claude', instruction: '继续', followUp: true, anchorTabId: 11 })
    expect(fu.ok).toBe(true)
    const starts = h.calls.nmSent.filter((m) => m.t === 'task-start')
    expect(starts[starts.length - 1].task.resumeSessionId).toBe('s-x')
    const fu2 = await h.fireMessage({ t: 'summarize', agentId: 'claude', instruction: '继续', followUp: true, anchorTabId: 22 })
    expect(fu2).toEqual({ error: 'session-lost' })
  })

  // r69（r68 code#1）：panel-ready 回包锚按发起窗界定——panelTabId 单例被 B 窗后开
  // 面板覆盖后，A 窗面板（自报 myWindowId）重开时锚播种成自己窗的活跃 tab（面板
  // 可见 = 锚 tab 活跃，锚定语义保证），missed/sess 同锚对号；帧无 myWindowId
  // （旧面板）沿用单例（兼容路径不变）
  it('r69：panel-ready 异窗回包锚 = 该窗活跃 tab（sess 对号）；无 myWindowId 沿用单例', async () => {
    // tabsDb 默认含 tab 5（窗 1）；B 后开面板覆盖单例 = 22/窗 2。A 窗面板（窗 1）重开
    const h = await boot({ seed: { panelTabId: 22, panelWindowId: 2, sessions: [[5, CLAUDE_SESS]] } })
    const st = await h.fireMessage({ t: 'panel-ready', myWindowId: 1 })
    expect(st.panelTabId).toBe(5) // A 窗锚 = 窗 1 活跃 tab，不再被单例 22 串台
    expect(st.hasSession).toBe(true)
    expect(st.sessionAgentId).toBe('claude')
    // 兼容路径：帧无 myWindowId（旧面板）→ 单例口径不变
    const st2 = await h.fireMessage({ t: 'panel-ready' })
    expect(st2.panelTabId).toBe(11) // 单例已重建为活跃页 11，仍非 A 窗的 5——单例语义照旧
    expect(st2.hasSession).toBeUndefined()
  })

  // r69（r68 code#2）：summarize 内容源与帧锚同源——target 单例被后开面板的 action
  // 点击覆盖后，A 窗锚的总结不再提取 B 窗页面；task-status 邮戳 = 帧锚 tab
  //（currentTask.tabId 归档路由同源对号，task-done 不再顶掉别窗会话）
  it('r69：summarize 内容源帧锚优先——单例 target 是别窗页时提取/邮戳仍用锚 tab', async () => {
    // 锚 31（窗 3，tabsDb 注入）；query 默认活跃页 11（回退读单例/活跃页则邮戳 11 即红）
    const h = await boot({ seed: { panelTabId: 22, panelWindowId: 2 } })
    h.tabs.set(31, { id: 31, windowId: 3, url: 'https://x/a31', title: 'A31' })
    const r = await h.fireMessage({ t: 'summarize', agentId: 'claude', workflow: 'quick', anchorTabId: 31 })
    expect(r.ok).toBe(true)
    expect(h.calls.sent.find((m) => m?.t === 'task-status')).toMatchObject({ tabId: 31 })
  })

  // r69（r68 code#3）：误杀向鉴别力——query 默认活跃页恒返 11 时，seed 单例 22 的
  // 「new-session(帧锚 22) 零 cancel」对「代码回退读单例」无鉴别力（11≠22 同样不杀）。
  // 活跃页改返 22（= 单例锚，任务源落在 22）后：帧锚 11 的 new-session 零 cancel
  // 才有牙齿——回退读单例的旧代码 22===22 即误杀红
  it('r69：误杀向鉴别——任务源=单例 22 时，帧锚 11 的 new-session 不得 cancel', async () => {
    const q22 = { id: 22, windowId: 2, url: 'https://x/b22', title: 'B22' }
    const h = await boot({ seed: { panelTabId: 22, panelWindowId: 2 }, queryTab: q22 })
    // 无 anchorTabId 的 summarize（单例路径）→ 任务源落在 22
    const r = await h.fireMessage({ t: 'summarize', agentId: 'claude', workflow: 'quick' })
    expect(r.ok).toBe(true)
    expect(h.calls.sent.find((m) => m?.t === 'task-status')).toMatchObject({ tabId: 22 })
    // A 窗面板（帧锚 11）新对话：不误杀 B（单例 22）在跑任务
    await h.fireMessage({ t: 'new-session', anchorTabId: 11 })
    expect(h.calls.nmSent.filter((m) => m.t === 'task-cancel')).toEqual([])
    // 对照：帧锚 22（B 自己）照杀
    const h2 = await boot({ seed: { panelTabId: 22, panelWindowId: 2 }, queryTab: q22 })
    const r2 = await h2.fireMessage({ t: 'summarize', agentId: 'claude', workflow: 'quick' })
    await h2.fireMessage({ t: 'new-session', anchorTabId: 22 })
    expect(h2.calls.nmSent).toContainEqual({ t: 'task-cancel', taskId: r2.taskId })
  })

  // r58（#28）：正文对账超时兜底——回执被吞（done 片或 content-received 丢失）时
  // host 侧无超时（等正文齐才开跑），无 SW 侧兜底则三重放大：host 心跳永生保活
  // SW + panel 无限 loading + CLI 永不启动。15s 未到即取消终局；回执按期到达撤表
  it('r58 #28：对账超时 15s 未到 → cancel + content-mismatch 终局；回执到达 → 撤表不误杀', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true }) // 真实等待 15s 太慢；advance 快进，微任务链不受影响
    try {
      const h = await boot()
      const r1 = await h.fireMessage({ t: 'summarize', agentId: 'claude', workflow: 'quick' })
      expect(r1.ok).toBe(true)
      vi.advanceTimersByTime(15_000) // 回执被吞的极端通道
      expect(h.calls.nmSent).toContainEqual({ t: 'task-cancel', taskId: r1.taskId })
      expect(h.calls.sent.find((m) => m.t === 'task-error' && m.code === 'content-mismatch')).toMatchObject({ taskId: r1.taskId })
      // 对照组：回执按期到达（默认正文 'x' → total=1）→ 撤表，快进后不再误杀
      const r2 = await h.fireMessage({ t: 'summarize', agentId: 'claude', workflow: 'quick' })
      expect(r2.ok).toBe(true)
      h.fireNm({ t: 'content-received', taskId: r2.taskId, chars: 1 })
      vi.advanceTimersByTime(15_000)
      expect(h.calls.nmSent.filter((m) => m.t === 'task-cancel' && m.taskId === r2.taskId)).toEqual([])
      expect(h.calls.sent.filter((m) => m.t === 'task-error' && m.taskId === r2.taskId)).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  // r62 审计（code #2）：追问轮同款对账兜底——r58#28 只盖了 summarize 路径；followUp
  // 的唯一 done 片被吞时 host 心跳永生续命 panel 看门狗，无自动收敛。15s 未回执即取消
  it('r62 code#2：追问轮 done 片回执被吞 → 15s 对账超时 cancel + content-mismatch；回执到达撤表', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const h = await boot({ seed: { sessions: [[5, CLAUDE_SESS]], panelTabId: 5, panelWindowId: 1 } })
      const r1 = await h.fireMessage({ t: 'summarize', followUp: true, instruction: '继续' })
      expect(r1.ok).toBe(true)
      vi.advanceTimersByTime(15_000) // done 片的回执（content-received）被吞
      expect(h.calls.nmSent).toContainEqual({ t: 'task-cancel', taskId: r1.taskId })
      expect(h.calls.sent.find((m) => m.t === 'task-error' && m.code === 'content-mismatch')).toMatchObject({ taskId: r1.taskId })
      // 对照组：回执按期到达（追问正文空 → chars 0）→ 撤表，快进后不误杀
      const r2 = await h.fireMessage({ t: 'summarize', followUp: true, instruction: '再问' })
      expect(r2.ok).toBe(true)
      h.fireNm({ t: 'content-received', taskId: r2.taskId, chars: 0 })
      vi.advanceTimersByTime(15_000)
      expect(h.calls.nmSent.filter((m) => m.t === 'task-cancel' && m.taskId === r2.taskId)).toEqual([])
      expect(h.calls.sent.filter((m) => m.t === 'task-error' && m.taskId === r2.taskId)).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  // r59（审计 T1）：看门狗竞态象限——cancel 带 taskId 而 SW 侧 currentTask 已清
  //（终局先到一步）。修复前守卫不命中 → 退化为无 taskId cancel → host 收割
  //「最近任务」，跨窗口时恰是别面板的新任务
  it('r59 审计T1：带 taskId + currentTask 已清 → 拒收，不发无 taskId cancel', async () => {
    const h = await boot({ seed: { sessions: [[5, CLAUDE_SESS]], panelTabId: 5, panelWindowId: 1 } })
    const r = await h.fireMessage({ t: 'summarize', followUp: true, instruction: 'x' })
    h.fireNm({ t: 'task-done', taskId: r.taskId, agentId: 'claude' }) // 终局清指针（竞态窗口）
    h.calls.nmSent.length = 0
    expect(await h.fireMessage({ t: 'cancel', taskId: r.taskId })).toEqual({ ok: false })
    expect(h.calls.nmSent).toEqual([]) // 绝不发无 taskId task-cancel——host 会收割最近任务
  })

  // r59（审计 T4）：host 原生 task-error 对齐 emitTerminal「有接收端不入箱」——
  // 修复前无条件入箱，面板看着错误气泡、收起重开还复读一遍
  it('r59 审计T4：host 原生 task-error 广播有接收端 → 不入收件箱', async () => {
    const h = await boot({ seed: { sessions: [[5, CLAUDE_SESS]], panelTabId: 5, panelWindowId: 1 }, receiverOnline: true })
    const r = await h.fireMessage({ t: 'summarize', followUp: true, instruction: 'x' })
    h.fireNm({ t: 'task-error', taskId: r.taskId, code: 'timeout', message: '超时' })
    await wait(20)
    expect((await h.fireMessage({ t: 'panel-ready' })).missedTerminal).toBeUndefined()
  })

  // r59（审计 T5）：迟到 meta/done 的会话归档兜底从 panelTabId 改为 tabOf 台账——
  // 归档到任务源页签；台账无记录（SW 重启丢账/幽灵帧）则丢弃，绝不写当前锚页签
  it('r59 审计T5：迟到 done 归档查 tabOf 源页签；未知任务丢弃不捡会话', async () => {
    const h = await boot({ seed: { sessions: [[5, CLAUDE_SESS]], panelTabId: 5, panelWindowId: 1 } })
    const r = await h.fireMessage({ t: 'summarize', followUp: true, instruction: 'x' })
    h.fireNm({ t: 'task-error', taskId: r.taskId, code: 'timeout' }) // 终局清 currentTask → done 成迟到帧
    await wait(20)
    h.fireNm({ t: 'task-done', taskId: r.taskId, agentId: 'claude', sessionId: 's-222', historyPath: '/tmp/h2.md' })
    await wait(20)
    const wrote = h.calls.storageSet.filter((s: any) => s.sessions).at(-1)?.sessions
    expect(wrote).toContainEqual([5, expect.objectContaining({ sessionId: 's-222', historyPath: '/tmp/h2.md' })])
    const before = h.calls.storageSet.length
    h.fireNm({ t: 'task-done', taskId: 'ghost-1', agentId: 'claude', sessionId: 's-999', historyPath: '/tmp/g.md' })
    await wait(20)
    expect(JSON.stringify(h.calls.storageSet.slice(before))).not.toContain('s-999') // 未知任务不归档
  })

  // r60（审计测试债）：上例锚=源分不开「归档绕过 tabOf 退化为 panelTabId」——本例
  // 锚在 6、任务源在 11（harness tabs.query 恒回 11）：退化实现会把会话写进 6，
  // 正确实现按 tabOf 归 11
  it('r60：T5 正向区分——锚 6 / 任务源 11，迟到归档进 11 不进 6', async () => {
    const h = await boot({ seed: { panelTabId: 6, panelWindowId: 1 } })
    const r = await h.fireMessage({ t: 'summarize', agentId: 'claude', workflow: 'quick' })
    h.fireNm({ t: 'task-error', taskId: r.taskId, code: 'timeout' })
    await wait(20)
    h.fireNm({ t: 'task-done', taskId: r.taskId, agentId: 'claude', sessionId: 's-333', historyPath: '/tmp/h3.md' })
    await wait(20)
    const wrote = h.calls.storageSet.filter((s: any) => s.sessions).at(-1)?.sessions
    expect(wrote).toContainEqual([11, expect.objectContaining({ sessionId: 's-333' })])
    expect(wrote).not.toContainEqual([6, expect.objectContaining({ sessionId: 's-333' })])
  })

  // r59（审计 T9）：PDF 页面专项分型——修复前走 empty-content，得到「滚动到底触发
  // 懒加载」这一对 PDF 必然无效的指引
  it('r59 审计T9：PDF 页面 → pdf-page 分型，不再落 empty-content 懒加载指引', async () => {
    const h = await boot({ activeUrl: 'https://x/paper.pdf' })
    const r = await h.fireMessage({ t: 'summarize', agentId: 'claude', workflow: 'quick' })
    expect(r).toMatchObject({ error: 'pdf-page' })
    expect(h.calls.nmSent.filter((m) => m.t === 'task-start')).toEqual([]) // 不起任务
    // r60（审计 T9 复核）：query 带 .pdf 的 HTML 查看页不得误报——正则锚 path 段
    const h2 = await boot({ activeUrl: 'https://view.x/doc?url=https://a/paper.pdf' })
    const r2 = await h2.fireMessage({ t: 'summarize', agentId: 'claude', workflow: 'quick' })
    expect((r2 as { error?: string }).error).not.toBe('pdf-page')
    // r61（产品审）：尾斜杠与 format=pdf 两形态命中；format=pdfx 子串不误报
    for (const u of ['https://x/paper.pdf/', 'https://docs.x/export?format=pdf']) {
      const hx = await boot({ activeUrl: u })
      const rx = await hx.fireMessage({ t: 'summarize', agentId: 'claude', workflow: 'quick' })
      expect((rx as { error?: string }).error, u).toBe('pdf-page')
    }
    const h3 = await boot({ activeUrl: 'https://docs.x/export?format=pdfx' })
    const r3 = await h3.fireMessage({ t: 'summarize', agentId: 'claude', workflow: 'quick' })
    expect((r3 as { error?: string }).error).not.toBe('pdf-page')
  })
})
