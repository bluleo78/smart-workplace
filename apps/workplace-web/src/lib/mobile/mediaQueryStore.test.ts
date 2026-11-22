// @vitest-environment jsdom
// 미디어 쿼리 스토어의 렌더 스냅샷(getSnapshot) 테스트 — WP-1966.
// 왜: 창 폭이 경계를 넘을 때 mql.matches 는 change 이벤트보다 먼저 바뀐다. 렌더 중 live 값을 읽으면 컴포넌트끼리 값이 갈리므로,
// 렌더용 스냅샷은 change 때만 바뀌고 get() 은 계속 live 여야 한다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installFakeMatchMedia } from '@/test/fakeMatchMedia'

import type { MediaQueryStore } from './mediaQueryStore'

const original = window.matchMedia

describe('mediaQueryStore 렌더 스냅샷', () => {
  // 스토어 목록이 모듈에 쌓이므로 테스트마다 새 모듈에서 팩토리를 받는다 — 앞 테스트의 스토어가 남지 않게.
  let createMediaQueryStore: (query: string) => MediaQueryStore
  beforeEach(async () => {
    vi.resetModules()
    ;({ createMediaQueryStore } = await import('./mediaQueryStore'))
  })
  afterEach(() => {
    window.matchMedia = original
  })

  it('change 전에는 스냅샷이 그대로다', () => {
    const fake = installFakeMatchMedia({ q: false })
    const store = createMediaQueryStore('q')
    expect(store.getSnapshot()).toBe(false)
    fake.setMatches('q', true)
    expect(store.get()).toBe(true)
    expect(store.getSnapshot()).toBe(false)
    fake.fire('q')
    expect(store.getSnapshot()).toBe(true)
  })

  it('알림을 받는 순간 스냅샷은 이미 새 값이다', () => {
    const fake = installFakeMatchMedia({ q: false })
    const store = createMediaQueryStore('q')
    let seen: boolean | null = null
    store.subscribe(() => {
      seen = store.getSnapshot()
    })
    fake.setMatches('q', true)
    fake.fire('q')
    expect(seen).toBe(true)
  })

  it('구독자가 없어도 change 를 따라간다', () => {
    const fake = installFakeMatchMedia({ q: false })
    const store = createMediaQueryStore('q')
    expect(store.getSnapshot()).toBe(false)
    fake.setMatches('q', true)
    fake.fire('q')
    expect(store.getSnapshot()).toBe(true)

    const off = store.subscribe(() => {})
    off()
    fake.setMatches('q', false)
    fake.fire('q')
    expect(store.getSnapshot()).toBe(false)
  })

  it('첫 읽기와 구독 사이 change 를 놓치지 않는다', () => {
    const fake = installFakeMatchMedia({ q: false })
    const store = createMediaQueryStore('q')
    expect(store.getSnapshot()).toBe(false)
    fake.setMatches('q', true)
    fake.fire('q')
    store.subscribe(() => {})
    expect(store.getSnapshot()).toBe(true)
  })

  it('matchMedia 가 나중에 생겨도 읽는다', () => {
    // @ts-expect-error 테스트: matchMedia 없는 환경 흉내
    window.matchMedia = undefined
    const store = createMediaQueryStore('q')
    expect(store.getSnapshot()).toBe(false)
    installFakeMatchMedia({ q: true })
    expect(store.getSnapshot()).toBe(true)
  })

  it('터치 셸 스냅샷은 폭·coarse 어느 쪽이든 change 가 올 때까지 옛 값이고 get 은 실시간이다', async () => {
    const { MOBILE_MEDIA_QUERY } = await import('./breakpoint')
    const fake = installFakeMatchMedia({ [MOBILE_MEDIA_QUERY]: false, '(pointer: coarse)': false })
    const { getIsTouchShell, getTouchShellSnapshot } = await import('./touchShell')
    expect(getTouchShellSnapshot()).toBe(false)
    // 폭 쪽: matches 가 먼저 바뀌어도 스냅샷은 그대로, change 뒤에야 따라온다(coarse 는 true 로 두고 시작).
    fake.setMatches('(pointer: coarse)', true)
    fake.fire('(pointer: coarse)')
    fake.setMatches(MOBILE_MEDIA_QUERY, true)
    expect(getIsTouchShell()).toBe(true)
    expect(getTouchShellSnapshot()).toBe(false)
    fake.fire(MOBILE_MEDIA_QUERY)
    expect(getTouchShellSnapshot()).toBe(true)
    // coarse 쪽: 폭은 모바일인 채로 coarse 를 끈다.
    fake.setMatches('(pointer: coarse)', false)
    expect(getIsTouchShell()).toBe(false)
    expect(getTouchShellSnapshot()).toBe(true)
    fake.fire('(pointer: coarse)')
    expect(getTouchShellSnapshot()).toBe(false)
  })

  describe('여러 스토어 동시 갱신', () => {
    it('한 쿼리의 change 가 다른 스토어 스냅샷도 먼저 갱신한 뒤 알린다', () => {
      const fake = installFakeMatchMedia({ a: false, b: false })
      const a = createMediaQueryStore('a')
      const b = createMediaQueryStore('b')
      a.getSnapshot()
      b.getSnapshot()
      const seen: Array<[boolean, boolean]> = []
      a.subscribe(() => seen.push([a.getSnapshot(), b.getSnapshot()]))
      fake.setMatches('a', true)
      fake.setMatches('b', true)
      fake.fire('a')
      // a 의 change 하나로 b 스냅샷도 이미 새 값이다(b 의 change 는 아직 안 왔다).
      expect(b.getSnapshot()).toBe(true)
      expect(seen).toEqual([[true, true]])
    })

    it('값이 바뀐 스토어는 한 번만 알리고, 뒤늦은 자기 change 는 알리지 않는다', () => {
      const fake = installFakeMatchMedia({ a: false, b: false })
      const a = createMediaQueryStore('a')
      const b = createMediaQueryStore('b')
      a.getSnapshot()
      b.getSnapshot()
      let aCalls = 0
      let bCalls = 0
      a.subscribe(() => aCalls++)
      b.subscribe(() => bCalls++)
      fake.setMatches('a', true)
      fake.setMatches('b', true)
      fake.fire('a')
      expect([aCalls, bCalls]).toEqual([1, 1])
      fake.fire('b')
      expect([aCalls, bCalls]).toEqual([1, 1])
    })

    it('값이 안 바뀐 스토어는 알리지 않는다', () => {
      const fake = installFakeMatchMedia({ a: false, b: false })
      const a = createMediaQueryStore('a')
      const b = createMediaQueryStore('b')
      a.getSnapshot()
      b.getSnapshot()
      let aCalls = 0
      let bCalls = 0
      a.subscribe(() => aCalls++)
      b.subscribe(() => bCalls++)
      fake.setMatches('a', true)
      fake.fire('a')
      expect([aCalls, bCalls]).toEqual([1, 0])
    })

    it('matches 만 바뀐 틈에 처음 읽은 스토어도 다른 스토어와 같은 옛 값으로 시작한다', () => {
      const fake = installFakeMatchMedia({ a: false, b: false })
      const a = createMediaQueryStore('a')
      const b = createMediaQueryStore('b')
      a.getSnapshot()
      fake.setMatches('a', true)
      fake.setMatches('b', true)
      expect([a.getSnapshot(), b.getSnapshot()]).toEqual([false, false])
      fake.fire('a')
      expect([a.getSnapshot(), b.getSnapshot()]).toEqual([true, true])
    })

    it('쓰기 전에는 matchMedia 를 부르지 않고, 첫 사용 때 정의된 스토어 전부의 MQL 을 한 번씩 만든다', () => {
      installFakeMatchMedia({ a: false })
      const calls: string[] = []
      const spy = window.matchMedia
      window.matchMedia = ((q: string) => {
        calls.push(q)
        return spy(q)
      }) as typeof window.matchMedia
      const a = createMediaQueryStore('a')
      const unread = createMediaQueryStore('unread')
      expect(calls).toEqual([])
      a.getSnapshot()
      expect(calls).toEqual(expect.arrayContaining(['a', 'unread']))
      const created = calls.length
      a.get()
      unread.getSnapshot()
      expect(calls).toHaveLength(created)
    })
  })
})
