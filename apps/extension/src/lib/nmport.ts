/**
 * SW 侧 NM port 封装：connectNative 管理 + 消息类型收窄。
 * Chrome 110+ 开放的 NM port 本身保活 SW，任务期间不会休眠。
 * 注意：connectNative 几乎不同步抛错，「host 未安装」以 onDisconnect 到达，
 * connected 只代表 port 对象存在，真实可用性由 ping→pong 探测判定。
 */
import type { ExtToHost, HostToExt } from '@ai-page-dive/shared'

const HOST_NAME = 'com.pagedive.host'

export class NmPort {
  private port: chrome.runtime.Port | null = null
  private handlers = new Set<(m: HostToExt) => void>()
  private disconnectHandlers = new Set<() => void>()
  /** onDisconnect 内读取（lastError 只在事件回调内有效） */
  private lastDisconnectError = ''

  connect(): boolean {
    if (this.port) return true
    try {
      this.port = chrome.runtime.connectNative(HOST_NAME)
    } catch {
      this.port = null
      return false
    }
    this.port.onMessage.addListener((m: HostToExt) => {
      for (const h of this.handlers) h(m)
    })
    this.port.onDisconnect.addListener(() => {
      this.lastDisconnectError = chrome.runtime.lastError?.message ?? 'port disconnected'
      this.port = null
      for (const h of this.disconnectHandlers) h()
    })
    return true
  }

  get connected(): boolean {
    return this.port !== null
  }

  get lastError(): string {
    return this.lastDisconnectError
  }

  /** 真实可用性探测：发 ping 等 pong（node 冷启动可慢，默认 8s）。
   * hostVersion 透出供诊断（host/扩展更新节奏脱钩，旧 host 对新消息静默无响应） */
  probe(timeoutMs = 8000): Promise<{ ok: boolean; error?: string; hostVersion?: string }> {
    return new Promise((resolve) => {
      if (!this.connect()) return resolve({ ok: false, error: 'connect failed' })
      const timer = setTimeout(() => {
        unlisten()
        resolve({ ok: false, error: this.lastDisconnectError || 'ping timeout' })
      }, timeoutMs)
      const onMsg = (m: HostToExt) => {
        if (m.t === 'pong') {
          clearTimeout(timer)
          unlisten()
          resolve({ ok: true, hostVersion: m.hostVersion })
        }
      }
      const onDisc = () => {
        clearTimeout(timer)
        unlisten()
        resolve({ ok: false, error: this.lastDisconnectError || 'host disconnected' })
      }
      const unlisten = () => {
        this.handlers.delete(onMsg)
        this.disconnectHandlers.delete(onDisc)
      }
      this.handlers.add(onMsg)
      this.disconnectHandlers.add(onDisc)
      this.port!.postMessage({ t: 'ping' } as ExtToHost)
    })
  }

  send(msg: ExtToHost): boolean {
    if (!this.connect()) return false
    try {
      this.port!.postMessage(msg)
      return true
    } catch {
      // host 刚死但 onDisconnect 尚未派发（下一 tick）：port 仍非 null，postMessage
      // 同步抛「Attempting to use a disconnected port object」。清 port 让下次 connect
      // 重建，返回 false 让上层按 host-not-found 处理（不让异常冒泡污染 currentTask 清理）
      this.port = null
      return false
    }
  }

  onMessage(h: (m: HostToExt) => void): void {
    this.handlers.add(h)
  }

  onDisconnect(h: () => void): void {
    this.disconnectHandlers.add(h)
  }
}

export const nmPort = new NmPort()
