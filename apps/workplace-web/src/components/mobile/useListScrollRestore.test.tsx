// useListScrollRestore — 모바일 목록 스크롤 위치 기록·복원(WP-1463).
// jsdom 은 레이아웃이 없어 scrollTop 이 늘 0 이므로, 요소마다 scrollHeight/clientHeight/scrollTop 을 꾸며
// 「브라우저처럼 최대치까지만 스크롤되는」 요소를 만든다. 복원은 프레임(requestAnimationFrame)마다 시도하므로 가짜 타이머로 프레임을 넘긴다.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { __resetListScroll, useListScrollRestore } from './useListScrollRestore'

/** 스크롤 기하를 꾸민 요소의 손잡이 — 높이를 바꿔(데이터가 늦게 그려짐) 최대 scrollTop 을 조절한다. */
interface FakeScroll {
  setHeights: (scrollHeight: number, clientHeight: number) => void
}

/** el 에 브라우저처럼 0~(scrollHeight-clientHeight) 로 잘리는 scrollTop 과 꾸민 높이를 심는다. */
function fakeScroll(el: HTMLElement, scrollHeight: number, clientHeight: number): FakeScroll {
  const h = { scrollHeight, clientHeight, top: 0 }
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => h.scrollHeight })
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => h.clientHeight })
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => h.top,
    set: (v: number) => {
      h.top = Math.max(0, Math.min(v, h.scrollHeight - h.clientHeight))
    },
  })
  return {
    setHeights: (sh, ch) => {
      h.scrollHeight = sh
      h.clientHeight = ch
    },
  }
}

/** 래퍼(스크롤 요소 0번)와 안쪽 스크롤러(1번)를 가진 목록 — 실제 레이아웃의 래퍼·사이드바 nav 구조를 본뜬다. */
function List({ listKey }: { listKey: string | null }) {
  const ref = useRef<HTMLDivElement>(null)
  useListScrollRestore(ref, listKey)
  return (
    <div ref={ref} data-testid="root" style={{ overflowY: 'auto' }}>
      <div data-testid="plain" />
      <nav data-testid="inner" style={{ overflowY: 'auto' }} />
    </div>
  )
}

/** 사용자가 el 을 top 까지 스크롤한 것처럼 값을 바꾸고 scroll 이벤트를 쏜다(scroll 은 버블링하지 않는다). */
function userScroll(el: HTMLElement, top: number) {
  el.scrollTop = top
  fireEvent.scroll(el)
}

/** 프레임을 n 번 넘긴다. */
function frames(n: number) {
  for (let i = 0; i < n; i++) act(() => vi.advanceTimersToNextFrame())
}

beforeEach(() => {
  vi.useFakeTimers()
  __resetListScroll()
})
afterEach(() => vi.useRealTimers())

test('래퍼를 스크롤하고 떠났다가 같은 목록으로 돌아오면 그 위치로 복원한다', () => {
  const first = render(<List listKey="/wiki/spaces/1" />)
  fakeScroll(screen.getByTestId('root'), 3000, 500)
  userScroll(screen.getByTestId('root'), 1200)
  first.unmount()

  render(<List listKey="/wiki/spaces/1" />)
  const root = screen.getByTestId('root')
  fakeScroll(root, 3000, 500)
  frames(1)
  expect(root.scrollTop).toBe(1200)
})

test('안쪽 스크롤러(1번)를 스크롤했으면 그 요소를 복원하고 래퍼는 그대로 둔다', () => {
  const first = render(<List listKey="/chat" />)
  fakeScroll(screen.getByTestId('root'), 500, 500)
  fakeScroll(screen.getByTestId('inner'), 2000, 400)
  userScroll(screen.getByTestId('inner'), 700)
  first.unmount()

  render(<List listKey="/chat" />)
  const root = screen.getByTestId('root')
  const inner = screen.getByTestId('inner')
  fakeScroll(root, 500, 500)
  fakeScroll(inner, 2000, 400)
  frames(1)
  expect(inner.scrollTop).toBe(700)
  expect(root.scrollTop).toBe(0)
})

test('다른 목록(키)으로 들어오면 복원하지 않는다', () => {
  const first = render(<List listKey="/wiki/spaces/1" />)
  fakeScroll(screen.getByTestId('root'), 3000, 500)
  userScroll(screen.getByTestId('root'), 1200)
  first.unmount()

  render(<List listKey="/wiki/spaces/2" />)
  const root = screen.getByTestId('root')
  fakeScroll(root, 3000, 500)
  frames(5)
  expect(root.scrollTop).toBe(0)
})

test('목록 높이가 늦게 생겨도(데이터가 다음 프레임에 그려짐) 높이가 생긴 뒤 복원한다', () => {
  const first = render(<List listKey="/drive" />)
  fakeScroll(screen.getByTestId('root'), 3000, 500)
  userScroll(screen.getByTestId('root'), 1200)
  first.unmount()

  render(<List listKey="/drive" />)
  const root = screen.getByTestId('root')
  const geo = fakeScroll(root, 500, 500)
  frames(3)
  expect(root.scrollTop).toBe(0)
  geo.setHeights(3000, 500)
  frames(1)
  expect(root.scrollTop).toBe(1200)
})

test('목록이 줄어 이전 위치까지 못 가면 갈 수 있는 끝까지만 가고 약 3초 뒤 멈춘다', () => {
  const first = render(<List listKey="/issues" />)
  fakeScroll(screen.getByTestId('root'), 3000, 500)
  userScroll(screen.getByTestId('root'), 2500)
  first.unmount()

  render(<List listKey="/issues" />)
  const root = screen.getByTestId('root')
  const geo = fakeScroll(root, 1500, 500)
  frames(1)
  expect(root.scrollTop).toBe(1000)
  frames(240)
  // 멈춘 뒤에는 높이가 늘어도 끌어내리지 않는다(무한 재시도 없음).
  geo.setHeights(3000, 500)
  frames(5)
  expect(root.scrollTop).toBe(1000)
})

test('복원 중 사용자가 직접 스크롤(touchstart)하면 복원을 멈춘다', () => {
  const first = render(<List listKey="/drive" />)
  fakeScroll(screen.getByTestId('root'), 3000, 500)
  userScroll(screen.getByTestId('root'), 1200)
  first.unmount()

  render(<List listKey="/drive" />)
  const root = screen.getByTestId('root')
  const geo = fakeScroll(root, 500, 500)
  frames(2)
  fireEvent.touchStart(root)
  geo.setHeights(3000, 500)
  frames(5)
  expect(root.scrollTop).toBe(0)
})

test('같은 래퍼가 남은 채 기록 없는 다른 목록으로 바뀌면 이전 목록의 위치를 버리고 맨 위에서 시작한다', () => {
  const view = render(<List listKey="/wiki" />)
  const root = screen.getByTestId('root')
  fakeScroll(root, 3000, 500)
  userScroll(root, 800)

  view.rerender(<List listKey="/wiki/spaces/1" />)
  expect(root.scrollTop).toBe(0)

  // 앞 목록의 위치는 그대로 기억돼 돌아가면 복원된다.
  view.rerender(<List listKey="/wiki" />)
  frames(1)
  expect(root.scrollTop).toBe(800)
})

test('복원 중 키보드로 스크롤하면 복원을 멈춘다', () => {
  const first = render(<List listKey="/settings" />)
  fakeScroll(screen.getByTestId('root'), 3000, 500)
  userScroll(screen.getByTestId('root'), 1200)
  first.unmount()

  render(<List listKey="/settings" />)
  const root = screen.getByTestId('root')
  const geo = fakeScroll(root, 500, 500)
  frames(2)
  fireEvent.keyDown(root, { key: 'PageDown' })
  geo.setHeights(3000, 500)
  frames(5)
  expect(root.scrollTop).toBe(0)
})
