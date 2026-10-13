import { describe, expect, it } from 'vitest'
import { ERROR_LABEL, START_FAIL_LABEL, stampTerminal } from './terminal.js'

// r74（r73 code high#2）：终局三戳谓词直测——UNDELIVERED_CODES.has 生产逻辑此前
// 零测试执行（tips 五态测试手搓 props），本文件是其第一道回归网；谱系口径见
// terminal.ts 头注释（r71 C9 起源 / r72 content-mismatch / r74 host-shutting-down 收编）。

describe('stampTerminal 终局三戳', () => {
  it('cancelled：取消态，非未送达非 CLI 锅', () => {
    expect(stampTerminal('cancelled')).toEqual({ cancelled: true, undelivered: false, cliFault: false })
  })

  it('未送达族（提取/注入/通道未起）：undelivered', () => {
    for (const code of ['no-tab', 'extract-crash', 'no-permission', 'empty-content', 'session-lost', 'host-not-found']) {
      expect(stampTerminal(code), code).toEqual({ cancelled: false, undelivered: true, cliFault: true })
    }
  })

  it('spawn-fail：未送达且 CLI 侧失败并存（CLI 没起来，锅在 CLI 装配不在页面分享）', () => {
    expect(stampTerminal('spawn-fail')).toEqual({ cancelled: false, undelivered: true, cliFault: true })
  })

  it('r74 收编 host-shutting-down：收割窗内拒收=正文从未过 stdin', () => {
    expect(stampTerminal('host-shutting-down')).toEqual({ cancelled: false, undelivered: true, cliFault: true })
  })

  it('r72 收编 content-mismatch：未送达（对账超时即取消，spawn 前）且非 CLI 锅', () => {
    expect(stampTerminal('content-mismatch')).toEqual({ cancelled: false, undelivered: true, cliFault: false })
  })

  it('已送达失败族（正文已过 stdin 的生成阶段失败）：非未送达、CLI 锅', () => {
    for (const code of ['timeout', 'parse', 'host-disconnected']) {
      expect(stampTerminal(code), code).toEqual({ cancelled: false, undelivered: false, cliFault: true })
    }
  })

  it('r76 拆码 runtime-error：spawn 已成功——已送达失败族，非 spawn-fail 的未送达谱系', () => {
    expect(stampTerminal('runtime-error')).toEqual({ cancelled: false, undelivered: false, cliFault: true })
  })

  it('ext-restarted：扩展自身重启，非 CLI 锅', () => {
    expect(stampTerminal('ext-restarted')).toEqual({ cancelled: false, undelivered: false, cliFault: false })
  })

  it('空码（无 code 的终局帧）：三戳全 false——落默认展示路径', () => {
    expect(stampTerminal(undefined)).toEqual({ cancelled: false, undelivered: false, cliFault: true })
    expect(stampTerminal('')).toEqual({ cancelled: false, undelivered: false, cliFault: true })
  })
})

describe('ERROR_LABEL 键域（Partial：未送达族走各自专属展示，不进本表）', () => {
  it('终局码有文案；未送达族不在表（走 onStartResult 专属文案/兜底）', () => {
    expect(ERROR_LABEL.timeout).toContain('任务超时')
    expect(ERROR_LABEL['host-disconnected']).toContain('连接中断')
    expect(ERROR_LABEL['runtime-error']).toContain('运行中异常退出')
    // r80 审计：收件箱补发通道（missedErrBubble）只查本表——运行期 session-lost
    // 缺键即「未知错误+裸英文」（r72 host-disconnected 同型复发，删键即红）
    expect(ERROR_LABEL['session-lost']).toContain('重新发送')
    expect(ERROR_LABEL['no-tab']).toBeUndefined()
    expect(ERROR_LABEL['extract-crash']).toBeUndefined()
  })

  it('r76 START_FAIL_LABEL：启动前失败族 14 键全有文案（帧/回调双通道同源）', () => {
    // 键全集钉死——删键即红（消费端 App 两通道都查本表，漏键落「未知错误/裸码」）
    for (const code of [
      'host-not-found-retry', 'no-tab', 'unsupported-page', 'pdf-page', 'inject-failed',
      'tab-closed', 'page-not-ready', 'extract-crash', 'no-permission', 'empty-content',
      'cancelled', 'empty-instruction', 'session-lost', 'frame-too-large',
    ] as const) {
      expect(START_FAIL_LABEL[code], code).toBeTruthy()
    }
    // 抽查首跑最高频路径：授权失败不再「未知错误（码 no-permission）」
    expect(START_FAIL_LABEL['no-permission']).toContain('点工具栏上的 PageDive 图标')
  })
})
