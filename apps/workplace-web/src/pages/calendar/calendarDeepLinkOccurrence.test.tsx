// @vitest-environment jsdom
// 캘린더 딥링크 ?occurrence(WP-1703) — 노트 하단 연결 일정 링크가 가리키는 반복 회차를 연다.
// 회차 시각은 순간으로 비교한다: 목록이 0초를 줄인 '…T01:00Z' 로 돌려줘도 링크의 '…T01:00:00Z' 회차를 찾아야 한다.
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { fixClock, renderCalendar } from '@/test/kits/calendar/calendarPageKit'

import { calendarEvent, recurringCalendarEvent } from '../../../e2e/factories/calendar.factory'

fixClock()

const MASTER = calendarEvent({ id: 7, title: '주간 회의', recurrenceRule: 'FREQ=WEEKLY', occurrenceDate: null, startsAt: '2026-11-18T01:00:00Z' })
const LINK_OCC = '2026-11-25T01:00:00Z'

/** 목록 API 가 회차 시각을 0초 없이('…T01:00Z') 돌려주는 경우. from/to 를 requests 에 남긴다. */
function shortForm(requests: URLSearchParams[]) {
  return http.get('/api/v1/calendar/events', ({ request }) => {
    requests.push(new URL(request.url).searchParams)
    return HttpResponse.json(recurringCalendarEvent(7, ['2026-11-18T01:00Z', '2026-11-25T01:00Z', '2026-12-02T01:00Z']))
  })
}

describe('캘린더 딥링크 ?occurrence', () => {
  test('그 회차 객체로 열리고 회의록은 그 회차 키로 조회한다(목록이 …T01:00Z 로 써도)', async () => {
    const lists: URLSearchParams[] = []
    const { requests } = await renderCalendar(
      { detail: () => MASTER },
      { path: `/calendar?eventId=7&occurrence=${encodeURIComponent(LINK_OCC)}`, handlers: [shortForm(lists)] },
    )
    await screen.findByTestId('calendar-event-dialog')
    await waitFor(() => expect(requests.noteGets.length).toBeGreaterThan(0))
    expect(requests.noteGets.at(-1)?.searchParams.get('occurrenceDate')).toBe('2026-11-25T01:00Z')
    // 그 시각부터 24시간 창으로 조회했다
    const q = lists.find((p) => p.get('from') === '2026-11-25T01:00:00.000Z')
    expect(q?.get('to')).toBe('2026-11-26T01:00:00.000Z')
  })

  test('목록에 그 회차가 없으면 마스터로 열린다(회의록 줄·오류 없음)', async () => {
    const { requests } = await renderCalendar(
      { detail: () => MASTER },
      {
        path: `/calendar?eventId=7&occurrence=${encodeURIComponent(LINK_OCC)}`,
        handlers: [http.get('/api/v1/calendar/events', () => HttpResponse.json([]))],
      },
    )
    await screen.findByTestId('calendar-event-dialog')
    expect(screen.getByTestId('calendar-form-title')).toBeInTheDocument()
    expect(screen.queryByTestId('event-note-pick')).not.toBeInTheDocument()
    expect(requests.noteGets).toHaveLength(0)
  })

  test('occurrence 없이 eventId 만이면 지금처럼 마스터로 열린다', async () => {
    const lists: URLSearchParams[] = []
    const { requests } = await renderCalendar({ detail: () => MASTER }, { path: '/calendar?eventId=7', handlers: [shortForm(lists)] })
    await screen.findByTestId('calendar-event-dialog')
    expect(screen.queryByTestId('event-note-pick')).not.toBeInTheDocument()
    expect(requests.noteGets).toHaveLength(0)
  })
})
