// WP-1003: URL 검색어에 묶인 검색창 draft — debounce 쓰기, 내 쓰기의 메아리 건너뛰기, 바깥 변경 따르기, 최신 write 호출.
// 라우터 없이 value(URL q)를 rerender 로 바꿔 판정한다.
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useSearchDraft } from './useSearchDraft'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})
afterEach(() => {
  vi.useRealTimers()
})

/** value·write 를 props 로 받아 훅을 띄운다 — rerender 로 URL 이 바뀐 것을 흉내 낸다. */
function setup(value = '', write = vi.fn<(next: string) => void>()) {
  const view = renderHook(({ value, write }) => useSearchDraft(value, write), { initialProps: { value, write } })
  return { ...view, write }
}

describe('useSearchDraft', () => {
  it('타이핑은 draft 에 바로 반영하고, URL 은 300ms 가 지나서 한 번만 쓴다', () => {
    const { result, write } = setup()
    act(() => result.current.setDraft('a'))
    act(() => result.current.setDraft('ab'))
    expect(result.current.draft).toBe('ab')
    act(() => vi.advanceTimersByTime(299))
    expect(write).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith('ab')
  })

  it('내가 쓴 q 가 되돌아와도, 그 사이 더 친 글자를 덮지 않는다', () => {
    const { result, rerender, write } = setup()
    act(() => result.current.setDraft('이수'))
    act(() => vi.advanceTimersByTime(300))
    expect(write).toHaveBeenLastCalledWith('이수')
    // URL 이 다시 렌더되기 전에 한 글자 더 친다.
    act(() => result.current.setDraft('이수정'))
    rerender({ value: '이수', write })
    expect(result.current.draft).toBe('이수정')
    act(() => vi.advanceTimersByTime(300))
    expect(write).toHaveBeenLastCalledWith('이수정')
  })

  it('메아리는 한 번만 건너뛰고, 바깥에서 q 가 바뀌면 draft 가 따른다', () => {
    const { result, rerender, write } = setup()
    act(() => result.current.setDraft('박'))
    act(() => vi.advanceTimersByTime(300))
    rerender({ value: '박', write })
    // 뒤로 가기·초기화처럼 바깥에서 q 를 지운다.
    rerender({ value: '', write })
    expect(result.current.draft).toBe('')
    rerender({ value: '박', write })
    expect(result.current.draft).toBe('박')
  })

  it('debounce 가 끝난 순간의 최신 write 를 부른다 — 예약할 때의 write(옛 URL 키)를 쓰지 않는다', () => {
    const first = vi.fn<(next: string) => void>()
    const latest = vi.fn<(next: string) => void>()
    const { result, rerender } = setup('', first)
    act(() => result.current.setDraft('a'))
    // 300ms 안에 다른 URL 키가 바뀌어 화면이 새 write 로 다시 렌더된다.
    rerender({ value: '', write: latest })
    act(() => vi.advanceTimersByTime(300))
    expect(first).not.toHaveBeenCalled()
    expect(latest).toHaveBeenCalledWith('a')
  })

  it('debounce 가 끝났을 때 URL 이 이미 같은 값이면 쓰지 않는다', () => {
    const { result, rerender, write } = setup()
    act(() => result.current.setDraft('x'))
    rerender({ value: 'x', write })
    act(() => vi.advanceTimersByTime(300))
    expect(write).not.toHaveBeenCalled()
  })

  it('commit 은 기다리지 않고 draft 와 URL 을 함께 바꾼다 — q 가 같아도 write 를 부른다', () => {
    const { result, write } = setup('')
    act(() => result.current.setDraft('abc'))
    act(() => result.current.commit(''))
    expect(result.current.draft).toBe('')
    expect(write).toHaveBeenCalledWith('')
    act(() => vi.advanceTimersByTime(300))
    expect(write).toHaveBeenCalledTimes(1)
  })
})
