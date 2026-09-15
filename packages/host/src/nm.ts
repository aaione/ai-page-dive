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
 * maxLength：帧头声明长度超限即终结——损坏/恶意的 4 字节头（如 0xFFFFFFFF）
 * 会让缓冲无界累积（内存 DoS 面）。对端是自家扩展（可信环境），这是协议鲁棒性兜底。
 * onDesync：失步回调（stdio.ts 传入收割+退出路径）；未传时直接退出兜底。 */
export function createFrameReader(onMsg: (obj: any) => void, maxLength = NM_MAX, onDesync?: () => void): (d: Buffer) => void {
  let buf = Buffer.alloc(0)
  let desynced = false
  return (d: Buffer) => {
    if (desynced) return // 已失步终结：纯下沉（不再解析/不再上报），等进程退出
    buf = Buffer.concat([buf, d])
    for (;;) {
      if (buf.length < 4) break
      const len = buf.readUInt32LE(0)
      if (len > maxLength) {
        // r5-sec：超限帧曾在 stdin 回调内同步 throw → uncaughtException 崩整个
        // host（多附件可组出 >1MB 单帧）。r6-sec：丢缓冲降级同样不可救——失步后
        // 后续字节被解析成随机帧头，协议永久毒化，host 成哑巴直到 SW 看门狗
        // 120s 假超时。失步唯一正确响应是终结本进程：断连可由 SW 重 spawn 自愈
        // （panel 收尾气泡提示重试），失步不可自愈。优先走 onDesync（收割在跑的
        // CLI 进程树再退，防泄漏空烧订阅），未传时裸退出
        console.error(`[pd] frame length ${len} exceeds max ${maxLength}, NM stream desynced — terminating host`)
        desynced = true
        if (onDesync) onDesync()
        else process.exit(1)
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
