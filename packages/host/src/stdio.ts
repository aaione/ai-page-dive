/** --stdio 模式：NM 主循环（Chrome 起 host 的入口形态，也供冒烟测试用） */
import type { ExtToHost } from '@ai-page-dive/shared'
import { createFrameReader, writeFrame } from './nm.js'
import { probeAgents } from './agents/registry.js'
import { deleteHistory, listHistory, readHistory, revealInFinder } from './history.js'
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
          t.run().catch((e) =>
            send({ t: 'error', code: 'internal', message: String(e?.message ?? e) }),
          )
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
  const reapAll = () => {
    for (const t of tasks.values()) t.cancel()
  }
  process.stdin.on('data', createFrameReader(handle))
  process.stdin.on('end', () => {
    reapAll()
    setTimeout(() => process.exit(0), 200).unref()
    process.exit(0)
  })
  process.on('SIGTERM', () => {
    reapAll()
    process.exit(0)
  })
  process.on('SIGINT', () => {
    reapAll()
    process.exit(0)
  })
  process.stdin.resume()
}
