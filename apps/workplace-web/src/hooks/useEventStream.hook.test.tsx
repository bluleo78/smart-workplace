// useEventStream 훅의 생성 중 대화 재동기화 시점 테스트(WP-1664).
// 평소 첫 동기화(GET /ai/chat/active)는 SSE 첫 onOpen 한 번 — 구독이 살아난 뒤 받아야 종결 이벤트를 놓치지 않는다(WP-190).
// 첫 연결이 늦으면(실패·백오프) INITIAL_SYNC_FALLBACK_MS 뒤 REST 로 한 번 먼저 맞춘다. 재연결마다 다시 맞춘다.
// 순수 함수 판정(routeStreamEvent·createCatchUp)은 useEventStream.test.ts(node 환경)가 지킨다.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/eventStream', () => ({ subscribeEventStream: vi.fn(() => () => {}) }))
vi.mock('@/hooks/chatStreamsSync', () => ({ resyncActiveChats: vi.fn(() => Promise.resolve()) }))

import { resyncActiveChats } from '@/hooks/chatStreamsSync'
import { INITIAL_SYNC_FALLBACK_MS, useEventStream } from '@/hooks/useEventStream'
import { type EventStreamOptions, subscribeEventStream } from '@/lib/eventStream'

/** 훅을 띄우고 subscribeEventStream 에 넘긴 옵션(onOpen 을 테스트가 직접 부른다)을 돌려준다. */
function renderStream() {
  const client = new QueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const view = renderHook(() => useEventStream(1), { wrapper })
  const opts = vi.mocked(subscribeEventStream).mock.calls[0][0] as EventStreamOptions
  /** 연결이 열린 것처럼 onOpen 을 부른다(실제 스트림은 상태를 setState 하므로 act 로 감싼다). */
  const open = (reconnect: boolean) => act(() => opts.onOpen?.({ reconnect }))
  return { view, open }
}

describe('useEventStream 생성 중 대화 재동기화 (WP-1664)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(resyncActiveChats).mockClear()
    vi.mocked(subscribeEventStream).mockClear()
  })
  afterEach(() => vi.useRealTimers())

  it('대체 시간 전에 첫 onOpen 이 오면 정확히 1회 — 대체 시간이 지나도 더 부르지 않는다', () => {
    const { open } = renderStream()
    expect(resyncActiveChats).not.toHaveBeenCalled() // 연결 전에는 부르지 않는다
    open(false)
    expect(resyncActiveChats).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(INITIAL_SYNC_FALLBACK_MS * 2)
    expect(resyncActiveChats).toHaveBeenCalledTimes(1)
  })

  it('대체 시간 안에 열리지 않으면 그때 1회, 뒤늦은 첫 onOpen 에서 1회 더', () => {
    const { open } = renderStream()
    vi.advanceTimersByTime(INITIAL_SYNC_FALLBACK_MS - 1)
    expect(resyncActiveChats).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(resyncActiveChats).toHaveBeenCalledTimes(1)
    open(false)
    expect(resyncActiveChats).toHaveBeenCalledTimes(2)
  })

  it('재연결 onOpen 에서도 다시 맞춘다', () => {
    const { open } = renderStream()
    open(false)
    open(true)
    expect(resyncActiveChats).toHaveBeenCalledTimes(2)
  })

  it('대체 시간 전에 언마운트하면 부르지 않는다', () => {
    const { view } = renderStream()
    view.unmount()
    vi.advanceTimersByTime(INITIAL_SYNC_FALLBACK_MS * 2)
    expect(resyncActiveChats).not.toHaveBeenCalled()
  })
})
