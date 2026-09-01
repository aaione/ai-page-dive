/**
 * SW 侧 NM port 封装：connectNative 管理 + 消息类型收窄。
 * Chrome 110+ 开放的 NM port 本身保活 SW，任务期间不会休眠。
 * 注意：connectNative 几乎不同步抛错，「host 未安装」以 onDisconnect 到达，
 * connected 只代表 port 对象存在，真实可用性由 ping→pong 探测判定。
 */
import type { ExtToHost, HostToExt } from '@pagedive/shared'

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

  /** 真实可用性探测：发 ping 等 pong（node 冷启动可慢，默认 8s） */
  probe(timeoutMs = 8000): Promise<{ ok: boolean; error?: string }> {
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
          resolve({ ok: true })
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
    this.port!.postMessage(msg)
    return true
  }

  onMessage(h: (m: HostToExt) => void): void {
    this.handlers.add(h)
  }

  onDisconnect(h: () => void): void {
    this.disconnectHandlers.add(h)
  }
}

export const nmPort = new NmPort()
