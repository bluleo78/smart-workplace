// 뷰포트가 모바일 폭(lg 미만)인지 구독하는 훅.
// useSyncExternalStore 로 matchMedia 변화를 구독해, 회전·창 크기 변경 시 셸이 즉시 전환되게 한다.
import { useSyncExternalStore } from 'react'

import { MOBILE_MEDIA_QUERY } from '@/lib/mobile/breakpoint'

// 모듈 전역에 MediaQueryList 1개 + change 리스너 1개만 둔다 — 훅을 쓰는 컴포넌트 수만큼
// matchMedia 객체·리스너가 생기지 않게 하고, 구독자에겐 Set 으로 팬아웃한다.
let mql: MediaQueryList | null = null
const listeners = new Set<() => void>()

/** 공유 MediaQueryList 를 지연 생성한다(모듈 로드 시점엔 window 가 없을 수 있으므로 최초 사용 시). */
function getMql(): MediaQueryList {
  if (!mql) {
    mql = window.matchMedia(MOBILE_MEDIA_QUERY)
    mql.addEventListener('change', () => listeners.forEach((l) => l()))
  }
  return mql
}

/** 뷰포트가 lg 경계를 넘을 때 재렌더를 유발하도록 공유 리스너 집합에 등록한다. */
function subscribe(onChange: () => void) {
  getMql()
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

/** 현재 뷰포트가 모바일 폭인지 동기적으로 읽는다 — 렌더 밖(이벤트 콜백 등)에서 즉시 판정할 때도 쓴다. */
export const getIsMobile = (): boolean => getMql().matches

/** 모바일 폭(lg 미만) 여부. SSR/초기 스냅샷이 없는 환경에선 데스크톱(false)으로 본다. */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getIsMobile, () => false)
}
