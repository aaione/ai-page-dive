/** --stdio 模式：NM 主循环（Chrome 起 host 的入口形态，也供冒烟测试用） */
import type { ExtToHost } from '@pagedive/shared'
import { createFrameReader, writeFrame } from './nm.js'
import { probeAgents } from './agents/registry.js'
import { deleteHistory, listHistory, readHistory, revealInFinder } from './history.js'
import { Task } from './task.js'
import { listWorkflows } from './workflows.js'

const HOST_VERSION = '0.1.0'

export function runStdio(send: (obj: unknown) => void): (msg: ExtToHost) => void {
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
          onChunk: (text) => send({ t: 'task-chunk', taskId: task.taskId, seq: 0, text }),
          onDone: (info) =>
            send({
              t: 'task-done',
              taskId: task.taskId,
              historyPath: info.historyPath,
              usage: info.usage,
              durationMs: info.durationMs,
              isError: info.isError,
              ...(info.errorText ? { errorText: info.errorText } : {}),
            }),
          onError: (code, message) =>
            send({ t: 'task-error', taskId: task.taskId, code, message }),
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
          .then((content) => send({ t: 'history-file', path: msg.path, content }))
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
    }
  }

  return handle
}

/** NM 进程形态：stdin 读帧、stdout 写帧、stdin end → 收割全部任务并退出 */
export function runNative(): void {
  const send = (obj: unknown) => {
    try {
      writeFrame(process.stdout, obj)
    } catch {
      /* stdout 破损：进程将随 NM 断连终结 */
    }
  }
  const handle = runStdio(send)
  process.stdin.on('data', createFrameReader(handle))
  process.stdin.on('end', () => process.exit(0))
  process.stdin.resume()
}
