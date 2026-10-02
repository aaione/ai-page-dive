import { beforeAll, describe, expect, it } from 'vitest'
import { execSync, spawn } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createFrameReader, encodeFrame, NM_MAX } from '../src/nm.js'
import { REAP_GRACE_MS } from '../src/spawn.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DIST = join(ROOT, 'dist', 'stdio.js')

// r52 排期（报告 #7）：runNative 直接接管 process 信号表/stdin/exit，进程内调用
// 等于劫持 vitest 自身——必须子进程跑。真实 NM 帧协议（4 字节小端长度 + JSON）驱动。
beforeAll(() => {
  // 全量 tsc（~3s）而非直接信任现存 dist：陈旧 dist 会静默测旧代码
  execSync('pnpm build', { cwd: ROOT, stdio: 'pipe' })
}, 60_000)

function spawnHost() {
  const child = spawn(process.execPath, ['-e', `import(${JSON.stringify(DIST)}).then((m) => {
    m.runNative()
    // 测试探针：在 runNative 的 SIGTERM(shutdown) 监听之后注册——stderr 见到本行
    // 即可断定 shuttingDown 已置位，随后的 task-start 必走关停闸门
    process.on('SIGTERM', () => console.error('[pd-test] term'))
  })`])
  const frames: any[] = []
  const stderr: string[] = []
  // stdout 不设 encoding：createFrameReader 按 Buffer 拼帧（setEncoding 会把
  // data 变 string，Buffer.concat 直接抛 ERR_INVALID_ARG_TYPE）
  child.stdout!.on('data', createFrameReader((m) => frames.push(m)))
  child.stderr!.setEncoding('utf8')
  child.stderr!.on('data', (d: string) => stderr.push(d))
  const write = (obj: unknown) => child.stdin!.write(encodeFrame(obj))
  const exited = new Promise<{ code: number | null }>((res) => child.on('exit', (code) => res({ code })))
  return { child, frames, stderr, write, exited }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

// r54：三处 wait(150) 起跑魔数 → ping/pong 就绪握手。慢机上 150ms 内 import 可能
// 未完成：SIGTERM 案 kill 落在探针注册前（'term' 永不出现）、超限帧头案写头早于
// desync 监听，均系时序赌博；pong 到手 = runNative 已挂全部监听
async function ready(h: ReturnType<typeof spawnHost>) {
  h.write({ t: 'ping' })
  const dl = Date.now() + 5000
  while (!h.frames.some((f) => f.t === 'pong') && Date.now() < dl) await wait(50)
  expect(h.frames.some((f) => f.t === 'pong'), 'host 未在 5s 内应答 ping（起跑失败）').toBe(true)
}

describe('runNative 关停路径（子进程集成）', () => {
  it('stdin end（Chrome 断连）→ 收割窗口后 exit 0——窗口不得消失（立即 exit 会使 SIGKILL 兜底永不触发，r33）', async () => {
    const h = spawnHost()
    await ready(h)
    h.child.stdin!.end()
    const t0 = Date.now()
    const { code } = await h.exited
    const dt = Date.now() - t0
    expect(code).toBe(0)
    expect(dt, `exit 前须保留收割窗口（实测 ${dt}ms）`).toBeGreaterThanOrEqual(REAP_GRACE_MS - 200)
    expect(dt, `不得挂死（实测 ${dt}ms）`).toBeLessThan(REAP_GRACE_MS + 200 + 3000)
  }, 15_000)

  it('SIGTERM 关停窗口内的 task-start → host-shutting-down 错误帧（r7-review 专用 code），不触达 spawn', async () => {
    const h = spawnHost()
    await ready(h)
    h.child.kill('SIGTERM')
    // 等 [pd-test] term 探针：确保 shuttingDown 已置位、task-start 必然命中闸门
    const deadline = Date.now() + 3000
    while (!h.stderr.join('').includes('[pd-test] term') && Date.now() < deadline) await wait(50)
    expect(h.stderr.join('')).toContain('[pd-test] term')
    h.write({
      t: 'task-start',
      task: { taskId: 'x1', agentId: 'claude', page: { url: 'https://a', title: 'T', extractor: 'test', approxTokens: 1 } },
    })
    // 帧必须在 exit(3.2s) 前回到；断言窗口给 2.5s 足够
    const dl2 = Date.now() + 2500
    while (!h.frames.some((f) => f.t === 'task-error') && Date.now() < dl2) await wait(50)
    expect(h.frames.find((f) => f.t === 'task-error')).toMatchObject({ taskId: 'x1', code: 'host-shutting-down' })
    const { code } = await h.exited
    expect(code).toBe(0)
  }, 15_000)

  it('超限帧头（NM 流失步）→ 收割终结，exit 0 而非挂死', async () => {
    const h = spawnHost()
    await ready(h)
    const head = Buffer.alloc(4)
    head.writeUInt32LE(NM_MAX + 1, 0)
    h.child.stdin!.write(head)
    const { code } = await h.exited
    expect(code).toBe(0)
    expect(h.stderr.join('')).toContain('desynced')
  }, 15_000)
})
