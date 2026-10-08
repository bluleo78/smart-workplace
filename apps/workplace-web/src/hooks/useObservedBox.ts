// 요소의 내용 영역 크기(contentRect — 패딩 제외)를 상태로 관측하는 훅 — 뷰어 이미지·영상 맞춤 크기 계산이 쓴다(WP-277·WP-281).
// 왜 상태인가: 맞춤 크기(fitImageWidth·fitMediaSize)는 렌더 결과(style 폭·높이)에 들어가므로 크기가 바뀌면 다시 그려야 한다.
import { useEffect, useState } from 'react'

/** el 의 내용 영역 크기. enabled 가 거짓이거나 el 이 없으면 관측하지 않는다(값은 마지막 것 또는 null). */
export function useObservedBox(el: HTMLElement | null, enabled: boolean): { w: number; h: number } | null {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null)
  useEffect(() => {
    if (!el || !enabled) return
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [el, enabled])
  return box
}
