// useMobileBack — 모바일 ‹ 의 이동(WP-204 판정 + WP-977 fallback).
// 기록이 있으면 시스템 뒤로와 같이 한 칸 뒤로, 딥링크라 기록이 없으면 fallback(없으면 모듈 루트)으로 replace 한다.
// 기록 유무는 BrowserRouter 가 history.state 에 심는 idx 로 판정하므로, MemoryRouter 아래에서 window.history.state 를 직접 심는다.
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'

import { useMobileBack } from './useMobileBack'

afterEach(() => window.history.replaceState(null, ''))

/** entries 를 쌓은 라우터에서 훅을 띄운다 — 반환 back() 을 누른 뒤의 주소를 path() 로 읽는다. */
function setup(entries: string[], fallback?: string) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      {children}
    </MemoryRouter>
  )
  const { result } = renderHook(
    () => {
      const loc = useLocation()
      return { back: useMobileBack(fallback), path: loc.pathname + loc.search }
    },
    { wrapper },
  )
  return { back: () => act(() => result.current.back()), path: () => result.current.path }
}

test('기록이 없으면(딥링크) fallback 으로 간다', () => {
  window.history.replaceState({ idx: 0 }, '')
  const h = setup(['/contacts?group=12'], '/contacts?group=11')
  h.back()
  expect(h.path()).toBe('/contacts?group=11')
})

test('fallback 이 없으면 예전처럼 모듈 루트로 간다', () => {
  window.history.replaceState({ idx: 0 }, '')
  const h = setup(['/contacts?group=12'])
  h.back()
  expect(h.path()).toBe('/contacts')
})

test('기록이 있으면 fallback 이 있어도 한 칸 뒤로 간다', () => {
  window.history.replaceState({ idx: 1 }, '')
  const h = setup(['/contacts?type=MEMBER', '/contacts?group=12'], '/contacts?group=11')
  h.back()
  expect(h.path()).toBe('/contacts?type=MEMBER')
})
