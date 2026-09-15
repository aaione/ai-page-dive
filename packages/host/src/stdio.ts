/** --stdio 模式：NM 主循环（Chrome 起 host 的入口形态，也供冒烟测试用） */
import type { ExtToHost } from '@ai-page-dive/shared'
import { createFrameReader, writeFrame, NM_MAX } from './nm.js'
import { probeAgents } from './agents/registry.js'
import { deleteHistory, listHistory, readHistory, revealHistoryRoot, revealInFinder } from './history.js'
import { Task } from './task.js'
import { REAP_GRACE_MS } from './spawn.js'
import { listSkills, revealSkill } from './skills.js'
import { deleteWorkflow, listWorkflows, readWorkflow, revealWorkflow, saveWorkflow } from './workflows.js'
import { HOST_VERSION } from './version.js'
/** history-file 单帧安全上限（NM 1MB 限制留余量） */
const HISTORY_MAX_BYTES = 900 * 1024

export interface StdioSession {
  handle: (msg: ExtToHost) => void
  tasks: Map<string, Task>
}

export function runStdio(send: (obj: unknown) => void): StdioSession {
  const tasks = new Map<string, Task>()

  const handle = (msg: ExtToHost) => {
    switch (msg.t) {
      case 'ping':
        send({ t: 'pong', hostVersion: HOST_VERSION })
        break
      case 'list-agents':
        probeAgents().then((agents) => send({ t: 'agents', agents }))
        break
      case 'list-workflows':
        listWorkflows().then((items) => send({ t: 'workflows', items }))
        break
      case 'task-start': {
        const { task } = msg
        const t = new Task(task.taskId, {
          onStatus: (phase) => send({ t: 'task-status', taskId: task.taskId, phase }),
          onMeta: (info) => send({ t: 'task-meta', taskId: task.taskId, agentId: task.agentId, ...info }),
          onChunk: (text, seq) => send({ t: 'task-chunk', taskId: task.taskId, seq, text }),
          onDone: (info) => {
            tasks.delete(task.taskId)
            send({
              t: 'task-done',
              taskId: task.taskId,
              agentId: task.agentId,
              historyPath: info.historyPath,
              usage: info.usage,
              durationMs: info.durationMs,
              isError: info.isError,
              ...(info.errorText ? { errorText: info.errorText } : {}),
              ...(info.model ? { model: info.model } : {}),
              ...(info.sessionId ? { sessionId: info.sessionId } : {}),
            })
          },
          onError: (code, message) => {
            tasks.delete(task.taskId)
            send({ t: 'task-error', taskId: task.taskId, code, message })
          },
        })
        t.start(task)
        tasks.set(task.taskId, t)
        break
      }
      case 'task-content': {
        const t = tasks.get(msg.taskId)
        if (!t) return send({ t: 'error', code: 'no-task', message: `unknown task ${msg.taskId}` })
        t.appendContent(msg.text, msg.done)
        if (t.contentReady()) {
          // 完整性回执：SW 对账不一致时会取消本任务（半截正文总结比失败更糟）
          send({ t: 'content-received', taskId: msg.taskId, chars: t.receivedChars() })
          // run 早期失败也带 taskId 走 task-error：SW/panel 按任务终局清理，不再挂空
          t.run().catch((e) => {
            tasks.delete(msg.taskId)
            send({ t: 'task-error', taskId: msg.taskId, code: 'spawn-fail', message: String(e?.message ?? e) })
          })
        }
        break
      }
      case 'task-cancel': {
        tasks.get(msg.taskId)?.cancel()
        break
      }
      case 'history-list':
        // 无 .catch：任意年/月/日目录 EACCES → readdir reject → unhandledRejection
        // → Node ≥18 默认策略进程退出 → NM 断连。与 history-read/delete 同构兜底
        listHistory(msg.query, msg.limit)
          .then((items) => send({ t: 'history-list', items }))
          .catch((e) => send({ t: 'error', code: 'list-fail', message: String(e?.message ?? e) }))
        break
      case 'history-read':
        readHistory(msg.path)
          .then((content) => {
            // NM 单帧 ≤1MB（字节维度）：CJK 3 字节/字符，按字符 slice 截不断——
            // 按字节收缩 + 尾部回退到完整 UTF-8 边界（防切出替换字符）
            if (Buffer.byteLength(content, 'utf8') > HISTORY_MAX_BYTES) {
              const buf = Buffer.from(content, 'utf8')
              let end = HISTORY_MAX_BYTES
              while (end > 0 && (buf[end] & 0xc0) === 0x80) end-- // 多字节序列中间：回退
              content =
                buf.subarray(0, end).toString('utf8') +
                `\n\n[... 已截断，全文见本地文件 ${msg.path}]`
            }
            send({ t: 'history-file', path: msg.path, content })
          })
          .catch((e) => send({ t: 'error', code: 'read-fail', message: String(e?.message ?? e) }))
        break
      case 'history-delete':
        deleteHistory(msg.path)
          .then(() => send({ t: 'deleted', path: msg.path }))
          .catch((e) => send({ t: 'error', code: 'delete-fail', message: String(e?.message ?? e) }))
        break
      case 'history-reveal':
        try {
          revealInFinder(msg.path)
        } catch (e: any) {
          send({ t: 'error', code: 'reveal-fail', message: String(e?.message ?? e) })
        }
        break
      case 'history-reveal-root':
        try {
          revealHistoryRoot()
        } catch (e: any) {
          send({ t: 'error', code: 'reveal-fail', message: String(e?.message ?? e) })
        }
        break
      case 'workflow-read':
        readWorkflow(msg.name)
          .then((content) => {
            if (content === undefined) throw new Error(`workflow not found: ${msg.name}`)
            send({ t: 'workflow-file', name: msg.name, content })
          })
          .catch((e) => send({ t: 'error', code: 'not-found', message: String(e?.message ?? e) }))
        break
      case 'workflow-save':
        saveWorkflow(msg)
          .then(() => send({ t: 'workflow-saved', name: msg.name }))
          .catch((e) => send({ t: 'error', code: 'bad-name', message: String(e?.message ?? e) }))
        break
      case 'workflow-delete':
        deleteWorkflow(msg.name)
          .then(() => send({ t: 'workflow-deleted', name: msg.name }))
          .catch((e) => send({ t: 'error', code: 'bad-name', message: String(e?.message ?? e) }))
        break
      case 'workflow-reveal':
        // revealWorkflow 目录不存在时 reject（不静默建副本），此处回 error 帧
        revealWorkflow(msg.name).catch((e) =>
          send({ t: 'error', code: 'reveal-fail', message: String(e?.message ?? e) }),
        )
        break
      case 'list-skills':
        listSkills().then((items) => send({ t: 'skills', items }))
        break
      case 'skill-reveal':
        try {
          revealSkill(msg.name)
        } catch (e: any) {
          send({ t: 'error', code: 'reveal-fail', message: String(e?.message ?? e) })
        }
        break
    }
  }

  return { handle, tasks }
}

/** NM 进程形态：stdin 读帧、stdout 写帧；stdin end / 信号 → 收割全部任务再退出 */
export function runNative(): void {
  let shuttingDown = false
  const send = (obj: unknown) => {
    try {
      writeFrame(process.stdout, obj)
    } catch (e) {
      // stdout 破损/单帧超限：进程将随 NM 断连终结——留 stderr 痕迹供排障
      // （历史大文件截断失效等此前在此被静默吞掉）
      console.error('[ai-page-dive] send frame failed:', (e as Error)?.message ?? e)
    }
  }
  const { handle: rawHandle, tasks } = runStdio(send)
  // shutdown 窗口内的新任务会被 3.2s 后的 exit(0) 带走，扩展侧只见断连——
  // 显式拒绝并报错，把「面板突然失联」变成可理解的错误
  const handle = (msg: ExtToHost) => {
    if (shuttingDown && (msg as any)?.t === 'task-start') {
      // r7-review：专用 code——复用 'spawn-fail' 会让 panel 拼出「CLI 启动失败
      // （未安装或不在 PATH）： host 正在关闭」的自相矛盾文案，误导用户重装 CLI
      send({ t: 'task-error', taskId: (msg as any).task.taskId, code: 'host-shutting-down', message: 'host 正在关闭，请重试' })
      return
    }
    rawHandle(msg)
  }

  // 任务期心跳（SW 保活）：Chrome 105+ 仅 port 上的消息活动重置 SW 30s idle 计时器，
  // merely-open 的 port 不豁免回收——CLI 深度思考期 stdout 可 >30s 静默，若无周期帧
  // SW 被杀 → NM port 关闭 → 本进程 stdin end → 任务静默死亡
  let beat = 0
  setInterval(() => {
    if (!tasks.size) return
    send({ t: 'heartbeat', seq: beat++ })
  }, 20_000).unref()

  // 收割窗口：SIGTERM 发出后给 REAP_GRACE_MS + 200ms 让进程树死透 + 在途
  // persist('interrupted') 落盘完成，再退出。之前立即 exit 使 SIGKILL 兜底永不触发
  const reapAll = () => {
    for (const t of tasks.values()) t.cancel()
  }
  const shutdown = () => {
    shuttingDown = true
    reapAll()
    setTimeout(() => process.exit(0), REAP_GRACE_MS + 200)
    // 窗口后强制退出；期间事件循环自然驱动 persist / SIGKILL 定时器
  }
  // 帧流失步（超限帧头）：走收割路径终结——直接杀在跑任务树再退出，CLI 进程
  // 不泄漏；对扩展侧表现为断连（可重连自愈），而非假超时
  process.stdin.on('data', createFrameReader(handle, NM_MAX, shutdown))
  process.stdin.on('end', shutdown)
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
  process.stdin.resume()
}
