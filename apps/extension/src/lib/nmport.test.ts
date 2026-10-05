/**
 * r58（#37）：nmport 零测试——SW 唯一 IO 依赖被 sw.test 整体 vi.mock，
 * probe 超时/stale-port/重建分支回归时测试全绿照跑。此处直测 NmPort 类：
 * chrome.runtime 全局 stub（connectNative 返回可控 port），每个 it 新实例。
 * probe 的 timeoutMs 参数用短值（30ms）真实等待——无需 fake timers。
 */
import { describe, expect, it, vi } from 'vitest'
import { NmPort } from './nmport.js'

type Listener = (...a: any[]) => void

function makeChrome(ports: any[]) {
  return {
    runtime: {
      connectNative: vi.fn(() => {
        const p = {
          postMessage: vi.fn(),
          msgL: [] as Listener[],
          discL: [] as Listener[],
          onMessage: { addListener: (f: Listener) => p.msgL.push(f) },
          onDisconnect: { addListener: (f: Listener) => p.discL.push(f) },
        }
        ports.push(p)
        return p
      }),
      lastError: null as { message?: string } | null,
    },
  }
}

function setup() {
  const ports: any[] = []
  const chrome = makeChrome(ports)
  ;(globalThis as any).chrome = chrome
  return { ports, chrome, port: () => new NmPort() }
}

describe('NmPort（r58 #37 盲区）', () => {
  it('probe 成功：ping → pong 回 ok + hostVersion', async () => {
    const { ports, port } = setup()
    const p = port().probe(500)
    await new Promise((r) => setTimeout(r, 5))
    expect(ports[0].postMessage).toHaveBeenCalledWith({ t: 'ping' })
    ports[0].msgL[0]({ t: 'pong', hostVersion: '9.9.9' })
    expect(await p).toEqual({ ok: true, hostVersion: '9.9.9' })
  })

  it('probe 超时：无 pong → error=ping timeout（r58 #29：上代断连错误不得跨代顶替）', async () => {
    const { ports, port } = setup()
    const np = port()
    // 第一代 port：断连并留下死因（onDisconnect 内 chrome.runtime.lastError）
    np.connect()
    ;(globalThis as any).chrome.runtime.lastError = { message: 'host crashed v1' }
    ports[0].discL[0]()
    expect(np.connected).toBe(false)
    // 第二代：重连成功即清陈旧错误——probe 超时上报 ping timeout 而非上一代死因
    const p = np.probe(30)
    const r = await p
    expect(r.ok).toBe(false)
    expect(r.error).toBe('ping timeout')
  })

  it('probe 中途断连：error=onDisconnect 的 lastError 文案', async () => {
    const { ports, port } = setup()
    const np = port()
    const p = np.probe(500)
    await new Promise((r) => setTimeout(r, 5))
    ;(globalThis as any).chrome.runtime.lastError = { message: 'Specified native host not found' }
    ports[0].discL[0]()
    expect(await p).toMatchObject({ ok: false, error: 'Specified native host not found' })
  })

  it('send stale-port：postMessage 同步 throw → false + 清 port，下次 connect 重建（r8-review）', () => {
    const { ports, port } = setup()
    const np = port()
    expect(np.send({ t: 'ping' })).toBe(true)
    // host 刚死但 onDisconnect 未派发：port 仍非 null，postMessage 同步抛
    ports[0].postMessage.mockImplementation(() => {
      throw new Error('Attempting to use a disconnected port object')
    })
    expect(np.send({ t: 'ping' })).toBe(false)
    expect(np.connected).toBe(false)
    // 重建：下一次 send 重拉 connectNative（新 port 对象）
    expect(np.send({ t: 'ping' })).toBe(true)
    expect(ports.length).toBe(2)
  })

  it('connect 失败（connectNative 同步 throw）→ probe/send 均 false 不冒泡', async () => {
    const { chrome, port } = setup()
    ;(chrome.runtime.connectNative as any).mockImplementation(() => {
      throw new Error('native messaging not allowed')
    })
    const np = port()
    expect(await np.probe(30)).toMatchObject({ ok: false, error: 'connect failed' })
    expect(np.send({ t: 'ping' })).toBe(false)
  })
})
