import { useEffect, useRef, useState } from 'react'

/**
 * r35-motion：退场动画通用 hook。React 条件渲染只卸不退——关闭瞬间消失是
 * 「不丝滑」的主体来源（进得柔和、走得生硬）。val 变空后保留旧值 ms 毫秒
 * （期间 exiting=true，挂 pd-exiting class 播退场动画）再真正卸载。
 * shown=本轮该渲染的值（退场期间保持旧值）；reduced-motion 下无动画瞬等 ms 后卸载。
 */
export function useExitValue<T>(val: T, ms: number): { shown: T; exiting: boolean } {
  const [shown, setShown] = useState<T>(val)
  const t = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => {
    clearTimeout(t.current)
    if (val) setShown(val)
    else t.current = setTimeout(() => setShown(null), ms)
    return () => clearTimeout(t.current)
  }, [val, ms])
  return { shown, exiting: !val && !!shown }
}
