// useListScrollRestore — 모바일 목록 스크롤 위치 기록·복원(WP-1463).
// 모바일 list-detail(ResponsiveModuleLayout)은 상세로 가면 목록 DOM 을 언마운트하므로, 돌아와 다시 마운트되면 맨 위(scrollTop 0)였다.
// 목록 래퍼에서 스크롤을 기록해 두었다가 같은 목록(키)으로 다시 마운트되면 그 위치로 되돌린다.
import { type RefObject, useEffect } from 'react'

/** 기록 한 건 — 래퍼 기준 몇 번째 스크롤 요소인지(래퍼 자신 0)와 그 scrollTop. */
interface SavedScroll {
  index: number
  top: number
}

// 목록 키(정규화한 목록 경로) → 마지막 스크롤 위치. 새로고침 뒤 유지는 범위 밖이라 메모리로 충분하다.
const saved = new Map<string, SavedScroll>()

// 복원 재시도 상한(프레임 수, 60fps 기준 약 3초) — 데이터가 늦게 그려져 높이가 생길 때까지 기다리되(캐시가 만료돼
// 다시 받는 느린 모바일 망 포함), 목록이 줄어 목표까지 못 가는 경우 무한히 되풀이하지 않게 한다.
const MAX_RESTORE_FRAMES = 180

/** 테스트 전용 — 모듈 수준 기록을 비운다(테스트끼리 기록이 새지 않게). */
export function __resetListScroll() {
  saved.clear()
}

/**
 * root 와 그 안의 스크롤 가능 요소(overflow-y 가 auto/scroll) 목록 — 래퍼 자신이 0번.
 * 실제로 스크롤되는 요소는 모듈마다 다르다(래퍼 자신 또는 사이드바 안쪽 nav 등). 인덱스로 같은 요소를 다시 찾으려고
 * 「지금 넘치는지」가 아니라 overflow 스타일로 고른다 — 복원 시점엔 데이터가 덜 그려져 아직 넘치지 않을 수 있어서.
 */
function scrollersOf(root: HTMLElement): HTMLElement[] {
  const inner = Array.from(root.querySelectorAll<HTMLElement>('*')).filter((el) => {
    const y = getComputedStyle(el).overflowY
    return y === 'auto' || y === 'scroll'
  })
  return [root, ...inner]
}

/**
 * containerRef 아래에서 일어난 스크롤을 key 로 기록하고, 마운트(또는 key 변경) 때 기록이 있으면 복원한다.
 * key 가 null 이면(데스크톱·상세 분기 — 목록을 그리지 않음) 아무것도 하지 않는다.
 */
export function useListScrollRestore(containerRef: RefObject<HTMLElement | null>, key: string | null) {
  useEffect(() => {
    const root = containerRef.current
    if (key == null || !root) return

    let frame = 0
    let restoring = false

    // 복원을 멈춘다 — 끝났거나, 상한에 닿았거나, 사용자가 직접 스크롤을 시작했을 때.
    const stopRestore = () => {
      restoring = false
      cancelAnimationFrame(frame)
    }

    // 마지막으로 찾은 스크롤 요소와 인덱스 — scroll 은 프레임마다 오므로 같은 요소면 하위 스타일 계산(scrollersOf)을 건너뛴다.
    let lastTarget: HTMLElement = root
    let lastIndex = 0

    // 스크롤 기록 — scroll 은 버블링하지 않으므로 capture 단계에서 안쪽 스크롤러의 이벤트까지 잡는다.
    // 복원이 스스로 바꾸는 scrollTop(높이가 덜 생겨 중간값)으로 기록을 덮지 않게 복원 중에는 기록하지 않는다.
    const onScroll = (e: Event) => {
      if (restoring) return
      const target = e.target
      if (!(target instanceof HTMLElement)) return
      if (target !== lastTarget) {
        const index = scrollersOf(root).indexOf(target)
        if (index < 0) return
        lastTarget = target
        lastIndex = index
      }
      saved.set(key, { index: lastIndex, top: target.scrollTop })
    }
    root.addEventListener('scroll', onScroll, { capture: true, passive: true })

    // 복원 — 다시 마운트된 직후엔 목록 데이터(react-query 캐시)가 아직 안 그려져 높이가 모자랄 수 있어
    // 목표 위치에 닿을 때까지 프레임마다 다시 시도한다(상한 MAX_RESTORE_FRAMES).
    const restore = ({ index, top }: SavedScroll) => {
      let el: HTMLElement | undefined = index === 0 ? root : undefined
      let tries = 0
      const step = () => {
        // 안쪽 스크롤러는 데이터가 그려진 뒤에야 생길 수 있어, 찾을 때까지만 다시 찾는다(찾은 뒤엔 그 요소만 쓴다).
        el ??= scrollersOf(root)[index]
        if (el) {
          el.scrollTop = top
          if (Math.abs(el.scrollTop - top) < 1) return stopRestore()
        }
        tries += 1
        if (tries >= MAX_RESTORE_FRAMES) return stopRestore()
        frame = requestAnimationFrame(step)
      }
      restoring = true
      frame = requestAnimationFrame(step)
    }
    const target = saved.get(key)
    if (target && target.top > 0) restore(target)
    // 같은 래퍼가 그대로 남은 채 다른 목록으로 바뀌면(예: /wiki → /wiki/spaces/1) 이전 목록의 위치가 남는다 — 맨 위에서 시작한다.
    else root.scrollTop = 0

    // 사용자가 복원 도중 직접 스크롤하면(터치·휠·스크롤바 끌기·키보드) 끌려가지 않게 복원을 멈춘다.
    const onUserScroll = () => {
      if (restoring) stopRestore()
    }
    const userEvents = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const
    for (const type of userEvents) root.addEventListener(type, onUserScroll, { passive: true })

    return () => {
      stopRestore()
      root.removeEventListener('scroll', onScroll, { capture: true })
      for (const type of userEvents) root.removeEventListener(type, onUserScroll)
    }
  }, [containerRef, key])
}
