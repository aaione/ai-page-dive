import { describe, expect, it } from 'vitest'
import { createFrameReader, encodeFrame } from '../src/nm.js'

describe('NM 帧编解码', () => {
  it('往返：encode → 任意边界切分喂 reader → 还原对象', () => {
    const obj = { t: 'task-chunk', text: '你好'.repeat(1000) }
    const frame = encodeFrame(obj)
    const got: any[] = []
    const feed = createFrameReader((o) => got.push(o))
    // 逐字节喂：最苛刻的边界
    for (const b of frame) feed(Buffer.from([b]))
    expect(got).toEqual([obj])
  })

  it('一 chunk 多帧 + 半帧滞留', () => {
    const a = encodeFrame({ t: 'ping' })
    const b = encodeFrame({ t: 'pong' })
    const got: any[] = []
    const feed = createFrameReader((o) => got.push(o))
    feed(Buffer.concat([a, b.subarray(0, 3)])) // 两帧 + 半个头
    feed(b.subarray(3)) // 补齐
    expect(got).toEqual([{ t: 'ping' }, { t: 'pong' }])
  })

  it('>1MB 帧 encode 拒绝', () => {
    expect(() => encodeFrame({ t: 'x', text: 'a'.repeat(1024 * 1024) })).toThrow()
  })

  it('超限帧头 → onDesync 终结，不再丢缓冲假降级（r6-sec 失步不可自愈）', () => {
    const desynced: number[] = []
    const got: any[] = []
    // maxLength=64 模拟超限；失步必须经 onDesync 上报（stdio 层收割+退出），不走默认 exit 杀测试进程
    const feed = createFrameReader((o) => got.push(o), 64, () => desynced.push(1))
    const evilHead = Buffer.alloc(4)
    evilHead.writeUInt32LE(0xffffffff, 0) // 损坏/恶意帧头
    feed(evilHead)
    feed(encodeFrame({ t: 'ping' })) // 失步后的正常字节不得被当新帧解析（丢缓冲时代会成随机帧头）
    expect(desynced).toEqual([1])
    expect(got).toEqual([])
  })

  // r58（#27）：handler 同步异常此前与 JSON 损坏共用一个 catch——真实异常被伪装成
  // 「bad json」静默吞帧（r54 #10 可观测），排障方向被带偏。分型上报 + 缓冲照常前进
  it('handler 同步异常：分型上报（handler threw ≠ bad json）+ 缓冲前进不吞后续帧（r58 #27）', () => {
    const errs: string[] = []
    const origErr = console.error
    console.error = (...a: unknown[]) => errs.push(a.map(String).join(' '))
    try {
      const got: any[] = []
      const feed = createFrameReader((o) => {
        if (o.t === 'boom') throw new Error('handler kaboom')
        got.push(o)
      })
      // 手工组坏 JSON 帧（encodeFrame 只产合法 JSON）：SyntaxError 分型
      const garbage = Buffer.from('{"broken')
      const head = Buffer.alloc(4)
      head.writeUInt32LE(garbage.length, 0)
      feed(Buffer.concat([head, garbage]))
      feed(encodeFrame({ t: 'boom' })) // handler 同步抛错：非 SyntaxError 分型
      feed(encodeFrame({ t: 'ping' })) // 前两帧的异常都不得吃掉缓冲——本帧照常解出
      expect(got).toEqual([{ t: 'ping' }])
      expect(errs.some((e) => e.includes('bad json'))).toBe(true)
      expect(errs.some((e) => e.includes('handler threw:') && e.includes('handler kaboom'))).toBe(true)
    } finally {
      console.error = origErr
    }
  })
})
