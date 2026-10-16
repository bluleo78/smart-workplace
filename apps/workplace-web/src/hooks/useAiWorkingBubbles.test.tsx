// useAiWorkingBubbles·useEntryMaxMessageId — 리마운트 없이 대화방 key 가 바뀌어도 이전 대화방 상태를 쓰지 않는지(WP-418 리뷰 후속).
// 평소엔 호출 측이 key 로 리마운트하지만, 그 약속이 깨져도 버블·진입 스냅샷이 다음 대화방으로 새지 않아야 한다.
// 상태 전이 규칙 자체는 lib/aiWorkingProgress.test.ts 가 지킨다.
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { keyedSubscribe } from '@/lib/aiWorkingProgress'

import { useAiWorkingBubbles } from './useAiWorkingBubbles'
import { useEntryMaxMessageId } from './useEntryMaxMessageId'

interface TestEvent {
  roomId: number
  streamId: string
  phase: 'started' | 'tool' | 'done' | 'error'
}

/** 테스트용 전역 진행 이벤트 버스 — keyedSubscribe 로 대화방별 구독을 만든다. */
function makeBus() {
  const listeners = new Set<(e: TestEvent) => void>()
  const subscribeAll = (l: (e: TestEvent) => void) => {
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }
  return {
    subscribe: keyedSubscribe(subscribeAll, (e: TestEvent) => e.roomId),
    emit: (e: TestEvent) => act(() => listeners.forEach((l) => l(e))),
  }
}

describe('useAiWorkingBubbles', () => {
  it('keyedSubscribe — 해당 대화방 이벤트만 버블로 반영한다', () => {
    const bus = makeBus()
    const { result } = renderHook(() => useAiWorkingBubbles(1, bus.subscribe, [], true))
    bus.emit({ roomId: 2, streamId: 's', phase: 'started' })
    expect(result.current.size).toBe(0)
    bus.emit({ roomId: 1, streamId: 's', phase: 'started' })
    expect([...result.current.keys()]).toEqual(['s'])
  })

  it('리마운트 없이 key 가 바뀌면 이전 대화방 버블을 즉시 버린다', () => {
    const bus = makeBus()
    const { result, rerender } = renderHook(({ key }) => useAiWorkingBubbles(key, bus.subscribe, [], true), {
      initialProps: { key: 1 },
    })
    bus.emit({ roomId: 1, streamId: 'a', phase: 'started' })
    expect(result.current.size).toBe(1)

    rerender({ key: 2 })
    expect(result.current.size).toBe(0)
  })

  it('이전 대화방의 종료 기록이 새 대화방의 같은 streamId 버블을 막지 않는다', () => {
    const bus = makeBus()
    const { result, rerender } = renderHook(({ key }) => useAiWorkingBubbles(key, bus.subscribe, [], true), {
      initialProps: { key: 1 },
    })
    bus.emit({ roomId: 1, streamId: 's', phase: 'done' })
    rerender({ key: 2 })
    bus.emit({ roomId: 2, streamId: 's', phase: 'started' })
    expect([...result.current.keys()]).toEqual(['s'])
  })

  it('새 대화방 첫 로드는 기준선만 다시 잡고 버블을 지우지 않는다', () => {
    const bus = makeBus()
    const agentMsg = (id: number) => ({ id, authorKind: 'AGENT' })
    const { result, rerender } = renderHook(
      ({ key, messages, loaded }) => useAiWorkingBubbles(key, bus.subscribe, messages, loaded),
      { initialProps: { key: 1, messages: [agentMsg(10)], loaded: true } },
    )
    // 대화방 2 로 바뀌고 메시지 로드 전에 진행 중 버블이 뜬다.
    rerender({ key: 2, messages: [], loaded: false })
    bus.emit({ roomId: 2, streamId: 's', phase: 'started' })
    // 대화방 2 의 첫 로드 — AGENT 최대 id(50)가 대화방 1 기준선(10)보다 커도 "새 답변 도착"이 아니라 기준선만 잡는다.
    rerender({ key: 2, messages: [agentMsg(50)], loaded: true })
    expect(result.current.size).toBe(1)
  })
})

describe('useEntryMaxMessageId', () => {
  it('리마운트 없이 채널이 바뀌면 새 채널 메시지로 다시 스냅샷한다', () => {
    const { result, rerender } = renderHook(
      ({ channelId, messages }) => useEntryMaxMessageId(channelId, messages, true),
      { initialProps: { channelId: 1, messages: [{ id: 5 }] } },
    )
    expect(result.current).toBe(5)
    // 같은 채널에서 진입 후 도착한 메시지는 스냅샷을 바꾸지 않는다(#491).
    rerender({ channelId: 1, messages: [{ id: 5 }, { id: 9 }] })
    expect(result.current).toBe(5)

    rerender({ channelId: 2, messages: [{ id: 30 }] })
    expect(result.current).toBe(30)
  })

  it('로드 전에는 null — 이전 채널 값을 내주지 않는다', () => {
    const { result, rerender } = renderHook(
      ({ channelId, loaded }) => useEntryMaxMessageId(channelId, [{ id: 5 }], loaded),
      { initialProps: { channelId: 1, loaded: true } },
    )
    rerender({ channelId: 2, loaded: false })
    expect(result.current).toBeNull()
  })
})
