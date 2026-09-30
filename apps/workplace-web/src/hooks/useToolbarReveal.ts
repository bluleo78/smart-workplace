import type { FocusEvent as ReactFocusEvent, PointerEvent as ReactPointerEvent } from 'react'
import { useCallback, useEffect, useState } from 'react'

import { flipToolbarIfClipped } from '@/components/chat/messageToolbar'

/** 행에 펼쳐 넣는 props. data-tap-active 는 Tailwind `group-data-[tap-active=true]:` 변형이 읽는다. */
export interface ToolbarRowProps {
  'data-tap-row': number
  'data-tap-active': 'true' | undefined
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void
  onPointerEnter: (e: ReactPointerEvent<HTMLElement>) => void
  onFocus: (e: ReactFocusEvent<HTMLElement>) => void
}

/**
 * 메시지 행의 작업 툴바 노출을 돕는 훅.
 * - 터치: hover 가 없는 기기에서는 group-hover 로 툴바를 볼 수 없으므로, 탭한 행 하나를 "활성"으로 기억한다.
 *   마우스·펜 입력은 무시한다(hover 로 충분하고, 클릭마다 툴바가 고정되면 오히려 방해). 활성 행 밖을 누르면 닫는다.
 * - 위치: 툴바가 드러나는 순간(hover·포커스·탭)마다 스크롤 영역 위 끝에 잘리는지 재서 아래로 뒤집는다.
 */
export function useToolbarReveal(): (id: number) => ToolbarRowProps {
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
      onPointerUp: (e: ReactPointerEvent<HTMLElement>) => {
        if (e.pointerType !== 'touch') return
        flipToolbarIfClipped(e.currentTarget)
        setActiveId(id)
      },
      onPointerEnter: (e: ReactPointerEvent<HTMLElement>) => flipToolbarIfClipped(e.currentTarget),
      onFocus: (e: ReactFocusEvent<HTMLElement>) => flipToolbarIfClipped(e.currentTarget),
    }),
    [activeId],
  )
}
