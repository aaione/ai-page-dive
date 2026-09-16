import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cliEnv, cliPath } from '../src/agents/registry.js'

// 密封环境：假 HOME + 假 nvm 目录结构——CI 上没有 claude/nvm 也能测真实逻辑
// （r8-ci：旧版直连本机 nvm/claude，在 GH Actions runner 上必红）
const savedHome = process.env.HOME
const savedPath = process.env.PATH
let fakeHome: string

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), 'pd-registry-'))
  process.env.HOME = fakeHome
  process.env.PATH = '/usr/bin:/bin:/usr/sbin:/sbin'
})

afterEach(() => {
  process.env.HOME = savedHome
  process.env.PATH = savedPath
})

const nvmBin = () => join(fakeHome, '.nvm/versions/node/v20.0.0/bin')

describe('极简 PATH 兼容（Chrome Dock 启动场景）', () => {
  it('cliPath 包含 nvm 各版本 bin 与 homebrew 目录，原 PATH 保留在尾部', () => {
    mkdirSync(nvmBin(), { recursive: true })
    const p = cliPath()
    expect(p).toContain(nvmBin())
    expect(p).toContain('/opt/homebrew/bin')
    expect(p.endsWith('/usr/bin:/bin:/usr/sbin:/sbin')).toBe(true)
  })

  it('无 nvm 时不报错，homebrew 目录仍在前', () => {
    const p = cliPath()
    expect(p).not.toContain('.nvm')
    expect(p.startsWith('/opt/homebrew/bin')).toBe(true)
  })

  it('极简 PATH 环境下 cliEnv 仍能定位 nvm bin 里的 CLI', () => {
    // 模拟 Chrome Dock 启动：系统目录里没有 CLI，CLI 装在 nvm bin 下
    mkdirSync(nvmBin(), { recursive: true })
    const claude = join(nvmBin(), 'claude')
    writeFileSync(claude, '#!/bin/sh\nexit 0\n')
    chmodSync(claude, 0o755)
    // execFileSync 直接回 stdout 字符串——vitest 模块包装下 promisify(execFile)
    // 的返回形状不稳（r8-ci 实测 resolve 成空数组），不值得赌
    const out = execFileSync('which', ['claude'], { env: cliEnv(), encoding: 'utf8' })
    expect(out).toContain(nvmBin())
  })
})
