import type { PointerEvent as ReactPointerEvent } from 'react'
import { useCallback, useEffect, useState } from 'react'

/** 행에 펼쳐 넣는 props. data-tap-active 는 Tailwind `group-data-[tap-active=true]:` 변형이 읽는다. */
export interface TapRowProps {
  'data-tap-row': number
  'data-tap-active': 'true' | undefined
  onPointerUp: (e: ReactPointerEvent) => void
}

/**
 * 터치 기기에서 메시지 행을 탭하면 작업 툴바를 드러내는 훅.
 * hover 가 없는 기기에서는 group-hover 로 툴바를 볼 수 없으므로, 탭한 행 하나를 "활성"으로 기억한다.
 * 마우스·펜 입력은 무시한다(hover 로 충분하고, 클릭마다 툴바가 고정되면 오히려 방해).
 * 활성 행 밖을 누르면 닫는다.
 */
export function useTapReveal(): (id: number) => TapRowProps {
  const [activeId, setActiveId] = useState<number | null>(null)

  useEffect(() => {
    if (activeId === null) return
    // 활성 행 밖에서 pointerdown 이 나면 닫는다. 같은 행 안(툴바 버튼 포함)은 유지.
    const onPointerDown = (e: PointerEvent) => {
      const row = e.target instanceof Element ? e.target.closest('[data-tap-row]') : null
      if (row?.getAttribute('data-tap-row') === String(activeId)) return
      setActiveId(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [activeId])

  return useCallback(
    (id: number) => ({
      'data-tap-row': id,
      'data-tap-active': activeId === id ? 'true' : undefined,
      onPointerUp: (e: ReactPointerEvent) => {
        if (e.pointerType === 'touch') setActiveId(id)
      },
    }),
    [activeId],
  )
}
