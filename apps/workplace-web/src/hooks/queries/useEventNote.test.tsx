// 일정 노트 잇기·끊기 뒤 노트 하단 「연결된 일정」 캐시 무효화(WP-1703) — 이전 노트도 바뀌므로 noteEvents 접두 전체를 다시 읽게 한다.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../api/calendar', () => ({ calendarApi: { linkNote: vi.fn(), unlinkNote: vi.fn() } }))

import { calendarApi } from '../../api/calendar'
import type { EventNoteLink } from '../../types/calendar'
import { calendarKeys } from './calendarKeys'
import { useLinkEventNote, useUnlinkEventNote } from './useEventNote'

const OCC = '2026-11-25T01:00:00Z'

/** QueryClient 와 무효화한 키 기록을 돌려준다. */
function setup() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  const spy = vi.spyOn(qc, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  const keys = () => spy.mock.calls.map((args) => (args[0] as { queryKey?: unknown }).queryKey)
  return { qc, wrapper, keys }
}

const card = (pageId: number): EventNoteLink => ({ note: { restricted: false, pageId, title: '회의록' } })

describe('일정 노트 잇기·끊기', () => {
  it('이으면 카드를 바로 바꾸고 noteEvents 전체를 무효화한다', async () => {
    vi.mocked(calendarApi.linkNote).mockResolvedValueOnce({ data: card(2) } as never)
    const { qc, wrapper, keys } = setup()
    const { result } = renderHook(() => useLinkEventNote(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ id: 7, occurrenceDate: OCC, pageId: 2 })
    })
    expect(qc.getQueryData(calendarKeys.eventNote(7, OCC))).toEqual(card(2))
    expect(keys()).toEqual([calendarKeys.noteEventsAll])
  })

  it('끊으면 카드를 「연결 없음」으로 바꾸고 noteEvents 전체를 무효화한다', async () => {
    vi.mocked(calendarApi.unlinkNote).mockResolvedValueOnce({ data: undefined } as never)
    const { qc, wrapper, keys } = setup()
    qc.setQueryData(calendarKeys.eventNote(7, OCC), card(1))
    const { result } = renderHook(() => useUnlinkEventNote(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ id: 7, occurrenceDate: OCC })
    })
    expect(qc.getQueryData(calendarKeys.eventNote(7, OCC))).toEqual({ note: null })
    expect(keys()).toEqual([calendarKeys.noteEventsAll])
  })

  it('noteEventsAll 은 노트별 키의 접두다 — 접두 무효화가 모든 노트 패널에 닿는다', () => {
    expect(calendarKeys.noteEvents(3).slice(0, 2)).toEqual([...calendarKeys.noteEventsAll])
  })
})
