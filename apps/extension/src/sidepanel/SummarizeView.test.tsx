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
