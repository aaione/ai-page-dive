import { useEffect } from 'react'
import type { RefObject } from 'react'

/** r32-a11y：模态对话框焦点陷阱。Tab 在容器内循环不逃出；挂载时焦点送进容器。
 * 关闭后的焦点还原不在此 hook（effect 里抓 activeElement 晚于容器 autoFocus，
 * 抓不到触发元素）——由调用侧在「打开动作」里记触发元素、关闭时还原 */
export function useDialogFocus(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const focusables = () =>
      Array.from(
        el.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'),
      )
    // 打开即入容器（autoFocus 的元素优先；容器自身 tabIndex=-1 兜底）
    if (!el.contains(document.activeElement)) (focusables()[0] ?? el).focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const items = focusables()
      if (!items.length) return
      const cur = items.indexOf(document.activeElement as HTMLElement)
      if (e.shiftKey && cur <= 0) {
        e.preventDefault()
        items[items.length - 1].focus()
      } else if (!e.shiftKey && (cur === -1 || cur === items.length - 1)) {
        e.preventDefault()
        items[0].focus()
      }
    }
    el.addEventListener('keydown', onKey)
    return () => el.removeEventListener('keydown', onKey)
  }, [ref])
}

/** r32-a11y：方向键 roving 导航（tablist / radiogroup / listbox 共用）。
 * - activate=true（tab/radio 语义）：方向键移动即选中（click，automatic activation；
 *   鼠标点击同样先 focus 后 click，幂等安全）
 * - activate=false（listbox 语义）：只移焦点不选——方向键浏览，Enter/Space/click 选中
 * - horizontal=true 只认左右键（tabs 规范）
 * - cols=N 网格语义：Up/Down 走 ±N（下一行同列），边缘 clamp 不环绕（grid 规范）；
 *   其余情况 Up/Down 与左右同做线性环绕
 * tabIndex 由调用侧管理（选中项 0、其余 -1）：Tab 键只落一处，方向键游走。
 * 监听挂 document 做委托：容器常为条件渲染（切 tab 才挂载的面板、打开才渲染的
 * 菜单），挂载时抓 ref.current 会拿到 null 且永不重试——运行时才解析根节点 */
export function useRovingNav(
  ref: RefObject<HTMLElement | null>,
  selector: string,
  opts?: { horizontal?: boolean; activate?: boolean; cols?: number },
) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const root = ref.current
      const hit = e.target instanceof Element ? e.target.closest(selector) : null
      if (!root || !hit || !root.contains(hit)) return
      const items = Array.from(root.querySelectorAll<HTMLElement>(selector))
      if (!items.length) return
      const cur = items.indexOf(document.activeElement as HTMLElement)
      const last = items.length - 1
      let next: number
      if (e.key === 'Home') next = 0
      else if (e.key === 'End') next = last
      else if (e.key === 'ArrowRight') next = cur < 0 ? 0 : (cur + 1) % items.length
      else if (e.key === 'ArrowLeft') next = cur < 0 ? last : (cur - 1 + items.length) % items.length
      else if (opts?.cols && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        const d = e.key === 'ArrowDown' ? opts.cols : -opts.cols
        next = Math.min(Math.max((cur < 0 ? 0 : cur) + d, 0), last) // 边缘 clamp
      } else if (!opts?.horizontal && e.key === 'ArrowDown') next = cur < 0 ? 0 : (cur + 1) % items.length
      else if (!opts?.horizontal && e.key === 'ArrowUp') next = cur < 0 ? last : (cur - 1 + items.length) % items.length
      else return
      e.preventDefault()
      items[next].focus()
      if (opts?.activate) items[next].click()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [ref, selector, opts?.horizontal, opts?.activate, opts?.cols])
}
