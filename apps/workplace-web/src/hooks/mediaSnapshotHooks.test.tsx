// @vitest-environment jsdom
// 미디어 쿼리 훅 여섯의 렌더 스냅샷 회귀 테스트 + 여러 쿼리가 한 번에 바뀔 때의 일관성 테스트 — WP-1966.
// 왜: 창 폭이 경계를 넘으면 mql.matches 는 change 이벤트보다 먼저 바뀐다. 훅이 live 값을 읽으면 컴포넌트마다 값이 갈리므로
// 훅은 change 때만 바뀌는 스냅샷을 읽어야 한다. 또 한 번의 리사이즈가 여러 쿼리를 뒤집으면 MQL 마다 change 가 따로 오는데
// 그 사이 마이크로태스크 체크포인트에서 React 가 커밋하므로, 한 커밋이 "새 mobile + 옛 compact" 를 보면 안 된다.
// 실제 훅·실제 스토어를 쓴다. 스토어가 MQL 을 첫 사용 시 한 번만 만들어 캐시하므로 가짜 matchMedia 는 파일 안에서 하나만 설치한다.
import { act, render, renderHook } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { useIsCoarsePointer } from '@/hooks/useIsCoarsePointer'
import { useIsLandscape } from '@/hooks/useIsLandscape'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useIsSidebarCompact } from '@/hooks/useIsSidebarCompact'
import { useIsTabBarWide } from '@/hooks/useIsTabBarWide'
import { useIsTouchShell } from '@/hooks/useIsTouchShell'
import { MOBILE_MEDIA_QUERY, SIDEBAR_COMPACT_MEDIA_QUERY, TAB_BAR_WIDE_MEDIA_QUERY } from '@/lib/mobile/breakpoint'
import { installFakeMatchMedia } from '@/test/fakeMatchMedia'

const COARSE = '(pointer: coarse)'
const LANDSCAPE = '(orientation: landscape)'

const fake = installFakeMatchMedia()
const flip = fake.setMatches
/** change 이벤트를 act 안에서 발사한다. */
const fire = (query: string) => act(() => fake.fire(query))

afterEach(() => {
  act(() => fake.reset())
})

describe.each([
  { name: 'useIsMobile', hook: useIsMobile, query: MOBILE_MEDIA_QUERY },
  { name: 'useIsCoarsePointer', hook: useIsCoarsePointer, query: COARSE },
  { name: 'useIsLandscape', hook: useIsLandscape, query: LANDSCAPE },
  { name: 'useIsTabBarWide', hook: useIsTabBarWide, query: TAB_BAR_WIDE_MEDIA_QUERY },
  { name: 'useIsSidebarCompact', hook: useIsSidebarCompact, query: SIDEBAR_COMPACT_MEDIA_QUERY },
])('$name 렌더 스냅샷', ({ hook, query }) => {
  it('matches 만 바뀐 틈엔 옛 값, change 뒤엔 새 값', () => {
    const { result, rerender } = renderHook(() => hook())
    expect(result.current).toBe(false)
    flip(query, true)
    rerender()
    expect(result.current).toBe(false)
    fire(query)
    expect(result.current).toBe(true)
  })
})

describe('useIsTouchShell 렌더 스냅샷', () => {
  it('matches 만 바뀐 틈엔 옛 값, change 뒤엔 새 값', () => {
    // 터치 셸 = 모바일 폭 AND coarse. coarse 는 먼저 확정해 두고 폭 쪽 틈을 본다.
    flip(COARSE, true)
    const { result, rerender } = renderHook(() => useIsTouchShell())
    fire(COARSE)
    expect(result.current).toBe(false)
    flip(MOBILE_MEDIA_QUERY, true)
    rerender()
    expect(result.current).toBe(false)
    fire(MOBILE_MEDIA_QUERY)
    expect(result.current).toBe(true)
  })
})

describe('여러 쿼리가 한 번에 바뀔 때 커밋 일관성', () => {
  // 창 폭 800 → 1440: mobile(true→false)·compact(true→false) 가 함께 뒤집힌다. act 없이 이벤트를 보내고
  // 두 change 사이에 마이크로태스크 체크포인트를 둔다(React 가 sync 레인 스토어 갱신을 커밋하는 지점).
  it.each([
    { order: 'mobile 먼저', first: MOBILE_MEDIA_QUERY, second: SIDEBAR_COMPACT_MEDIA_QUERY },
    { order: 'compact 먼저', first: SIDEBAR_COMPACT_MEDIA_QUERY, second: MOBILE_MEDIA_QUERY },
  ])('한 커밋이 새 mobile 과 옛 compact 를 함께 보지 않는다 ($order)', async ({ first, second }) => {
    flip(MOBILE_MEDIA_QUERY, true)
    flip(SIDEBAR_COMPACT_MEDIA_QUERY, true)
    fire(MOBILE_MEDIA_QUERY)
    fire(SIDEBAR_COMPACT_MEDIA_QUERY)

    const commits: Array<[boolean, boolean]> = []
    /** 커밋마다 (mobile, compact) 조합을 기록한다 — 섞인 조합이 있었는지 본다. */
    function Probe() {
      const mobile = useIsMobile()
      const compact = useIsSidebarCompact()
      useLayoutEffect(() => {
        commits.push([mobile, compact])
      })
      return null
    }
    render(<Probe />)
    commits.length = 0

    const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    const prev = g.IS_REACT_ACT_ENVIRONMENT
    g.IS_REACT_ACT_ENVIRONMENT = false
    try {
      flip(MOBILE_MEDIA_QUERY, false)
      flip(SIDEBAR_COMPACT_MEDIA_QUERY, false)
      fake.fire(first)
      await Promise.resolve()
      fake.fire(second)
      await Promise.resolve()
      await Promise.resolve()
    } finally {
      g.IS_REACT_ACT_ENVIRONMENT = prev
    }

    // 끝 상태는 둘 다 새 값, 그리고 모든 커밋은 (옛,옛) 또는 (새,새) 여야 한다.
    expect(commits.at(-1)).toEqual([false, false])
    for (const c of commits) expect(c[0]).toBe(c[1])
  })
})
