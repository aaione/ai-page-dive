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

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
