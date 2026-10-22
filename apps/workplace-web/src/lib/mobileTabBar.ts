// 모바일 하단 탭바 높이 — MobileTabBar 가 렌더된 높이(안전영역 포함)를 :root 의 --mobile-tabbar-h 로 공개한다(탭바가 없으면 지워져 0).
// 팝오버의 충돌 여백(collisionPadding)처럼 CSS 변수를 쓸 수 없는 숫자 자리는 이 모듈의 구독 훅으로 읽는다 — 탭바 뒤로 팝오버가 숨지 않고 위로 뒤집히게.
// 가운데 정렬 대화상자는 숫자가 필요 없어 CSS(index.css 「하단 탭바 위 대화상자」)가 같은 변수로 맞춘다(WP-806).
import { useSyncExternalStore } from 'react'

/** Radix 팝퍼의 collisionPadding — 숫자(사방 같음) 또는 변별 값(빠진 변은 0). */
export type CollisionPadding = number | Partial<Record<'top' | 'right' | 'bottom' | 'left', number>>

// 지금 탭바 높이(px, 없으면 0) — setMobileTabBarHeight 가 쓰는 값을 모듈에 들고 있다.
// 왜 DOM 을 읽지 않나: 닫혀 있는 팝오버·메뉴 내용(행마다 하나씩, 수백 개)도 구독하므로 getSnapshot 은 변수 하나를 돌려줄 만큼 싸야 한다.
let currentHeight = 0
// 탭바 높이가 바뀔 때 알릴 구독자 — 팝퍼 래퍼(overlay/*)가 렌더 때 한 번 읽은 값에 머물지 않게 한다.
const listeners = new Set<() => void>()

/**
 * 탭바 높이를 :root 에 공개한다(MobileTabBar 전용) — h 가 null 이면(탭바 숨김) 변수와 표식을 지운다.
 * --mobile-tabbar-h(AI 시트·일괄 작업 바 등 CSS 배치)와 data-mobile-tabbar(탭바가 있을 때만 바뀌는 CSS, index.css)를 함께 다루고,
 * 구독자(팝퍼 래퍼)에 알린다. ResizeObserver 가 자주 부르므로 값이 같으면 DOM 쓰기·알림을 건너뛴다.
 */
export function setMobileTabBarHeight(h: number | null): void {
  const next = h ?? 0
  const root = document.documentElement
  // 표식 유무까지 같아야 건너뛴다 — 높이 0 으로 렌더된 탭바(h=0)와 탭바 없음(null)은 표식이 다르다.
  if (next === currentHeight && (h != null) === root.hasAttribute('data-mobile-tabbar')) return
  currentHeight = next
  if (h == null) {
    root.style.removeProperty('--mobile-tabbar-h')
    root.removeAttribute('data-mobile-tabbar')
  } else {
    root.style.setProperty('--mobile-tabbar-h', `${h}px`)
    root.setAttribute('data-mobile-tabbar', '')
  }
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const getSnapshot = () => currentHeight
const getServerSnapshot = () => 0

/**
 * 하단 탭바를 화면 아래 끝처럼 피하는 충돌 여백(WP-806) — 호출부가 준 여백(없으면 컴포넌트 기본값 fallback)의 아래쪽에 탭바 높이를 더한다.
 * 탭바가 없으면(데스크톱·상세 화면) 받은 값을 그대로 돌려줘 기존 동작과 같다.
 * 왜 아래만: 탭바는 화면 아래에만 있다 — 위·좌우까지 넓히면 좁은 화면에서 팝오버 자리를 괜히 줄인다.
 * 키보드가 열려도 탭바 높이만 더하면 된다: Radix 팝퍼(strategy 'fixed')의 충돌 경계는 floating-ui 가 visualViewport 로 잡아
 * 이미 보이는 영역 아래끝(키보드 위끝)이고, 키보드가 열린 셸(MobileShell)의 탭바도 바로 그 자리에 붙는다 — 키보드 높이를 또 더하면 두 번 센다.
 */
export function withTabBarCollisionPadding(
  padding: CollisionPadding | undefined,
  tabBar: number,
  fallback = 0,
): CollisionPadding | undefined {
  if (tabBar <= 0) return padding
  const base = padding ?? fallback
  if (typeof base === 'number') return { top: base, right: base, bottom: base + tabBar, left: base }
  return { ...base, bottom: (base.bottom ?? 0) + tabBar }
}

/**
 * 지금 탭바 높이(px)를 구독한다 — 탭바가 나타나거나 사라지면 다시 그린다.
 * 왜 구독인가: 팝오버·메뉴 내용 컴포넌트는 닫혀 있어도 마운트된 채라, 렌더 때 한 번 읽으면 그 화면이 탭바와 같은 커밋에 그려진 경우
 * (뒤로가기로 캐시 목록이 바로 그려질 때 등) 탭바가 높이를 재기 전 값 0 에 머물렀다.
 */
export function useMobileTabBarHeight(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/** 팝퍼 래퍼용 — 탭바 높이를 구독해 호출부 충돌 여백(없으면 fallback)의 아래에 더한 값을 돌려준다(withTabBarCollisionPadding 참조). */
export function useTabBarCollisionPadding(
  padding: CollisionPadding | undefined,
  fallback?: number,
): CollisionPadding | undefined {
  return withTabBarCollisionPadding(padding, useMobileTabBarHeight(), fallback)
}
