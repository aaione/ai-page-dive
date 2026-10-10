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

/** 正文分片：≤512KB/片，done:true 后 host 落临时文件并 spawn。
 * total（done 片携带）= 全部片 text.length 之和——host 回 content-received 对账，
 * SW 校验不一致说明 NM 途中丢片（半截正文总结比失败更糟，宁可报错） */
export interface TaskContentMsg {
  t: 'task-content'
  taskId: string
  seq: number
  text: string
  done: boolean
  total?: number
}

export interface TaskCancelMsg {
  t: 'task-cancel'
  /** r58（#30）：可缺省——SW 侧任务指针丢失（扩展 reload）而 host 侧还在跑时，
   *  无 taskId 的 cancel 让 host 取本连接最近任务（per-connection 单任务模型） */
  taskId?: string
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

/** 打开历史根目录（设置页「打开历史目录」） */
export interface HistoryRevealRootMsg {
  t: 'history-reveal-root'
}

// ---------- workflow 管理（目录即插件：~/.ai-page-dive/workflows/<name>/WORKFLOW.md）----------

/** 读单个 workflow 全文（frontmatter + 正文），供设置页编辑 */
export interface WorkflowReadMsg {
  t: 'workflow-read'
  name: string
}

/** 新建/覆盖：写用户目录（shadow 内置同名）。
 * originalName（改名保存时携带）：host 侧校验目标名未撞其他用户模式，
 * 并在成功后删除旧目录（防孤儿副本） */
export interface WorkflowSaveMsg {
  t: 'workflow-save'
  name: string
  description: string
  category?: string
  body: string
  originalName?: string
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

// ---------- skills（~/.ai-page-dive/skills/<name>/SKILL.md，同 workflow 目录即插件机制）----------

export interface ListSkillsMsg {
  t: 'list-skills'
}

export interface SkillRevealMsg {
  t: 'skill-reveal'
  /** 缺省 = 打开技能根目录（host 侧 revealSkill() 语义） */
  name?: string
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
  | HistoryRevealRootMsg
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

/** workflow-read 回包：完整 WORKFLOW.md 原文。超 NM 帧上限被截时 truncated 为真
 *  （r57 #9——Settings 据此警示「保存将丢失未显示部分」，不再静默回写截断稿） */
export interface WorkflowFileMsg {
  t: 'workflow-file'
  name: string
  content: string
  truncated?: boolean
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
  /** 归属 CLI（SW 的 reading 占位帧带 currentAgentId；host 侧 status 帧不带）：
   * panel 据此在气泡创建时快照——流式中切下拉不再错标（r7-ux） */
  agentId?: string
  /** 低频状态更新（不含正文增量） */
}

/** 正文收齐回执：host 在 contentReady 后立即回，chars=收到的全部分片 text.length 之和。
 * SW 与发送侧 total 对账——不一致即 NM 途中丢片，宁可失败不可半截总结 */
export interface ContentReceivedMsg {
  t: 'content-received'
  taskId: string
  chars: number
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
  /** 流中未识别事件数（r51 A2③ 漂移感知）：>0 = CLI 版本可能高于适配器实测 */
  unrecognized?: number
}

export interface TaskErrorMsg {
  t: 'task-error'
  taskId: string
  code: 'spawn-fail' | 'timeout' | 'cancelled' | 'parse' | 'no-agent' | 'bad-request' | 'content-mismatch' | 'host-shutting-down'
  message: string
}

/** r57（#24）：prune 实删超限旧历史的轻通知（done 帧后异步到达）——panel 据此给
 *  首次触顶的单次可跳设置提示：静默永久删除会侵蚀「历史回查」的信任 */
export interface HistoryPrunedMsg {
  t: 'history-pruned'
  taskId: string
  removed: number
  limit: number
}

export interface HistoryItem {
  path: string
  title: string
  url: string
  agent: string
  ts: number
  /** CLI 会话 id（有则支持「继续对话」resume） */
  sessionId?: string
  /** 正文命中片段（全文检索命中时携带，title/url 命中不带） */
  snippet?: string
}

export interface HistoryListResultMsg {
  t: 'history-list'
  items: HistoryItem[]
  /** 回显请求 query（r50）：host 侧各请求独立 promise 并发，回帧顺序无保证——
   *  面板靠它对账丢弃迟到旧帧（清空搜索后被慢查询的过滤子集覆盖）；旧 host 不带 */
  query?: string
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
  /** 请求关联（r33）：请求侧带短 id 原样回带（如 history-read 的 path）——
   *  并发请求时消费侧据此区分「哪次失败了」，缺失时按旧语义全局提示 */
  ref?: string
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
  | ContentReceivedMsg
  | TaskMetaMsg
  | TaskChunkMsg
  | TaskDoneMsg
  | TaskErrorMsg
  | HistoryPrunedMsg
  | HistoryListResultMsg
  | HistoryFileMsg
  | DeletedMsg
  | ErrorMsg
  /** 任务期周期帧（~20s）：port 消息活动重置 MV3 SW 的 30s idle 计时器（保活） */
  | { t: 'heartbeat'; seq: number }
  /** SW 合成：host 存活信号（heartbeat 转译，携当前 taskId）。panel 看门狗据此续命——
   * host 活着就有心跳，看门狗要检测的是「host/SW 死」而非「UI 无内容帧」。
   * elapsedMs：任务已运行时长，供 panel 展示「仍在处理（已 Ns）」进度感 */
  | { t: 'task-alive'; taskId: string; elapsedMs?: number }
  /** SW 合成：NM host 断连（panel 据此停止 loading 并提示）；taskId = 断连时
   * 在跑的任务（r6-sec：panel 据此拒收迟到帧、不误伤重 spawn 后的新一轮） */
  | { t: '__host-disconnected'; taskId?: string }

/** 单帧最大 payload（NM 限制 1MB，host→ext 的 chunk 必须分片到线下） */
export const MAX_CHUNK = 512 * 1024

// ── SW → panel 合成帧（r33：收窄消息面，panel 侧不再 as any 消费）──

/** SW 合成：tips 条元数据刷新（锚定 tab 切回/导航后）。page null = 不可提取页 */
export interface PageMetaMsg {
  t: 'page-meta'
  page: { title: string; url: string; favIconUrl?: string; notice?: string; approxTokens?: number } | null
  pageUnsupported?: boolean
}
/** SW 合成：图标再点仲裁（panel 比对锚 + 可见性自裁 window.close） */
export interface PanelToggleMsg {
  t: 'panel-toggle'
  tabId?: number
}
/** SW 合成：换锚广播（panel 收养任务帧的核验基准跟锚走）。
 * r65（r64 code#2）：windowId 界定双窗各面板只认自己窗的换锚；缺省=全收（兼容） */
export interface PanelAnchorMsg {
  t: 'panel-anchor'
  tabId: number
  windowId?: number
}
/** SW → panel 全消息面：host 原帧（+SW 盖 tabId 邮戳——r69 帧锚的收养守卫核验
 *  基准；r71（r70 code L15）类型补声明，panel 读 m.tabId 不再依赖运行时附加）∪ SW 合成帧 */
export type PanelMsg = (HostToExt & { tabId?: number }) | PageMetaMsg | PanelToggleMsg | PanelAnchorMsg

/** panel-ready 响应（SW 对 {t:'panel-ready'} 的 sendResponse shape） */
export interface PanelReadyResp {
  ok: boolean
  hostVersion?: string
  nmError?: string
  outdated?: string
  /** r57（#8）：host ≥ 下限但落后于扩展钉版——非阻断升级软提示（文案含两段命令）。
   *  此前只有 <MIN 的阻断握手：已装机用户的 host 修复永远无人触达 */
  upgrade?: string
  page: PageMetaMsg['page']
  /** r69（r68 code#1）：按发起窗界定的锚——异窗面板拿到自己窗的锚（其活跃 tab），
   *  不再被 SW 单例（后开面板的锚）串台；同窗/旧面板（帧无 myWindowId）= 单例 */
  panelTabId: number | null
  pageUnsupported?: boolean
  hasSession?: boolean
  sessionAgentId?: string
  historyPath?: string
  /** r57（#19）：会话来源页（首轮总结时的顶层锚，随 sessions 持久化）——panel
   *  ctxAnchor 优先快照它，页签内导航后重开不再错标新页标题 */
  sessionPage?: { url: string; title: string }
  /** r47-ux：该会话能否 CLI 级追问（有非空 sessionId；claude=init 会话 id、
   *  codex=thread.started 的 thread_id——r7-impl 起双适配器均产）。sessionId 空串
   *  仅剩降级归档（thread.started 未达）→ false，面板仍可经 historyPath 还原对话 UI，
   *  但不得开放「继续追问」假入口 */
  canResume?: boolean
  activeTask?: { taskId: string; startedAt: number }
  /** r53（#5）：面板收起期间错过的错误终局（SW lastTerminals 收件箱一次性补发）——
   *  还原在途时暂存面板侧，落地后并入消息尾；消费即清（重开不重复） */
  missedTerminal?: { t: 'task-error'; taskId: string; code?: string; message?: string; tabId?: number }
}

// ── panel → SW 帧（r69：handleMessage(msg:any) 收敛——anchorTabId 字段拼错零编译
// 错即静默回退 SW 单例，r68 code#5 协议治理第三例。r71（r70 code C3）收口补齐：该
// 闸原仅消费端半边；发送端字面量（App/SummarizeView 全部 chrome.runtime.sendMessage
// 帧）现一律 satisfies PanelToSw——拼错在发送侧即编译红，不再依赖消费端兜底）──

/** 各帧共用的锚字段：r67（r66 code#1）起 SW 收割/会话键按发起面板锚对号 */
export interface AnchorCarrying {
  anchorTabId?: number
}

export type PanelToSw = AnchorCarrying & (
  | {
      t: 'panel-ready'
      /** r69（r68 code#1）：发起面板自报所在窗口——SW 据此界定回包锚，双窗重开
       *  不把 A 面板的锚播种成 B（单例）的 tab；缺省 = 沿用单例（旧面板兼容） */
      myWindowId?: number
    }
  | {
      t: 'summarize'
      agentId?: string
      workflow?: string
      instruction?: string
      skills?: string[]
      lang?: string
      attachments?: TaskInput['attachments']
      historyLimit?: number
      /** true = 追问轮（复用本锚会话），缺省/ false = 全新总结 */
      followUp?: boolean
    }
  | { t: 'resume-history'; agentId?: string; sessionId?: string; historyPath?: string }
  | { t: 'cancel'; taskId?: string }
  | { t: 'new-session' }
  | { t: 'nm'; msg: ExtToHost }
)
