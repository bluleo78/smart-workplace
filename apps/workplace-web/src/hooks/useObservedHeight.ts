// 요소의 렌더된 높이(offsetHeight)를 관측해 콜백으로 알리는 훅 — 모바일 탭바(--mobile-tabbar-h)·뷰어 하단 겹침 바(--viewer-bottom-chrome)가 쓴다.
// 고정 px 를 복제하지 않고 실제 높이(안전영역·늦게 생기는 띠 포함)를 따라가려고 ResizeObserver 로 계속 본다.
import { useEffect, useRef } from 'react'

/**
 * el 의 높이를 관측 시작 즉시 한 번, 이후 크기가 바뀔 때마다 onHeight 로 알린다.
 * 관측을 멈출 때(el 이 바뀌거나 사라짐·언마운트) onHeight(null) 로 알려 호출부가 값을 지울 수 있게 한다.
 * onHeight 는 최신값 ref 로 읽어, 호출부가 매 렌더 새 함수를 넘겨도 관측을 다시 걸지 않는다(el 이 바뀔 때만).
 * 높이는 호출부 콜백으로만 흘려보내 — 상태로 들지 않으므로 크기 변화가 이 훅을 쓴 컴포넌트를 다시 그리게 하지 않는다.
 */
export function useObservedHeight(el: HTMLElement | null, onHeight: (height: number | null) => void): void {
  const latest = useRef(onHeight)
  useEffect(() => {
    latest.current = onHeight
  })
  useEffect(() => {
    if (!el) return
    const sync = () => latest.current(el.offsetHeight)
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => {
      ro.disconnect()
      latest.current(null)
    }
  }, [el])
}
