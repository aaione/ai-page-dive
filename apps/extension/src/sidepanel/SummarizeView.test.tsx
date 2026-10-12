// @vitest-environment jsdom
/**
 * r63（审计 medium#2）：UI 组件测试设施第一锹——三轮零 *.test.tsx 的旧债起步。
 * 锚点选 no-permission 气泡的授权开关（GrantHostRow）：r47 起设置页入口删除后
 * 唯一授予出口，r62（产品#5）刚补过拒绝显式反馈——冒烟同时钉住这两笔不回退。
 * mount 数据实抄 App.tsx:798-801 的 no-permission 失败终局构造，不发明新形状。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SummarizeView } from './SummarizeView.js'
import type { TaskStreamState } from './App.js'

// RTL 自动 cleanup 钩在 vitest globals 上（本仓未开 globals）——不显式挂会把
// 上一用例的 DOM 泄漏给下一用例（getByRole 多元素命中）
afterEach(cleanup)

// chrome shim：GrantHostRow 点击走 chrome.permissions.request（jsdom 无 chrome 全局）
const requestMock = vi.fn((_p: { origins: string[] }) => Promise.resolve(false))
beforeEach(() => {
  requestMock.mockReset()
  ;(globalThis as any).chrome = {
    permissions: { request: requestMock },
    runtime: { sendMessage: vi.fn(() => Promise.resolve({})) },
  }
})

const stream: TaskStreamState = {
  taskId: null,
  activeId: null,
  pending: false,
  finished: [],
  phase: '',
  done: true,
  resumable: false,
  aliveAt: 0,
  messages: [
    { id: 'e1', role: 'assistant', text: '', error: '本页尚未授权提取', isError: true, grantHost: true },
  ],
}

function mount() {
  return render(
    <SummarizeView
      agents={[{ id: 'claude', available: true, version: '2.1.162' }]}
      workflows={[]}
      stream={stream}
      agentId="claude"
      onAgentChange={() => {}}
      onStartResult={() => {}}
      beginTurn={() => {}}
      beginSession={() => {}}
      pageMeta={null}
      resumable={false}
    />,
  )
}

describe('SummarizeView 授权开关冒烟（GrantHostRow）', () => {
  it('no-permission 气泡渲染「始终允许读取网页」按钮', () => {
    mount()
    expect(screen.getByRole('button', { name: '始终允许读取网页' })).toBeTruthy()
  })

  it('点击 → chrome.permissions.request(<all_urls>)，授予后切换已开启提示', async () => {
    requestMock.mockResolvedValue(true)
    mount()
    fireEvent.click(screen.getByRole('button', { name: '始终允许读取网页' }))
    expect(requestMock).toHaveBeenCalledWith({ origins: ['<all_urls>'] })
    await waitFor(() => expect(screen.getByText('已开启——直接重发即可，无需点图标')).toBeTruthy())
  })

  it('r62（产品#5）：拒绝不再静默——显示可重试/改逐页授权提示', async () => {
    requestMock.mockResolvedValue(false)
    mount()
    fireEvent.click(screen.getByRole('button', { name: '始终允许读取网页' }))
    await waitFor(() => expect(screen.getByText(/未开启——可再点一次重试/)).toBeTruthy())
  })
})

describe('SummarizeView 停止按钮 cancel 帧契约（r63 M1 修复钉住，r64 code#6）', () => {
  // 契约：已绑定任务 → 带 taskId 定向取消（双窗防误杀，r63 M1）；pending 未绑定 →
  // 裸帧——SW 语义=收割最近任务，即本面板自己起的那单（设计如此，见 r58#30）
  const mountStop = (over: Partial<TaskStreamState>) =>
    render(
      <SummarizeView
        agents={[{ id: 'claude', available: true, version: '2.1.162' }]}
        workflows={[]}
        stream={{ ...stream, ...over }}
        agentId="claude"
        onAgentChange={() => {}}
        onStartResult={() => {}}
        beginTurn={() => {}}
        beginSession={() => {}}
        pageMeta={null}
        resumable={false}
      />,
    )

  it('已绑定任务 → cancel 带 taskId 定向', () => {
    mountStop({ taskId: 't-9', activeId: 't-9', pending: false, done: false })
    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    expect((globalThis as any).chrome.runtime.sendMessage).toHaveBeenCalledWith({ t: 'cancel', taskId: 't-9' })
  })

  it('pending 未绑定 → 裸帧（taskId 缺省不入帧）', () => {
    mountStop({ taskId: null, activeId: null, pending: true, done: false })
    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    expect((globalThis as any).chrome.runtime.sendMessage).toHaveBeenCalledWith({ t: 'cancel' })
  })
})

describe('SummarizeView tips 终局五态分流（r71 r70 product C9/L3）', () => {
  // 契约：「分享未成功」只在 undelivered（页面未送达 CLI）终局出现；已送达的
  // 生成阶段失败（timeout/is_error）如实「已分享」——说未成功会误导用户查提取/授权；
  // cancelled 终局独立「已停止」。终局气泡形状实抄 App.tsx task-error 分支构造
  const mountTips = (last: Record<string, unknown>) =>
    render(
      <SummarizeView
        agents={[{ id: 'claude', available: true, version: '2.1.162' }]}
        workflows={[]}
        stream={{ ...stream, done: true, pending: false, messages: [{ id: 'e1', role: 'assistant', text: '', error: 'x', isError: true, ...last }] }}
        agentId="claude"
        onAgentChange={() => {}}
        onStartResult={() => {}}
        beginTurn={() => {}}
        beginSession={() => {}}
        pageMeta={{ url: 'https://example.com/a', title: '示例页' } as never}
        resumable={false}
      />,
    )

  it('no-permission 终局（未送达）→「分享未成功」', () => {
    mountTips({ undelivered: true })
    expect(screen.getByText(/分享未成功「示例页」/)).toBeTruthy()
  })

  it('timeout 终局（正文已过 stdin）→ 仍「已分享」，不得谎报未成功（C9）', () => {
    mountTips({})
    expect(screen.getByText(/已分享「示例页」/)).toBeTruthy()
    expect(screen.queryByText(/分享未成功/)).toBeNull()
  })

  it('cancelled 终局 →「已停止」（L3 第五态）', () => {
    mountTips({ cancelled: true })
    expect(screen.getByText(/已停止「示例页」/)).toBeTruthy()
  })
})

describe('r77：Ctrl+V 粘贴剪贴板图片直入附件链', () => {
  it('纯图片粘贴 → chip 渲染（pickAttachments 预算/上限/提示全复用）；纯文本粘贴不劫持', async () => {
    mount()
    const ta = screen.getByRole('textbox', { name: '自定义指令' })
    fireEvent.paste(ta, { clipboardData: { files: [new File(['fake-png'], '粘贴图.png', { type: 'image/png' })] } })
    await waitFor(() => expect(screen.getByText('粘贴图.png')).toBeTruthy())
    // 纯文本粘贴（files 空）不产生新附件
    fireEvent.paste(ta, { clipboardData: { files: [] } })
    expect(screen.getAllByText('粘贴图.png').length).toBe(1)
  })

  it('图文混合粘贴不接管（复制网页段落常带图）——不产生附件 chip', () => {
    mount()
    const ta = screen.getByRole('textbox', { name: '自定义指令' })
    fireEvent.paste(ta, {
      clipboardData: { files: [new File(['x'], '混.png', { type: 'image/png' }), new File(['t'], 'a.txt', { type: 'text/plain' })] },
    })
    expect(screen.queryByText('混.png')).toBeNull()
  })
})
