// 터치 셸(모바일 폭 + coarse 포인터) 여부를 구독하는 훅 — 회전·창 크기·포인터 변화에 즉시 재렌더한다.
// 판정 규칙은 lib/mobile/touchShell.ts 참조. 메시지 행마다 호출되므로 리스너는 모듈 전역에 한 벌만 건다.
import { useSyncExternalStore } from 'react'

import { getIsTouchShell, touchShellQueries } from '@/lib/mobile/touchShell'

const listeners = new Set<() => void>()
let bound = false

/** 두 미디어 쿼리 변화를 한 번만 구독해 구독자 집합에 팬아웃한다(최초 사용 시 지연 바인딩). */
function subscribe(onChange: () => void) {
  if (!bound) {
    const q = touchShellQueries()
    if (q) {
      bound = true
      const notify = () => listeners.forEach((l) => l())
      q.forEach((m) => m.addEventListener('change', notify))
    }
  }
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

/** 모바일 터치 셸 여부. SSR/초기 스냅샷이 없는 환경에선 false(데스크톱 동작). */
export function useIsTouchShell(): boolean {
  return useSyncExternalStore(subscribe, getIsTouchShell, () => false)
}
