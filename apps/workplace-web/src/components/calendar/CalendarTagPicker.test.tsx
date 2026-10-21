// 태그 피커 저장 줄 세우기(WP-714 리뷰) — PUT 은 집합 전체 교체라 동시에 보내면 늦게 끝난 옛 요청이 서버를 덮는다.
// 첫 PUT 을 붙잡아 둔 채 연달아 체크하면 요청은 두 번(첫 선택, 마지막 선택)만 나가고, 실패하면 열 때 값이 아니라
// 서버가 마지막으로 받아들인 집합으로 되돌아가는지 본다. 데이터 훅은 끊고 mutateAsync 를 손으로 끝낸다.
import { act, fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '../../test/renderWithProviders'
import { CalendarTagPicker } from './CalendarTagPicker'

/** 테스트가 직접 끝내는 요청 하나 — 보낸 값과 resolve/reject 손잡이. */
interface Call {
  payload: { eventId: number; tagIds: number[] }
  resolve: () => void
  reject: (e: Error) => void
}

const calls: Call[] = []
const mutateAsync = vi.fn(
  (payload: Call['payload']) =>
    new Promise<void>((resolve, reject) => {
      calls.push({ payload, resolve, reject })
    }),
)

vi.mock('@/hooks/queries/useCalendarTags', () => ({
  useCalendarTags: () => ({
    data: [
      { id: 1, name: 'A', color: 'blue', eventCount: 0, hasFeed: false, fromOutlook: false },
      { id: 2, name: 'B', color: 'teal', eventCount: 0, hasFeed: false, fromOutlook: false },
      { id: 3, name: 'C', color: 'pink', eventCount: 0, hasFeed: false, fromOutlook: false },
    ],
    isSuccess: true,
  }),
  useCreateCalendarTag: () => ({ mutate: vi.fn(), isPending: false }),
  useSetEventTags: () => ({ mutateAsync }),
}))

function renderPicker() {
  renderWithProviders(
    <CalendarTagPicker eventId={7} current={[]}>
      <button type="button">태그 열기</button>
    </CalendarTagPicker>,
  )
  fireEvent.click(screen.getByRole('button', { name: '태그 열기' }))
}

const box = (name: string) => screen.getByRole('checkbox', { name })

describe('CalendarTagPicker 저장 줄 세우기', () => {
  beforeEach(() => {
    calls.length = 0
    mutateAsync.mockClear()
  })

  it('첫 PUT 이 끝나기 전 연달아 체크하면 마지막 선택만 이어서 보낸다(요청 2번)', async () => {
    renderPicker()
    fireEvent.click(box('A'))
    fireEvent.click(box('B'))
    fireEvent.click(box('C'))

    // 첫 요청만 나가 있고, 화면은 이미 셋 다 체크
    expect(calls.map((c) => c.payload.tagIds)).toEqual([[1]])
    expect(box('C')).toHaveAttribute('aria-checked', 'true')

    await act(async () => calls[0].resolve())
    expect(calls.map((c) => c.payload)).toEqual([
      { eventId: 7, tagIds: [1] },
      { eventId: 7, tagIds: [1, 2, 3] },
    ])

    await act(async () => calls[1].resolve())
    expect(mutateAsync).toHaveBeenCalledTimes(2)
  })

  it('보내는 중에 되돌려 서버와 같은 집합이 되면 다시 보내지 않는다', async () => {
    renderPicker()
    fireEvent.click(box('A'))
    fireEvent.click(box('B'))
    fireEvent.click(box('B'))

    await act(async () => calls[0].resolve())
    expect(mutateAsync).toHaveBeenCalledTimes(1)
  })

  it('실패하면 열 때 값이 아니라 서버가 마지막으로 받아들인 집합으로 되돌린다', async () => {
    renderPicker()
    fireEvent.click(box('A'))
    await act(async () => calls[0].resolve())

    fireEvent.click(box('B'))
    fireEvent.click(box('C'))
    expect(calls).toHaveLength(2)
    await act(async () => calls[1].reject(new Error('500')))

    // B 저장이 실패 → 쌓여 있던 C 는 버리고 [A] 로 되돌아간다
    expect(mutateAsync).toHaveBeenCalledTimes(2)
    expect(box('A')).toHaveAttribute('aria-checked', 'true')
    expect(box('B')).toHaveAttribute('aria-checked', 'false')
    expect(box('C')).toHaveAttribute('aria-checked', 'false')
  })
})
