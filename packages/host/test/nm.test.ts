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
})
