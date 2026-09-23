import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import './index.css'

// r24 氛围档 / r25 阅读字号档：render 前同步应用（localStorage 同步 API）——
// 非默认档首帧即正确，无闪变。默认值 = 无属性（不写）
try {
  const amb = localStorage.getItem('pd-ambience')
  if (amb) document.body.dataset.ambience = amb
  const rs = localStorage.getItem('pd-reading-size')
  if (rs) document.body.dataset.readingSize = rs
} catch { /* quota 等 */ }

// r47-audit M6 错误边界：渲染异常不再整面板白屏丢会话态，兜底最小崩溃页。
// fallback 用内联样式——崩溃页不依赖任何可能坏掉的组件/样式链
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[pd-sidepanel] 渲染崩溃', error, info.componentStack)
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
        <p style={{ margin: '0 0 12px' }}>面板出错了</p>
        <button onClick={() => location.reload()}>重新加载</button>
      </div>
    )
  }
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
