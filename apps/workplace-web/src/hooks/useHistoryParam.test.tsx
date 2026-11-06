// useHistoryParam 의 마크 없는 진입 펴기(unmarkedEntry='expand', WP-1414) 중 「펴기를 건너뛴 경우」 — 훅 테스트.
// 펴기는 브라우저 key 와 라우터 위치 key 가 같을 때만 한다. 어긋나 건너뛰면 값을 숨긴 채 두지 말고
// 펴지 않은 채로 열어야 한다(숨긴 채면 ?chat=1 인데 서랍이 영영 안 보이고 여는 단추도 먹지 않는다).
// MemoryRouter 는 window.history 를 쓰지 않아 두 번째 항목의 key 가 브라우저 key("default")와 늘 어긋난다 — 이것으로 낡은 위치를 흉내 낸다.
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { BrowserRouter, MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, test } from 'vitest'

import { useHistoryParam } from './useHistoryParam'

function wrapper(entries: string[]) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
        {children}
      </MemoryRouter>
    )
  }
}

describe('useHistoryParam — 마크 없는 진입 펴기를 건너뛰면 그대로 연다 (WP-1414)', () => {
  test('브라우저 key 가 라우터 위치와 어긋나면 펴지 않고 값을 보인다(주소도 그대로)', async () => {
    const { result } = renderHook(
      () => ({
        param: useHistoryParam('chat', { unmarkedEntry: 'expand', unmarkedEntryReady: true }),
        location: useLocation(),
      }),
      { wrapper: wrapper(['/inbox', '/projects/WP/issues/1?chat=1']) },
    )
    await waitFor(() => expect(result.current.param.value).toBe('1'))
    // 펴지 않았다 — 같은 주소·같은 항목.
    expect(result.current.location.pathname + result.current.location.search).toBe('/projects/WP/issues/1?chat=1')
  })

  test('준비 전(unmarkedEntryReady=false)에는 숨기지 않는다', () => {
    const { result } = renderHook(
      () => useHistoryParam('chat', { unmarkedEntry: 'expand', unmarkedEntryReady: false }),
      { wrapper: wrapper(['/inbox', '/projects/WP/issues/1?chat=1']) },
    )
    expect(result.current.value).toBe('1')
  })
})

// 라우터 밖 history.pushState({}) 로 쌓인 항목은 key 가 없어 react-router 위치 key 가 모두 'default' 다.
// 펴기 결정을 key 로 기억하면 두 번째 항목(다른 이슈 ?chat=1)부터 「이미 결정함」으로 보고 값을 숨긴 채 멈췄다
// (e2e chat-progress 「다른 이슈로 옮기면」 회귀). 위치마다 따로 결정해야 한다.
describe('useHistoryParam — key 없는 항목이 이어져도 위치마다 편다 (WP-1414)', () => {
  /** 라우터 밖에서 key 없는 항목을 쌓고 라우터에 알린다(e2e clientNavigate 와 같은 방식). */
  function pushKeyless(path: string) {
    act(() => {
      window.history.pushState({}, '', path)
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
  }

  test('이슈 1 ?chat=1 을 편 뒤 이슈 2 ?chat=1 로 옮겨도 값이 보이고 다시 편다', async () => {
    window.history.replaceState(null, '', '/projects/WP/issues/2')
    const { result } = renderHook(
      () => ({
        param: useHistoryParam('chat', { unmarkedEntry: 'expand', unmarkedEntryReady: true }),
        location: useLocation(),
      }),
      { wrapper: ({ children }: { children: ReactNode }) => <BrowserRouter>{children}</BrowserRouter> },
    )

    pushKeyless('/projects/WP/issues/1?chat=1')
    await waitFor(() => expect(result.current.param.value).toBe('1'))
    expect(result.current.location.pathname).toBe('/projects/WP/issues/1')

    pushKeyless('/projects/WP/issues/2?chat=1')
    await waitFor(() => expect(result.current.param.value).toBe('1'))
    expect(result.current.location.pathname).toBe('/projects/WP/issues/2')
    // 편 결과 — 열린 항목에 마크가 있다(펴지 않고 건너뛴 게 아니다).
    expect(result.current.location.state).toEqual({ 'historyParam:chat': expect.any(Number) })
  })
})
