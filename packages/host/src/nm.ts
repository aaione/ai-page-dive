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

/** 增量状态机：处理任意 chunk 边界切分的帧流。
 * maxLength：帧头声明长度超限即报错中止——损坏/恶意的 4 字节头（如 0xFFFFFFFF）
 * 会让缓冲无界累积（内存 DoS 面）。对端是自家扩展（可信环境），这是协议鲁棒性兜底。 */
export function createFrameReader(onMsg: (obj: any) => void, maxLength = NM_MAX): (d: Buffer) => void {
  let buf = Buffer.alloc(0)
  return (d: Buffer) => {
    buf = Buffer.concat([buf, d])
    for (;;) {
      if (buf.length < 4) break
      const len = buf.readUInt32LE(0)
      if (len > maxLength) {
        // r5-sec：超限帧曾在 stdin 回调内同步 throw → uncaughtException 崩整个
        // host（多附件可组出 >1MB 单帧）。改为丢缓冲降级：协议已失步，后续由
        // SW 看门狗/超时发现断流；SW 侧附件总量预算是第一道防线
        console.error(`[pd] frame length ${len} exceeds max ${maxLength}, dropping stream`)
        buf = Buffer.alloc(0)
        return
      }
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
