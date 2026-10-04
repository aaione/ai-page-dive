import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnCli, REAP_GRACE_MS } from '../src/spawn.js'

const alive = (pid?: number) => {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// r52 排期（报告 #7）：硬约束 #5 点名的收割链零覆盖——改成 kill(pid) 单杀或删
// SIGKILL 兜底，此前 128 用例一个不会红。本测试锚两级语义：
// ①SIGTERM→REAP_GRACE→SIGKILL 升级（忽略 TERM 的树必须靠 KILL 收割）
// ②kill(-pid) 组语义（孙进程必须随组死亡，单杀只杀组长则孙进程孤儿逃生）
describe('spawnCli 收割链', () => {
  it('SIGTERM 被整树忽略时升级 SIGKILL，且组语义收割孙进程', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pd-reap-'))
    const script = join(dir, 'cli.mjs')
    // 假 CLI：自己忽略 SIGTERM，再派生一个同样忽略 SIGTERM 的孙进程（同进程组）。
    // 印记行回传两级 pid；孙进程就绪标记经继承的 stderr 通道回传——不等就绪就 reap
    // 会把 SIGTERM 打在孙进程尚未注册 handler 的冷启动窗内（默认终止，升级前提失效）
    await writeFile(
      script,
      `import { spawn } from 'node:child_process'
process.on('SIGTERM', () => {}) // 模拟不理会 TERM 的 CLI / 其工具子进程
const g = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});console.error('GC_READY');setInterval(()=>{},1e9)"], { stdio: ['ignore', 'pipe', 'inherit'] })
console.log(JSON.stringify({ child: process.pid, grandchild: g.pid }))
setInterval(() => {}, 1e9)
`,
      'utf8',
    )
    let ids: { child: number; grandchild: number } | undefined
    let gcReady = false
    const proc = await spawnCli({
      bin: process.execPath,
      args: [script],
      stdinData: '',
      onStdoutLine: (l) => {
        try {
          const m = JSON.parse(l)
          if (m.grandchild) ids = m
        } catch { /* 非 JSON 行忽略 */ }
      },
      onStderr: (d) => {
        if (String(d).includes('GC_READY')) gcReady = true
      },
    })
    try {
      const ready = Date.now() + 5000
      while ((!ids || !gcReady) && Date.now() < ready) await new Promise((r) => setTimeout(r, 50))
      expect(ids, '假 CLI 印记行未到达').toBeTruthy()
      expect(gcReady, '孙进程就绪标记未到达').toBe(true)
      expect(alive(ids!.child) && alive(ids!.grandchild)).toBe(true)

      proc.reap()

      // SIGTERM 已发但整树忽略——升级窗内两级都还活着（证明 SIGKILL 兜底是必需路径）
      await new Promise((r) => setTimeout(r, 500))
      expect(alive(ids!.child), 'child 不应被 SIGTERM 杀死（本测试的升级前提）').toBe(true)
      expect(alive(ids!.grandchild), 'grandchild 不应被 SIGTERM 杀死（本测试的升级前提）').toBe(true)

      // SIGKILL 兜底：REAP_GRACE_MS 后组内全灭——grandchild 死亡是 kill(-pgid)
      // 组语义的直接证据（kill(child.pid) 单杀会留下孤儿孙进程，本断言超时变红）
      const deadline = Date.now() + REAP_GRACE_MS + 3000
      while ((alive(ids!.child) || alive(ids!.grandchild)) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100))
      }
      expect(alive(ids!.child)).toBe(false)
      expect(alive(ids!.grandchild)).toBe(false)
    } finally {
      // 断言失败时的兜底清扫：别让忽略信号的进程组漏出测试烧机器
      try {
        process.kill(-proc.child.pid!, 'SIGKILL')
      } catch { /* 已死 */ }
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }, 15_000)

  // r58（N2）：组长不抗 SIGTERM（默认行为即死）、孙进程抗信号——旧实现的 SIGKILL
  // 兜底被「组长已退（exitCode 非 null）」守卫短路，孙进程永久逃逸烧配额。
  // 本测锚升级路径：组长死于 TERM 后，兜底仍须对残组发 SIGKILL
  it('组长死于 SIGTERM 而孙进程抗信号：SIGKILL 兜底不被组长先退短路（r58 N2）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pd-reap2-'))
    const script = join(dir, 'cli.mjs')
    // 假 CLI：组长【不】注册 SIGTERM handler（TERM 即死），孙进程忽略 TERM
    await writeFile(
      script,
      `import { spawn } from 'node:child_process'
const g = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});console.error('GC_READY');setInterval(()=>{},1e9)"], { stdio: ['ignore', 'pipe', 'inherit'] })
console.log(JSON.stringify({ child: process.pid, grandchild: g.pid }))
setInterval(() => {}, 1e9)
`,
      'utf8',
    )
    let ids: { child: number; grandchild: number } | undefined
    let gcReady = false
    const proc = await spawnCli({
      bin: process.execPath,
      args: [script],
      stdinData: '',
      onStdoutLine: (l) => {
        try {
          const m = JSON.parse(l)
          if (m.grandchild) ids = m
        } catch { /* 非 JSON 行忽略 */ }
      },
      onStderr: (d) => {
        if (String(d).includes('GC_READY')) gcReady = true
      },
    })
    try {
      const ready = Date.now() + 5000
      while ((!ids || !gcReady) && Date.now() < ready) await new Promise((r) => setTimeout(r, 50))
      expect(ids, '假 CLI 印记行未到达').toBeTruthy()
      expect(gcReady, '孙进程就绪标记未到达').toBe(true)

      proc.reap()
      await new Promise((r) => setTimeout(r, 500))
      // 升级前提：组长已被 SIGTERM 杀死（exitCode 已置），孙进程靠抗信号存活
      expect(alive(ids!.child), '组长应死于 SIGTERM（本测试的升级前提）').toBe(false)
      expect(alive(ids!.grandchild), '孙进程不应被 SIGTERM 杀死（升级前提）').toBe(true)

      // 旧实现在此形态下 SIGKILL 永不触发（组长先退守卫 return）→ 孙进程永活
      const deadline = Date.now() + REAP_GRACE_MS + 3000
      while (alive(ids!.grandchild) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100))
      }
      expect(alive(ids!.grandchild), 'SIGKILL 兜底应收割抗信号的孙进程').toBe(false)
    } finally {
      try {
        process.kill(-proc.child.pid!, 'SIGKILL')
      } catch { /* 已死 */ }
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }, 15_000)
})
