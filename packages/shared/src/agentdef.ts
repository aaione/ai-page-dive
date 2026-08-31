import type { PageContent } from './page.js'

/**
 * CLI 适配器定义（声明式）。接口按六家字段并集设计（claude/codex/opencode/
 * gemini/qwen/dsh），v1 只实现 claude + codex 两家。
 */
export interface AgentDef {
  id: string
  /** 主二进制名（PATH 上查找） */
  bin: string
  /** argv 兼容替身（如 bun 装的 cli） */
  fallbackBins?: string[]
  versionArgs: string[]
  /** 接受的 release line；不匹配只告警不阻断 */
  supportedVersionPattern?: RegExp

  /** 构造 CLI argv。prompt 一律走 stdin（硬约束），此处不含正文 */
  buildArgs: (opts: BuildArgsOpts) => string[]
  streamFormat: 'claude-stream-json' | 'codex-jsonl' | 'plain-stream'

  /** 会话恢复位（v2 追问对话用，v1 仅留接口） */
  resume?: { mode: 'specify' } | { mode: 'capture'; eventId: string }
}

export interface BuildArgsOpts {
  /** 正文临时文件绝对路径（写进 prompt，agent 用 Read 分段读） */
  contentFile: string
  /** codex -o 最终消息落盘路径 */
  lastMsgFile?: string
}

/** host 归一化后的流事件（两家解析器的统一输出） */
export type AgentEvent =
  | { type: 'status'; phase: 'spawned' | 'reading' | 'thinking' }
  | { type: 'text-delta'; text: string }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number }
  | { type: 'result'; isError: boolean; text: string }

/** 任务输入（task-start 消息携带，正文经 task-content 分片递送） */
export interface TaskInput {
  taskId: string
  agentId: string
  workflow?: string
  page: Omit<PageContent, 'contentMarkdown'>
}
