import type { TaskInput } from './agentdef.js'
import type { PageContent } from './page.js'

/** NM 消息协议（extension ↔ host）。每条一个 4 字节小端长度前缀 + 单行 JSON 帧。 */

// ---------- Extension → Host ----------

export interface PingMsg {
  t: 'ping'
}

export interface ListAgentsMsg {
  t: 'list-agents'
}

export interface ListWorkflowsMsg {
  t: 'list-workflows'
}

export interface TaskStartMsg {
  t: 'task-start'
  task: TaskInput
}

/** 正文分片：≤512KB/片，done:true 后 host 落临时文件并 spawn */
export interface TaskContentMsg {
  t: 'task-content'
  taskId: string
  seq: number
  text: string
  done: boolean
}

export interface TaskCancelMsg {
  t: 'task-cancel'
  taskId: string
}

export interface HistoryListMsg {
  t: 'history-list'
  query?: string
  limit?: number
}

export interface HistoryReadMsg {
  t: 'history-read'
  path: string
}

export interface HistoryDeleteMsg {
  t: 'history-delete'
  path: string
}

export interface HistoryRevealMsg {
  t: 'history-reveal'
  path: string
}

// ---------- workflow 管理（目录即插件：~/.pagedive/workflows/<name>/WORKFLOW.md）----------

/** 读单个 workflow 全文（frontmatter + 正文），供设置页编辑 */
export interface WorkflowReadMsg {
  t: 'workflow-read'
  name: string
}

/** 新建/覆盖：写用户目录（shadow 内置同名） */
export interface WorkflowSaveMsg {
  t: 'workflow-save'
  name: string
  description: string
  category?: string
  body: string
}

/** 删除用户目录副本；内置的等价于「恢复默认」（重新露出内置版） */
export interface WorkflowDeleteMsg {
  t: 'workflow-delete'
  name: string
}

/** Finder 打开 workflow 目录 */
export interface WorkflowRevealMsg {
  t: 'workflow-reveal'
  name: string
}

// ---------- skills（~/.pagedive/skills/<name>/SKILL.md，同 workflow 目录即插件机制）----------

export interface ListSkillsMsg {
  t: 'list-skills'
}

export interface SkillRevealMsg {
  t: 'skill-reveal'
  name: string
}

export type ExtToHost =
  | PingMsg
  | ListAgentsMsg
  | ListWorkflowsMsg
  | TaskStartMsg
  | TaskContentMsg
  | TaskCancelMsg
  | HistoryListMsg
  | HistoryReadMsg
  | HistoryDeleteMsg
  | HistoryRevealMsg
  | WorkflowReadMsg
  | WorkflowSaveMsg
  | WorkflowDeleteMsg
  | WorkflowRevealMsg
  | ListSkillsMsg
  | SkillRevealMsg

// ---------- Host → Extension ----------

export interface AgentStatus {
  id: string
  available: boolean
  version?: string
  /** 该 CLI 最近一次任务使用的模型（init 事件捕获，供下拉展示） */
  model?: string
}

export interface PongMsg {
  t: 'pong'
  hostVersion: string
}

export interface AgentsMsg {
  t: 'agents'
  agents: AgentStatus[]
}

export interface WorkflowItem {
  name: string
  description: string
  category?: string
  builtin: boolean
}

export interface WorkflowsMsg {
  t: 'workflows'
  items: WorkflowItem[]
}

/** workflow-read 回包：完整 WORKFLOW.md 原文 */
export interface WorkflowFileMsg {
  t: 'workflow-file'
  name: string
  content: string
}

export interface WorkflowSavedMsg {
  t: 'workflow-saved'
  name: string
}

export interface WorkflowDeletedMsg {
  t: 'workflow-deleted'
  name: string
}

export interface SkillItem {
  name: string
  description: string
  builtin: boolean
}

export interface SkillsMsg {
  t: 'skills'
  items: SkillItem[]
}

export interface TaskStatusMsg {
  t: 'task-status'
  taskId: string
  phase: 'spawned' | 'reading' | 'thinking'
  /** 低频状态更新（不含正文增量） */
}

/** CLI 会话元信息（init 事件捕获）：模型名 + 会话 id（追问用） */
export interface TaskMetaMsg {
  t: 'task-meta'
  taskId: string
  /** 归属 CLI（panel 端 merge 模型名到 agents state 用） */
  agentId?: string
  model?: string
  sessionId?: string
}

export interface TaskChunkMsg {
  t: 'task-chunk'
  taskId: string
  seq: number
  /** 归一化后的增量 markdown，host 侧保证 ≤1MB/片 */
  text: string
}

export interface TaskDoneMsg {
  t: 'task-done'
  taskId: string
  /** 归属 CLI（panel 端 merge 模型名到 agents state 用） */
  agentId?: string
  historyPath: string
  usage?: { inputTokens?: number; outputTokens?: number }
  durationMs: number
  /** claude 运行内失败（is_error）也走这里，isError=true */
  isError: boolean
  errorText?: string
  /** CLI 会话 id（claude），供追问 --resume */
  sessionId?: string
  /** 实际使用的模型名（claude init 事件） */
  model?: string
}

export interface TaskErrorMsg {
  t: 'task-error'
  taskId: string
  code: 'spawn-fail' | 'timeout' | 'cancelled' | 'parse' | 'no-agent' | 'bad-request'
  message: string
}

export interface HistoryItem {
  path: string
  title: string
  url: string
  agent: string
  ts: number
  /** CLI 会话 id（有则支持「继续对话」resume） */
  sessionId?: string
}

export interface HistoryListResultMsg {
  t: 'history-list'
  items: HistoryItem[]
}

export interface HistoryFileMsg {
  t: 'history-file'
  path: string
  content: string
}

export interface DeletedMsg {
  t: 'deleted'
  path: string
}

export interface ErrorMsg {
  t: 'error'
  code: string
  message: string
}

export type HostToExt =
  | PongMsg
  | AgentsMsg
  | WorkflowsMsg
  | WorkflowFileMsg
  | WorkflowSavedMsg
  | WorkflowDeletedMsg
  | SkillsMsg
  | TaskStatusMsg
  | TaskMetaMsg
  | TaskChunkMsg
  | TaskDoneMsg
  | TaskErrorMsg
  | HistoryListResultMsg
  | HistoryFileMsg
  | DeletedMsg
  | ErrorMsg
  /** SW 合成：NM host 断连（panel 据此停止 loading 并提示） */
  | { t: '__host-disconnected' }

/** 单帧最大 payload（NM 限制 1MB，host→ext 的 chunk 必须分片到线下） */
export const MAX_CHUNK = 512 * 1024
