// 페이지 테스트의 뷰포트 흉내(WP-981) — jsdom 은 matchMedia 가 없어 늘 데스크톱으로 보인다.
// 앱은 폭·포인터를 matchMedia 로만 판정하므로(useIsMobile·터치 셸·탭바 칸 수), 쿼리를 주어진 폭·포인터로 계산해 돌려준다.
// lib/mobile/mediaQueryStore 가 MediaQueryList 를 파일(모듈 레지스트리) 안에서 한 번만 만들어 캐시하므로,
// 한 테스트 파일은 뷰포트 하나만 쓴다 — 파일 맨 위(첫 renderPage 전)에서 한 번 부른다.
import { vi } from 'vitest'

export type Viewport = { width: number; height: number; pointer: 'coarse' | 'fine' }

/** E2E mobile 프로젝트(iPhone 13)와 같은 폭·터치 포인터. */
export const MOBILE_VIEWPORT: Viewport = { width: 390, height: 844, pointer: 'coarse' }

const REM = 16

/** 길이 하나(px·rem)를 px 로. */
function toPx(value: string, unit: string): number {
  return unit === 'rem' ? Number(value) * REM : Number(value)
}

/** 미디어 쿼리 조건 하나가 뷰포트에 맞는가 — 앱이 쓰는 꼴만 안다. 모르는 조건은 맞지 않음(false). */
function matchesFeature(feature: string, vp: Viewport): boolean {
  const f = feature.trim().replace(/^\(|\)$/g, '').trim()
  // 범위 문법: (width < 64rem), (width >= 390px)
  let m = f.match(/^(width|height)\s*(<=|>=|<|>)\s*([\d.]+)(px|rem)$/)
  if (m) {
    const actual = m[1] === 'width' ? vp.width : vp.height
    const limit = toPx(m[3], m[4])
    return { '<': actual < limit, '<=': actual <= limit, '>': actual > limit, '>=': actual >= limit }[m[2]]!
  }
  // 옛 문법: (max-width: 1023px), (min-width: 64rem)
  m = f.match(/^(min|max)-(width|height)\s*:\s*([\d.]+)(px|rem)$/)
  if (m) {
    const actual = m[2] === 'width' ? vp.width : vp.height
    const limit = toPx(m[3], m[4])
    return m[1] === 'min' ? actual >= limit : actual <= limit
  }
  if (f.startsWith('pointer')) return f.endsWith(vp.pointer)
  if (f.startsWith('hover')) return f.endsWith(vp.pointer === 'fine' ? 'hover' : 'none')
  if (f.startsWith('orientation')) return f.endsWith(vp.width > vp.height ? 'landscape' : 'portrait')
  return false
}

/** 쿼리 전체 — `and` 로 이은 조건이 모두 맞아야 맞다. */
function matchesQuery(query: string, vp: Viewport): boolean {
  return query.split(/\s+and\s+/).every((part) => matchesFeature(part, vp))
}

/** window.matchMedia·innerWidth/innerHeight 를 뷰포트에 맞춘다. 테스트 파일 맨 위에서 한 번 부른다. */
export function mockViewport(vp: Viewport = MOBILE_VIEWPORT) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: matchesQuery(query, vp),
        media: query,
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  )
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: vp.width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: vp.height })
}

/**
 * 폭을 바꿀 수 있는 뷰포트(WP-1743) — 같은 파일 안에서 좁은 폭 ↔ 넓은 폭 전환을 볼 때 쓴다. 파일 맨 위에서 한 번 부른다.
 * mediaQueryStore 가 MediaQueryList 를 파일당 한 번 캐시하므로, matches 를 getter 로 두어 지금 폭을 읽게 하고
 * 돌려준 setWidth 가 폭을 바꾼 뒤 등록된 change 리스너를 모두 불러 구독(useIsMobile 등)이 다시 판정하게 한다.
 */
export function mockResizableViewport(initial: Viewport) {
  let vp = initial
  const lists: Array<{ media: string; listeners: Set<(e: unknown) => void> }> = []
  vi.spyOn(window, 'matchMedia').mockImplementation((media: string) => {
    const listeners = new Set<(e: unknown) => void>()
    lists.push({ media, listeners })
    return {
      // getter — setWidth 가 폭만 바꾸면 캐시된 mql 도 새 결과를 돌려준다.
      get matches() {
        return matchesQuery(media, vp)
      },
      media,
      onchange: null,
      addEventListener: (_type: string, cb: (e: unknown) => void) => listeners.add(cb),
      removeEventListener: (_type: string, cb: (e: unknown) => void) => listeners.delete(cb),
      addListener: (cb: (e: unknown) => void) => listeners.add(cb),
      removeListener: (cb: (e: unknown) => void) => listeners.delete(cb),
      dispatchEvent: () => false,
    } as unknown as MediaQueryList
  })
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: vp.width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: vp.height })
  /** 폭을 바꾸고 등록된 change 리스너를 전부 부른다. */
  const setWidth = (width: number) => {
    vp = { ...vp, width }
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
    for (const { media, listeners } of lists) {
      const event = { matches: matchesQuery(media, vp), media }
      for (const listener of listeners) listener(event)
    }
  }
  return { setWidth, width: () => vp.width }
}
