// 미디어 쿼리 하나를 구독 가능한 외부 스토어로 만드는 팩토리 — useSyncExternalStore 의 (subscribe, getSnapshot) 쌍.
// 왜: 모바일 폭(useIsMobile)·coarse 포인터(터치 셸 판정)가 같은 "MediaQueryList 1개 + change 리스너 1개 + 구독자 Set 팬아웃"
// 코드를 각자 들고 있었다. 훅을 쓰는 컴포넌트(메시지 행 등) 수만큼 matchMedia 객체·리스너가 생기지 않게 하는 규칙은 같으므로 한곳에 둔다.
// React 를 모르는 lib 계층이라 키 입력 시점 판정(isSubmitEnter)처럼 렌더 밖에서도 get() 으로 즉시 읽을 수 있다.
// 쓰임 구분(WP-1966): 렌더 중에는 getSnapshot(change 때만 바뀌는 값), 이벤트 핸들러 등 "지금" 이 필요한 시점에는 get(실시간 matches).
// 폭 경계를 넘을 때 mql.matches 는 change 보다 먼저 바뀌므로, 렌더 중에 get() 으로 읽으면 컴포넌트마다 값이 갈린다.
// 한 번의 리사이즈가 여러 쿼리를 뒤집으면 MQL 마다 change 가 따로 오고 그 사이에 React 가 커밋할 수 있다.
// 그래서 어느 MQL 의 change 든 생성된 모든 스토어의 스냅샷을 먼저 갱신한 뒤, 값이 바뀐 스토어만 한 번에 알린다 —
// 한 커밋이 "새 mobile + 옛 compact" 같은 섞인 조합을 보지 않게 한다.
// 같은 이유로 첫 값도 함께 읽는다 — 어느 스토어든 처음 쓰이면 그때까지 정의된 스토어 전부의 MQL 을 만든다.
// 따로 만들면 matches 만 바뀐 틈에 처음 읽힌 스토어 혼자 새 값으로 시작한다.
import { MOBILE_MEDIA_QUERY, SIDEBAR_COMPACT_MEDIA_QUERY, TAB_BAR_WIDE_MEDIA_QUERY } from './breakpoint'

export interface MediaQueryStore {
  /** 지금 쿼리가 맞는지 동기적으로 읽는다. matchMedia 가 없는 환경(node 단위 테스트·SSR)에선 false. */
  get: () => boolean
  /** 렌더용 스냅샷 — change 때만, 모든 스토어가 함께 바뀐다(까닭은 파일 머리말). */
  getSnapshot: () => boolean
  /** 쿼리 결과가 바뀔 때 onChange 를 부른다. 반환값은 구독 해제 함수. */
  subscribe: (onChange: () => void) => () => void
}

/** 정의된 스토어 전부 — 첫 값 읽기(open)와 갱신(sync → notify)을 한꺼번에 하기 위한 목록. */
const stores: Array<{ open: () => void; sync: () => boolean; notify: () => void }> = []

/** 전부의 스냅샷을 먼저 갱신한 뒤 값이 바뀐 스토어만 알린다. */
function syncAllAndNotify(): void {
  const changed = stores.filter((s) => s.sync())
  changed.forEach((s) => s.notify())
}

/** query 에 대한 공유 스토어를 만든다. MediaQueryList 는 어느 스토어든 최초로 쓰일 때 함께 지연 생성(모듈 로드 시점엔 window 가 없을 수 있음). */
export function createMediaQueryStore(query: string): MediaQueryStore {
  let mql: MediaQueryList | null = null
  // change 때만 갱신되는 렌더 스냅샷. MQL 생성 시점의 matches 로 초기화한다.
  let snapshot = false
  const listeners = new Set<() => void>()

  stores.push({
    // MQL 과 첫 스냅샷을 만든다. 렌더(getSnapshot) 중에 돌 수 있으므로 여기서는 알리지 않는다.
    open: () => {
      if (mql) return
      mql = window.matchMedia(query)
      snapshot = mql.matches
      // 구독자가 없어도 이 리스너는 붙어 있어 스냅샷이 change 를 따라간다. 자기 change 만 보지 않고 전체를 갱신한다
      // (이미 맞춰진 스토어의 뒤늦은 change 는 아무것도 알리지 않는다).
      mql.addEventListener('change', syncAllAndNotify)
    },
    // 스냅샷을 지금 matches 로 맞추고 바뀌었는지 돌려준다.
    sync: () => {
      if (!mql || mql.matches === snapshot) return false
      snapshot = mql.matches
      return true
    },
    notify: () => listeners.forEach((l) => l()),
  })

  // matchMedia 가 없으면 캐시하지 않는다 — 테스트가 나중에 matchMedia 를 심어도 그때부터 동작하게.
  const ensure = (): MediaQueryList | null => {
    if (mql) return mql
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
    stores.forEach((s) => s.open())
    return mql
  }

  return {
    get: () => ensure()?.matches ?? false,
    // ensure() 로 MQL·리스너를 먼저 만든다 — 첫 읽기와 구독 사이의 change 도 놓치지 않는다.
    getSnapshot: () => {
      ensure()
      return snapshot
    },
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
/** 주 포인터가 정밀(마우스·트랙패드)한가 — 입력칸 자동 포커스 기준(WP-1372). 터치는 가상 키보드가 화면을 덮어 자동 포커스하지 않는다
 *  (이슈 채팅 드로워 autoFocus·개인 작업 채팅 딥링크가 같이 쓴다). */
export const finePointerStore = createMediaQueryStore('(pointer: fine)')
/** 가로 방향인가 — 모바일 뷰어는 가로에서 바를 기본 숨긴다(WP-278, 사진·영상 면적 우선). */
export const landscapeStore = createMediaQueryStore('(orientation: landscape)')
/** 하단 탭바를 7칸으로 넓힐 만한 폭인가(WP-877) — 탭바 구성 중 보이는 칸 수를 정한다. */
export const tabBarWideStore = createMediaQueryStore(TAB_BAR_WIDE_MEDIA_QUERY)
/** 2차 사이드바를 아이콘 줄로 접을 만큼 좁은 창인가(WP-506) — 작업 관리 사이드바가 쓴다. */
export const sidebarCompactStore = createMediaQueryStore(SIDEBAR_COMPACT_MEDIA_QUERY)
