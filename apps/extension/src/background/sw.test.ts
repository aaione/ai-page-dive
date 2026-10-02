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

async function boot(opts: { seed?: Record<string, any>; slowGets?: number; hostVersion?: string } = {}) {
  const calls = {
    /** runtime.sendMessage 全部广播（含任务帧转发） */
    sent: [] as any[],
    /** 跨 API 全序（k: send/setOptions/open/persist）——锚「先于」类断言 */
    order: [] as { k: string; v?: unknown }[],
    storageSet: [] as any[],
    setOptions: [] as any[],
    open: [] as any[],
    badge: [] as any[],
    nmSent: [] as any[],
    nmHandlers: [] as Array<(m: any) => void>,
    nmDisconnect: [] as Array<() => void>,
  }
  const store: Record<string, any> = { ...(opts.seed ?? {}) }
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
      getManifest: () => ({ version: '0.1.3' }),
      onMessage: listeners(onMessageL),
      sendMessage: (m: any) => {
        calls.sent.push(m)
        calls.order.push({ k: 'send', v: m?.t })
        return Promise.resolve()
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
      query: async () => [{ id: 11, windowId: 2, url: 'https://x/active', title: 'Active' }],
    },
    scripting: {
      // 第 1 次 = content.js files 注入；之后 = func 提取（默认正文可被各用例覆写）
      executeScript: vi.fn().mockResolvedValueOnce([]).mockResolvedValue([{ result: { ...PAGE, contentMarkdown: 'x' } }]),
    },
  }
  ;(globalThis as any).chrome = chrome
  nmState.port = {
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
  const fireMessage = (msg: any) =>
    new Promise<any>((resolve) => {
      onMessageL.at(-1)!(msg, { id: chrome.runtime.id }, resolve)
    })
  return {
    chrome,
    calls,
    flush,
    fireMessage,
    fireNm: (m: any) => calls.nmHandlers.forEach((h) => h(m)),
    fireDisconnect: () => calls.nmDisconnect.forEach((h) => h()),
    events: {
      onClicked: (tab: any) => onClicked.forEach((f) => f(tab)),
      onRemoved: (tabId: number) => onRemoved.forEach((f) => f(tabId)),
      onActivated: (info: any) => onActivated.forEach((f) => f(info)),
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
    expect(st.outdated).toContain('@aaione/ai-page-dive@0.1.3')
    expect(st.outdated).toContain('install --ext-id test-ext-id')
  })

  it('r12：会话按任务源页签归档——锚在 6、任务跑在 11 的会话不写进 6（多 tab 隔离）', async () => {
    const h = await boot({ seed: { panelTabId: 6, panelWindowId: 1 } })
    const r = await h.fireMessage({ t: 'summarize', agentId: 'claude', workflow: 'quick' })
    expect(r.ok).toBe(true)
    // 任务源 tab = query 活跃页 11（tabsDb 的 5 仅 tabs.get 命中，query mock 恒返 11）
    h.fireNm({ t: 'task-meta', taskId: r.taskId, agentId: 'claude', sessionId: 's-9' })
    const persist = h.calls.storageSet.filter((s) => Array.isArray(s.sessions)).at(-1)
    expect(persist.sessions).toContainEqual([11, { agentId: 'claude', sessionId: 's-9' }])
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
})
