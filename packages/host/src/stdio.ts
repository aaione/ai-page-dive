/** --stdio 模式：NM 主循环（Chrome 起 host 的入口形态，也供冒烟测试用） */
import type { ExtToHost } from '@ai-page-dive/shared'
import { createFrameReader, writeFrame } from './nm.js'
import { probeAgents } from './agents/registry.js'
import { deleteHistory, listHistory, readHistory, revealHistoryRoot, revealInFinder } from './history.js'
import { Task } from './task.js'
import { listSkills, revealSkill } from './skills.js'
import { deleteWorkflow, listWorkflows, readWorkflow, revealWorkflow, saveWorkflow } from './workflows.js'

const HOST_VERSION = '0.1.0'
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
        listHistory(msg.query, msg.limit).then((items) => send({ t: 'history-list', items }))
        break
      case 'history-read':
        readHistory(msg.path)
          .then((content) => {
            // NM 单帧 ≤1MB：超限截断并标注（全文在本地文件）
            if (Buffer.byteLength(content, 'utf8') > HISTORY_MAX_BYTES) {
              content =
                content.slice(0, HISTORY_MAX_BYTES) +
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
  const send = (obj: unknown) => {
    try {
      writeFrame(process.stdout, obj)
    } catch {
      /* stdout 破损：进程将随 NM 断连终结 */
    }
  }
  const { handle, tasks } = runStdio(send)

  // 任务期心跳（SW 保活）：Chrome 105+ 仅 port 上的消息活动重置 SW 30s idle 计时器，
  // merely-open 的 port 不豁免回收——CLI 深度思考期 stdout 可 >30s 静默，若无周期帧
  // SW 被杀 → NM port 关闭 → 本进程 stdin end → 任务静默死亡
  let beat = 0
  setInterval(() => {
    if (!tasks.size) return
    send({ t: 'heartbeat', seq: beat++ })
  }, 20_000).unref()

  // 收割窗口：SIGTERM 发出后给 3.2s（reap 的 SIGKILL 兜底 3s）让进程树死透 + 在途
  // persist('interrupted') 落盘完成，再退出。之前立即 exit 使 SIGKILL 兜底永不触发
  const reapAll = () => {
    for (const t of tasks.values()) t.cancel()
  }
  const shutdown = () => {
    reapAll()
    setTimeout(() => process.exit(0), 3_200)
    // 3.2s 后强制退出；期间事件循环自然驱动 persist / SIGKILL 定时器
  }
  process.stdin.on('data', createFrameReader(handle))
  process.stdin.on('end', shutdown)
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
  process.stdin.resume()
}
