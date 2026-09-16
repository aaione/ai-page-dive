import type { PageContent } from './page.js'

/**
 * CLI 适配器定义（声明式）。接口按六家字段并集设计（claude/codex/opencode/
 * gemini/qwen/dsh）。v1 实现 claude + codex（opencode 实验档，见 DECISIONS D5）。
 */
export interface AgentDef {
  id: string
  /** 主二进制名（PATH 上查找） */
  bin: string
  /** argv 兼容替身（如 bun 装的 cli） */
  fallbackBins?: string[]
  versionArgs: string[]

  /** 构造 CLI argv。prompt 一律走 stdin（硬约束），此处不含正文 */
  buildArgs: (opts: BuildArgsOpts) => string[]
  streamFormat: 'claude-stream-json' | 'codex-jsonl' | 'opencode-jsonl' | 'plain-stream'
  /**
   * 正文文件渲染成 CLI 视角的路径（写进 prompt）。opencode 沙箱只准读 cwd，
   * 用相对路径；其余给绝对路径。
   */
  filePathInPrompt?: (opts: BuildArgsOpts) => string

  /** 探测时从 CLI 本地配置读默认模型（best-effort，读不到 undefined）——
   * 各 CLI 的私有配置路径/格式知识留在各自适配器内，registry 不做 id 特判 */
  probeModel?: () => string | undefined
}

export interface BuildArgsOpts {
  /** 正文临时文件绝对路径（写进 prompt，agent 用 Read 分段读）；追问轮为空串 */
  contentFile: string
  /** 正文文件相对于 CLI cwd 的路径（opencode 等只准读 cwd 的 CLI 用） */
  contentRelPath?: string
  /** CLI 工作目录（opencode 需 --dir 显式钉死，防 git root 漂移） */
  agentCwd?: string
  /** 追问轮：续接上一轮 CLI 会话（claude --resume） */
  resumeSessionId?: string
}

/** host 归一化后的流事件（解析器的统一输出） */
export type AgentEvent =
  | { type: 'status'; phase: 'spawned' | 'reading' | 'thinking' }
  | { type: 'meta'; model?: string; sessionId?: string }
  | { type: 'text-delta'; text: string }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number }
  | { type: 'result'; isError: boolean; text: string }

/** 任务输入（task-start 消息携带，正文经 task-content 分片递送） */
export interface TaskInput {
  taskId: string
  agentId: string
  workflow?: string
  /** 用户自由输入（默认模式任务段，优先于 workflow 正文；追问轮即追问内容） */
  instruction?: string
  /** 追问轮：续接 CLI 会话（此时无正文/工作流，prompt 只剩 instruction） */
  resumeSessionId?: string
  /** 追问轮：首轮历史文件路径（本轮 user/assistant append 进同一文件，还原多轮对话） */
  historyPath?: string
  /** 启用的技能名（host 读 ~/.ai-page-dive/skills 正文拼进 prompt） */
  skills?: string[]
  /** 总结输出语言（如 'zh'/'en'；缺省跟语言自动判断） */
  lang?: string
  /** 附件（panel 读的文本，host 落临时文件后 prompt 给路径；追问轮同样生效） */
  attachments?: { name: string; text: string }[]
  page: Omit<PageContent, 'contentMarkdown'>
}
