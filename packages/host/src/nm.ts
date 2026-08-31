/**
 * Native Messaging 长度前缀帧编解码（零依赖）。
 * 协议：4 字节小端长度 + UTF-8 JSON body。
 * Chrome 限制单条 ≤1MB，超大 payload 由上层分片。
 */
import type { Duplex } from 'node:stream'

export const NM_MAX = 1024 * 1024

export function encodeFrame(obj: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(obj), 'utf8')
  if (4 + body.length > NM_MAX) {
    throw new Error(`frame too large: ${body.length + 4} bytes (max ${NM_MAX})`)
  }
  const head = Buffer.alloc(4)
  head.writeUInt32LE(body.length, 0)
  return Buffer.concat([head, body])
}

export function writeFrame(sock: Duplex, obj: unknown): void {
  sock.write(encodeFrame(obj))
}

/** 增量状态机：处理任意 chunk 边界切分的帧流 */
export function createFrameReader(onMsg: (obj: any) => void): (d: Buffer) => void {
  let buf = Buffer.alloc(0)
  return (d: Buffer) => {
    buf = Buffer.concat([buf, d])
    for (;;) {
      if (buf.length < 4) break
      const len = buf.readUInt32LE(0)
      if (buf.length < 4 + len) break
      try {
        onMsg(JSON.parse(buf.subarray(4, 4 + len).toString('utf8')))
      } catch {
        // 单条 JSON 损坏：丢弃该帧，不崩协议
      }
      buf = buf.subarray(4 + len)
    }
  }
}
