// 미디어 쿼리 하나를 구독 가능한 외부 스토어로 만드는 팩토리 — useSyncExternalStore 의 (subscribe, getSnapshot) 쌍.
// 왜: 모바일 폭(useIsMobile)·coarse 포인터(터치 셸 판정)가 같은 "MediaQueryList 1개 + change 리스너 1개 + 구독자 Set 팬아웃"
// 코드를 각자 들고 있었다. 훅을 쓰는 컴포넌트(메시지 행 등) 수만큼 matchMedia 객체·리스너가 생기지 않게 하는 규칙은 같으므로 한곳에 둔다.
// React 를 모르는 lib 계층이라 키 입력 시점 판정(isSubmitEnter)처럼 렌더 밖에서도 get() 으로 즉시 읽을 수 있다.
import { MOBILE_MEDIA_QUERY } from './breakpoint'

export interface MediaQueryStore {
  /** 지금 쿼리가 맞는지 동기적으로 읽는다. matchMedia 가 없는 환경(node 단위 테스트·SSR)에선 false. */
  get: () => boolean
  /** 쿼리 결과가 바뀔 때 onChange 를 부른다. 반환값은 구독 해제 함수. */
  subscribe: (onChange: () => void) => () => void
}

/** query 에 대한 공유 스토어를 만든다. MediaQueryList 는 최초 사용 시 지연 생성(모듈 로드 시점엔 window 가 없을 수 있음). */
export function createMediaQueryStore(query: string): MediaQueryStore {
  let mql: MediaQueryList | null = null
  const listeners = new Set<() => void>()

  // matchMedia 가 없으면 캐시하지 않는다 — 테스트가 나중에 matchMedia 를 심어도 그때부터 동작하게.
  const ensure = (): MediaQueryList | null => {
    if (mql) return mql
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
    mql = window.matchMedia(query)
    mql.addEventListener('change', () => listeners.forEach((l) => l()))
    return mql
  }

  return {
    get: () => ensure()?.matches ?? false,
    subscribe: (onChange) => {
      ensure()
      listeners.add(onChange)
      return () => {
        listeners.delete(onChange)
      }
    },
  }
}

/** 뷰포트가 모바일 폭(lg 미만)인가 — 셸·레이아웃 전환 기준. */
export const mobileWidthStore = createMediaQueryStore(MOBILE_MEDIA_QUERY)
/** 주 포인터가 손가락(coarse)인가 — 터치 셸 판정의 다른 반쪽. */
export const coarsePointerStore = createMediaQueryStore('(pointer: coarse)')
/** 가로 방향인가 — 모바일 뷰어는 가로에서 바를 기본 숨긴다(WP-278, 사진·영상 면적 우선). */
export const landscapeStore = createMediaQueryStore('(orientation: landscape)')
