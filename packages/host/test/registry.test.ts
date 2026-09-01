import { describe, expect, it } from 'vitest'
import { cliEnv, cliPath } from '../src/agents/registry.js'

describe('极简 PATH 兼容（Chrome Dock 启动场景）', () => {
  it('cliPath 包含 nvm 各版本 bin 与 homebrew 目录', () => {
    const p = cliPath()
    expect(p).toContain('/opt/homebrew/bin')
    expect(p).toContain('.nvm/versions/node')
    // 原有 PATH 保留在尾部（shell 启动时是超集）
    expect(p.endsWith(process.env.PATH ?? '')).toBe(true)
  })

  it('极简 PATH 环境下 cliEnv 仍能定位本机 claude/codex', async () => {
    // 模拟 Chrome Dock 启动：只有系统目录
    const saved = process.env.PATH
    process.env.PATH = '/usr/bin:/bin:/usr/sbin:/sbin'
    try {
      const env = cliEnv()
      const { execFile: ef } = await import('node:child_process')
      const { promisify } = await import('node:util')
      const which = promisify(ef) as any
      // 本机装了 claude（E2E 环境前提）；只验证 which 能找到，不要求版本输出
      await expect(which('which', ['claude'], { env })).resolves.toBeTruthy()
    } finally {
      process.env.PATH = saved
    }
  })
})
