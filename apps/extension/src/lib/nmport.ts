/**
 * SW 侧 NM port 封装：connectNative 管理 + 消息类型收窄。
 * Chrome 110+ 开放的 NM port 本身保活 SW，任务期间不会休眠。
 */
import type { ExtToHost, HostToExt } from '@pagedive/shared'

const HOST_NAME = 'com.pagedive.host'

export class NmPort {
  private port: chrome.runtime.Port | null = null
  private handlers = new Set<(m: HostToExt) => void>()
  private disconnectHandlers = new Set<() => void>()

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
      this.port = null
      for (const h of this.disconnectHandlers) h()
    })
    return true
  }

  get connected(): boolean {
    return this.port !== null
  }

  /** lastError 描述（host 未安装时 Chrome 填 "Specified native host not found"） */
  get lastError(): string {
    return chrome.runtime.lastError?.message ?? ''
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
