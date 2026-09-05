import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentStatus, HostToExt, SkillItem, WorkflowItem } from '@ai-page-dive/shared'
import './Settings.css'

/** workflow 名称合法字符（与目录名一致）：字母数字下划线连字符，≤64 */
const WF_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/

type Tab = 'modes' | 'clis' | 'skills' | 'about'

interface EditorState {
  /** 原始名（保存时定位）；新建未保存时为 null */
  originalName: string | null
  name: string
  nameError: string | null
  description: string
  category: string
  body: string
  builtin: boolean
  dirty: boolean
}

/** 极简 frontmatter 解析：只取 description / category 两个 string 字段，正文原样返回 */
function parseWorkflowMd(content: string): { description: string; category?: string; body: string } {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return { description: '', body: content }
  const fm = m[1]
  const body = m[2]
  const desc = fm.match(/^description:\s*(.*)$/m)?.[1]?.trim() ?? ''
  const cat = fm.match(/^category:\s*(.*)$/m)?.[1]?.trim()
  return { description: desc.replace(/^['"]|['"]$/g, ''), category: cat || undefined, body }
}

function readStrList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key)
    const v = raw ? JSON.parse(raw) : []
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

function readStr(key: string): string {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

function writeStrList(key: string, list: string[]) {
  localStorage.setItem(key, JSON.stringify(list))
  window.dispatchEvent(new Event('pd-settings-changed'))
}

export function Settings({ agents, onClose }: { agents: AgentStatus[]; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('modes')

  // ── 模式（workflow） ──
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([])
  const [editor, setEditor] = useState<EditorState | null>(null)
  const editorRef = useRef<EditorState | null>(null)
  editorRef.current = editor

  // ── 技能 ──
  const [skills, setSkills] = useState<SkillItem[]>([])
  const [enabledSkills, setEnabledSkills] = useState<string[]>(() => readStrList('pd-enabled-skills'))

  // ── CLI 开关 / 默认 CLI / 语言偏好 ──
  const [disabledClis, setDisabledClis] = useState<string[]>(() => readStrList('pd-disabled-clis'))
  const [defaultCli, setDefaultCli] = useState(() => readStr('pd-default-cli'))
  const [lang, setLang] = useState(() => readStr('pd-sum-lang'))

  /** 单值设置写入 + 广播（App/SummarizeView 监听 pd-settings-changed 联动） */
  function setSetting(key: string, v: string) {
    try {
      if (v) localStorage.setItem(key, v)
      else localStorage.removeItem(key)
    } catch { /* quota */ }
    if (key === 'pd-default-cli') setDefaultCli(v)
    if (key === 'pd-sum-lang') setLang(v)
    window.dispatchEvent(new Event('pd-settings-changed'))
  }

  useEffect(() => {
    // mount 即拉列表（host 回包经 SW 广播，App.tsx 同帧双收无害）
    chrome.runtime.sendMessage({ t: 'nm', msg: { t: 'list-workflows' } }, () => void chrome.runtime.lastError)
    chrome.runtime.sendMessage({ t: 'nm', msg: { t: 'list-skills' } }, () => void chrome.runtime.lastError)
    const listener = (m: HostToExt) => {
      switch (m.t) {
        case 'workflows':
          setWorkflows(m.items)
          break
        case 'skills':
          setSkills(m.items)
          break
        case 'workflow-file': {
          // 选中项的全文到达：解析进编辑表单（仅当还在编辑这个名字）
          const cur = editorRef.current
          if (!cur || cur.name !== m.name) break
          const p = parseWorkflowMd(m.content)
          setEditor({
            ...cur,
            description: p.description,
            category: p.category ?? '',
            body: p.body,
            dirty: false,
          })
          break
        }
        case 'workflow-saved':
        case 'workflow-deleted':
          // 保存/删除后统一重拉刷新；保存新名后切到新名
          chrome.runtime.sendMessage({ t: 'nm', msg: { t: 'list-workflows' } }, () => void chrome.runtime.lastError)
          if (m.t === 'workflow-deleted') {
            const cur = editorRef.current
            if (cur && cur.name === m.name) {
              if (cur.builtin) {
                // 内置项删用户副本 = 恢复默认：重读内置版
                chrome.runtime.sendMessage({ t: 'nm', msg: { t: 'workflow-read', name: m.name } }, () => void chrome.runtime.lastError)
              } else {
                setEditor(null)
              }
            }
          } else {
            const cur = editorRef.current
            if (cur && cur.originalName && cur.originalName !== m.name) {
              // 另存新名：originalName 切到新名
              setEditor(cur => cur && { ...cur, originalName: m.name, dirty: false })
            }
          }
          break
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  function selectWorkflow(w: WorkflowItem) {
    setEditor({
      originalName: w.name,
      name: w.name,
      nameError: null,
      description: w.description ?? '',
      category: w.category ?? '',
      // 正文等 workflow-file 帧到达后填充
      body: '',
      builtin: w.builtin,
      dirty: false,
    })
    chrome.runtime.sendMessage({ t: 'nm', msg: { t: 'workflow-read', name: w.name } }, () => void chrome.runtime.lastError)
  }

  function newWorkflow() {
    setEditor({
      originalName: null,
      name: '',
      nameError: null,
      description: '新模式',
      category: '',
      body: '在这里写下这个总结模式要 AI 做什么、输出什么格式……',
      builtin: false,
      dirty: false,
    })
  }

  function saveWorkflow() {
    if (!editor) return
    if (!WF_NAME_RE.test(editor.name)) {
      setEditor({ ...editor, nameError: '名称仅限字母/数字/下划线/连字符，1–64 位', dirty: true })
      return
    }
    setEditor({ ...editor, nameError: null, dirty: true })
    chrome.runtime.sendMessage(
      {
        t: 'nm',
        msg: { t: 'workflow-save', name: editor.name, description: editor.description, category: editor.category || undefined, body: editor.body },
      },
      () => void chrome.runtime.lastError,
    )
  }

  function deleteWorkflow() {
    if (!editor || !editor.name) return
    chrome.runtime.sendMessage({ t: 'nm', msg: { t: 'workflow-delete', name: editor.name } }, () => void chrome.runtime.lastError)
  }

  function revealWorkflow(name: string) {
    chrome.runtime.sendMessage({ t: 'nm', msg: { t: 'workflow-reveal', name } }, () => void chrome.runtime.lastError)
  }

  function toggleCli(id: string) {
    const next = disabledClis.includes(id) ? disabledClis.filter((x) => x !== id) : [...disabledClis, id]
    setDisabledClis(next)
    writeStrList('pd-disabled-clis', next)
  }

  function toggleSkill(name: string) {
    const next = enabledSkills.includes(name) ? enabledSkills.filter((x) => x !== name) : [...enabledSkills, name]
    setEnabledSkills(next)
    writeStrList('pd-enabled-skills', next)
  }

  function revealSkill(name: string) {
    chrome.runtime.sendMessage({ t: 'nm', msg: { t: 'skill-reveal', name } }, () => void chrome.runtime.lastError)
  }

  /** 打开历史根目录（Finder）：目录即备份，拖走即导出 */
  function revealHistoryDir() {
    chrome.runtime.sendMessage({ t: 'nm', msg: { t: 'history-reveal-root' } }, () => void chrome.runtime.lastError)
  }

  const tabs: { key: Tab; label: string }[] = useMemo(
    () => [
      { key: 'modes', label: '模式' },
      { key: 'clis', label: '本机 CLI' },
      { key: 'skills', label: '技能' },
      { key: 'about', label: '关于' },
    ],
    [],
  )

  return (
    <div className="pd-set">
      <div className="pd-set-top">
        <button onClick={onClose} className="pd-set-back" title="返回面板" aria-label="返回面板">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 3 5 8l5 5" />
          </svg>
          设置
        </button>
      </div>

      <div className="pd-set-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={`pd-set-tab ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="pd-set-body" key={tab}>
        {tab === 'modes' && (
          <div className="pd-set-pane">
            <div className="pd-set-modes">
              <div className="pd-set-panel">
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
                  <p className="pd-set-hint" style={{ margin: 0, flex: 1 }}>
                    总结模式即插件：目录在 <code>~/.ai-page-dive/workflows/</code>
                  </p>
                  <button className="pd-set-btn primary" onClick={newWorkflow}>＋ 新建模式</button>
                </div>
                {workflows.length ? (
                  <div className="pd-set-wf-list">
                    {workflows.map((w) => (
                      <button
                        key={w.name}
                        className={`pd-set-wf-item ${editor?.name === w.name ? 'active' : ''}`}
                        onClick={() => selectWorkflow(w)}
                        title={w.description}
                      >
                        <span className="pd-set-wf-name">
                          {w.name}
                          {w.builtin && <span className="pd-set-badge">内置</span>}
                        </span>
                        <span className="pd-set-wf-desc">{w.description}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="pd-set-empty">尚未获取到模式列表（本机 host 未连接？）</p>
                )}
              </div>

              {editor && (
                <div className="pd-set-panel pd-set-editor">
                  <div className="pd-set-field">
                    <span className="pd-set-label">名称{editor.builtin ? '（内置模式，保存将在用户目录创建副本）' : ''}</span>
                    <input
                      className="pd-set-input name"
                      value={editor.name}
                      readOnly={!!editor.builtin}
                      onChange={(e) => setEditor({ ...editor, name: e.target.value, nameError: null, dirty: true })}
                      placeholder="my-mode"
                    />
                    {editor.nameError && <span className="pd-set-field-error">{editor.nameError}</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <div className="pd-set-field" style={{ flex: 1 }}>
                      <span className="pd-set-label">描述</span>
                      <input
                        className="pd-set-input"
                        value={editor.description}
                        onChange={(e) => setEditor({ ...editor, description: e.target.value, dirty: true })}
                      />
                    </div>
                    <div className="pd-set-field" style={{ width: 120 }}>
                      <span className="pd-set-label">分类（可空）</span>
                      <input
                        className="pd-set-input"
                        value={editor.category}
                        onChange={(e) => setEditor({ ...editor, category: e.target.value, dirty: true })}
                      />
                    </div>
                  </div>
                  <div className="pd-set-field" style={{ marginBottom: 0 }}>
                    <span className="pd-set-label">正文（Markdown，即发送给 CLI 的模式指令）</span>
                    <textarea
                      className="pd-set-textarea"
                      value={editor.body}
                      onChange={(e) => setEditor({ ...editor, body: e.target.value, dirty: true })}
                      placeholder={editor.originalName ? '正在读取…' : '写点什么…'}
                    />
                  </div>
                  <div className="pd-set-actions">
                    <button className="pd-set-btn primary" onClick={saveWorkflow}>保存</button>
                    <button className="pd-set-btn danger" onClick={deleteWorkflow} disabled={!editor.name}>
                      {editor.builtin ? '恢复默认' : '删除'}
                    </button>
                    <span className="spacer" />
                    <button className="pd-set-btn" onClick={() => revealWorkflow(editor.name)} disabled={!editor.name}>
                      打开目录
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'clis' && (
          <div className="pd-set-pane">
            <div className="pd-set-panel">
              <p className="pd-set-hint">⭐ 为新对话默认 CLI；关闭仅从主界面下拉隐藏，不影响本机安装。</p>
              {agents.length ? (
                <div className="pd-set-rows">
                  {agents.map((a) => {
                    const off = disabledClis.includes(a.id)
                    const isDefault = defaultCli === a.id
                    return (
                      <div key={a.id} className="pd-set-row">
                        <span className={`pd-set-dot ${a.available ? 'available' : 'unavailable'}`} />
                        <div className="pd-set-row-main">
                          <div className="pd-set-row-name">
                            <span className="pd-mono">{a.id}</span>
                            <span style={{ fontSize: 10.5, color: 'var(--color-pd-ink-2)' }}>
                              {a.available ? a.version ?? '已安装' : '未安装'}
                            </span>
                          </div>
                        </div>
                        <button
                          className={`pd-set-star ${isDefault ? 'on' : ''}`}
                          onClick={() => setSetting('pd-default-cli', isDefault ? '' : a.id)}
                          title={isDefault ? '取消默认' : '设为新对话默认'}
                          aria-label={isDefault ? `取消 ${a.id} 默认` : `设 ${a.id} 为默认`}
                          aria-pressed={isDefault}
                          disabled={!a.available}
                        >
                          <svg viewBox="0 0 16 16" fill={isDefault ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
                            <path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6L8 1.8Z" />
                          </svg>
                        </button>
                        <button
                          className={`pd-set-switch ${!off ? 'on' : ''}`}
                          onClick={() => toggleCli(a.id)}
                          role="switch"
                          aria-checked={!off}
                          aria-label={`${off ? '显示' : '隐藏'} ${a.id}`}
                        />
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="pd-set-empty">尚未探测到本机 CLI</p>
              )}
              <div className="pd-set-lang-row">
                <span className="pd-set-label" style={{ margin: 0 }}>总结语言</span>
                <div className="pd-set-lang-opts" role="radiogroup" aria-label="总结输出语言">
                  {([['', '自动'], ['zh', '中文'], ['en', 'English']] as const).map(([v, label]) => (
                    <button
                      key={v || 'auto'}
                      className={`pd-set-lang-opt ${(lang || '') === v ? 'active' : ''}`}
                      onClick={() => setSetting('pd-sum-lang', v)}
                      role="radio"
                      aria-checked={(lang || '') === v}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === 'skills' && (
          <div className="pd-set-pane">
            <div className="pd-set-panel">
              <p className="pd-set-hint">
                总结时启用中的技能会注入 prompt。在 <code>~/.ai-page-dive/skills/&lt;名称&gt;/SKILL.md</code> 创建技能：
                frontmatter 写 <code>name</code>/<code>description</code>，正文即技能指令。
              </p>
              {skills.length ? (
                <div className="pd-set-rows">
                  {skills.map((s) => {
                    const on = enabledSkills.includes(s.name)
                    return (
                      <div key={s.name} className="pd-set-row">
                        <div className="pd-set-row-main">
                          <div className="pd-set-row-name">
                            <span>{s.name}</span>
                            {s.builtin && <span className="pd-set-badge">内置</span>}
                          </div>
                          {s.description && <div className="pd-set-row-desc" title={s.description}>{s.description}</div>}
                        </div>
                        <button className="pd-set-btn" onClick={() => revealSkill(s.name)}>打开目录</button>
                        <button
                          className={`pd-set-switch ${on ? 'on' : ''}`}
                          onClick={() => toggleSkill(s.name)}
                          role="switch"
                          aria-checked={on}
                          aria-label={`${on ? '停用' : '启用'}技能 ${s.name}`}
                        />
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="pd-set-empty">
                  还没有技能。在 <code>~/.ai-page-dive/skills/&lt;名称&gt;/SKILL.md</code> 创建你的第一个技能——
                  frontmatter 写 name / description，正文即技能指令，总结时启用中的技能会注入 prompt。
                </p>
              )}
            </div>
          </div>
        )}

        {tab === 'about' && (
          <div className="pd-set-pane">
            <div className="pd-set-panel pd-set-about">
              <div className="pd-set-about-head">
                <img src="icon-128.png" alt="AI PageDive logo" className="pd-set-logo" />
                <div className="pd-set-about-name">
                  <strong>AI PageDive</strong>
                  <span className="pd-set-ver">v{chrome.runtime.getManifest().version}</span>
                </div>
              </div>
              <p>
                AI PageDive 只在本机调用你自己登录的官方 CLI（claude / codex / opencode），
                <strong>不接触任何凭证、不代理流量、不额外收费</strong>；总结用量计入你的 CLI 订阅。
              </p>
              <p>
                付费墙站点会尽力提取当前已渲染内容（等价于你手动复制），不会绕过访问控制。
              </p>
              <p>
                历史记录保存在 <code>~/.ai-page-dive/history/</code>。
              </p>
              <div className="pd-set-actions" style={{ marginTop: 14 }}>
                <button className="pd-set-btn" onClick={revealHistoryDir}>打开历史目录</button>
                <button className="pd-set-btn" onClick={() => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })}>
                  自定义快捷键
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
