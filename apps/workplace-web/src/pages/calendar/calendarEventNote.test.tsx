// @vitest-environment jsdom
// 일정 회의록 노트 줄(WP-1701) — 「노트 연결」 → 고르기 → 카드, X 해제, 볼 수 없는 노트, 읽기 전용 상세, 반복 회차 쿼리,
// 새 일정의 저장 뒤 잇기(대기·취소·잇기 실패 토스트). CalendarPage 를 renderScreen 으로 띄우고 노트 API 는 calendarPageKit 의 목이 받는다.
// 390px 레이아웃은 e2e(calendar-event-note.spec.ts @layout)가 지킨다. 지금 = 2026-06-10 12:00 KST.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { fixClock, renderCalendar } from '@/test/kits/calendar/calendarPageKit'

import {
  calendarEvent,
  eventNote,
  eventNoteRestricted,
  noteSearchResult,
  recurringCalendarEvent,
} from '../../../e2e/factories/calendar.factory'

fixClock()

/** 노트 연결 창이 부르는 위키 검색 — 주간 회의록 한 건. */
const wikiSearch = http.get('/api/v1/wiki/search', () => HttpResponse.json([noteSearchResult()]))

/** 일정 칩을 눌러 대화상자를 연다. */
async function openEvent(user: { click: (el: Element) => Promise<void> }, testId: string) {
  await user.click((await screen.findAllByTestId(testId))[0])
  return screen.findByTestId('calendar-event-dialog')
}

/** 노트 연결 창에서 첫 결과를 골라 「연결」을 누른다. */
async function pickFirstNote(user: { click: (el: Element) => Promise<void> }) {
  await user.click(await screen.findByTestId('note-link-result'))
  await user.click(screen.getByTestId('note-link-submit'))
}

const MEETING = calendarEvent({ id: 1, title: '팀 회의' })

describe('회의록 줄 — 내 일정(편집 폼)', () => {
  test('연결이 없으면 「노트 연결」만 보이고 「회의록 만들기」는 없다', async () => {
    const { user } = await renderCalendar({ events: [MEETING] })
    await openEvent(user, 'calendar-event-1')
    expect(await screen.findByTestId('event-note-pick')).toHaveTextContent('노트 연결')
    expect(screen.queryByText('회의록 만들기')).not.toBeInTheDocument()
  })

  test('노트 연결 → 행 고르기 → 연결하면 PUT body 가 pageId 이고 카드에 제목·공간과 「열기」가 보인다', async () => {
    const { user, requests } = await renderCalendar({ events: [MEETING] }, { handlers: [wikiSearch] })
    await openEvent(user, 'calendar-event-1')
    await user.click(await screen.findByTestId('event-note-pick'))
    // 창은 일정 제목으로 검색해 열린다
    expect(await screen.findByTestId('note-link-search')).toHaveValue('팀 회의')
    await pickFirstNote(user)

    const card = await screen.findByTestId('event-note-card')
    expect(card).toHaveTextContent('주간 회의록')
    expect(card).toHaveTextContent('기획팀 공간 · 양동희')
    expect(within(card).getByTestId('event-note-open')).toHaveAttribute('href', '/wiki/spaces/3/pages/11')
    expect(requests.notePuts).toHaveLength(1)
    expect(requests.notePuts[0].body).toEqual({ pageId: 11 })
    expect(requests.notePuts[0].url.pathname).toBe('/api/v1/calendar/events/1/note')
    expect(requests.notePuts[0].url.searchParams.has('occurrenceDate')).toBe(false)
    // 일정 창은 닫히지 않는다 — 일정을 고치던 중이어도 그대로
    expect(screen.getByTestId('calendar-event-dialog')).toBeInTheDocument()
    expect(requests.patches).toHaveLength(0)
  })

  test('한 번도 고치지 않은 노트(고친 사람 없음)는 카드 메타가 「공간 · 고친 때」다', async () => {
    const { user } = await renderCalendar({
      events: [MEETING],
      notes: { '1|': eventNote({ updatedByName: undefined }) },
    })
    await openEvent(user, 'calendar-event-1')
    const card = await screen.findByTestId('event-note-card')
    expect(card).toHaveTextContent(/기획팀 공간 · .+ 수정/)
    expect(card.textContent).not.toMatch(/ ·\s*·/)
  })

  test('반복 회차를 열어 연결하면 occurrenceDate 쿼리가 그 회차 값이다', async () => {
    const occ = ['2026-06-08T01:00:00Z', '2026-06-15T01:00:00Z']
    const { user, requests } = await renderCalendar({ events: recurringCalendarEvent(5, occ) }, { handlers: [wikiSearch] })
    await openEvent(user, `calendar-event-5-${occ[1]}`)
    await user.click(await screen.findByTestId('event-note-pick'))
    await pickFirstNote(user)
    await screen.findByTestId('event-note-card')
    expect(requests.noteGets.at(-1)?.searchParams.get('occurrenceDate')).toBe(occ[1])
    expect(requests.notePuts[0].url.searchParams.get('occurrenceDate')).toBe(occ[1])
  })

  test('X 를 누르면 DELETE 하고 다시 「노트 연결」이 보인다', async () => {
    const { user, requests } = await renderCalendar({ events: [MEETING], notes: { '1|': eventNote() } })
    await openEvent(user, 'calendar-event-1')
    await screen.findByTestId('event-note-card')
    await user.click(screen.getByRole('button', { name: '회의록 연결 해제' }))
    expect(await screen.findByTestId('event-note-pick')).toBeInTheDocument()
    expect(screen.queryByTestId('event-note-card')).not.toBeInTheDocument()
    expect(requests.noteDeletes).toHaveLength(1)
    expect(requests.noteDeletes[0].pathname).toBe('/api/v1/calendar/events/1/note')
  })

  test('restricted 카드는 「볼 수 없는 노트」만, 「열기」 없음 — 고칠 수 있으면 X 로 풀 수 있다', async () => {
    const { user } = await renderCalendar({ events: [MEETING], notes: { '1|': eventNoteRestricted() } })
    await openEvent(user, 'calendar-event-1')
    const card = await screen.findByTestId('event-note-card')
    expect(card).toHaveTextContent('볼 수 없는 노트')
    expect(screen.queryByTestId('event-note-open')).not.toBeInTheDocument()
    expect(within(card).getByRole('button', { name: '회의록 연결 해제' })).toBeInTheDocument()
  })

  test('연결 PUT 이 404 면 창 안에 「노트를 찾을 수 없습니다」가 보이고 창은 열린 채다', async () => {
    const notFound = http.put('/api/v1/calendar/events/:id/note', () =>
      HttpResponse.json({ message: '노트를 찾을 수 없습니다' }, { status: 404 }),
    )
    const { user } = await renderCalendar({ events: [MEETING] }, { handlers: [notFound, wikiSearch] })
    await openEvent(user, 'calendar-event-1')
    await user.click(await screen.findByTestId('event-note-pick'))
    await pickFirstNote(user)
    expect(await screen.findByTestId('note-link-error')).toHaveTextContent('노트를 찾을 수 없습니다')
    expect(screen.getByTestId('note-link-dialog')).toBeInTheDocument()
  })

  test('노트 GET 이 note:null 로 바뀌면(노트 삭제) 카드가 사라지고 「노트 연결」이 보인다', async () => {
    const { user, state } = await renderCalendar({ events: [MEETING], notes: { '1|': eventNote() } })
    await openEvent(user, 'calendar-event-1')
    await screen.findByTestId('event-note-card')
    // 그 사이 노트가 지워졌다 — 일정을 저장하면 캘린더 쿼리가 무효화돼 노트도 다시 읽는다
    state.notes = {}
    await user.click(screen.getByTestId('calendar-form-submit'))
    await waitFor(() => expect(screen.queryByTestId('calendar-event-dialog')).not.toBeInTheDocument())
    await openEvent(user, 'calendar-event-1')
    expect(await screen.findByTestId('event-note-pick')).toBeInTheDocument()
    expect(screen.queryByTestId('event-note-card')).not.toBeInTheDocument()
  })
})

describe('회의록 줄 — 읽기 전용 상세(초대받은 일정)', () => {
  // 내 캘린더(id 1)에 없는 calendarId 라 초대받은 일정 — 상세 보기로 열린다
  const INVITED = calendarEvent({ id: 2, title: '초대받은 회의', calendarId: 99, myRole: 'ATTENDEE' })

  test('카드만 보이고 단추·X 가 없다', async () => {
    const { user } = await renderCalendar({ events: [INVITED], notes: { '2|': eventNote() } })
    await openEvent(user, 'calendar-event-2')
    const card = await screen.findByTestId('event-note-card')
    expect(card).toHaveTextContent('주간 회의록')
    expect(screen.getByTestId('event-note-open')).toBeInTheDocument()
    expect(screen.queryByTestId('event-note-pick')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '회의록 연결 해제' })).not.toBeInTheDocument()
  })

  test('연결이 없으면 「회의록」 줄이 없다', async () => {
    const { user, requests } = await renderCalendar({ events: [INVITED] })
    await openEvent(user, 'calendar-event-2')
    await screen.findByTestId('event-detail-view')
    await waitFor(() => expect(requests.noteGets.length).toBeGreaterThan(0))
    expect(screen.queryByTestId('event-note-row')).not.toBeInTheDocument()
  })

  test('볼 수 없는 노트도 「볼 수 없는 노트」만 보이고 X 는 없다', async () => {
    const { user } = await renderCalendar({ events: [INVITED], notes: { '2|': eventNoteRestricted() } })
    await openEvent(user, 'calendar-event-2')
    expect(await screen.findByTestId('event-note-card')).toHaveTextContent('볼 수 없는 노트')
    expect(screen.queryByRole('button', { name: '회의록 연결 해제' })).not.toBeInTheDocument()
  })
})

describe('회의록 줄 — 회차 없이 열린 반복 마스터(딥링크)', () => {
  const MASTER = calendarEvent({ id: 5, title: '주간 회의', recurrenceRule: 'FREQ=WEEKLY', occurrenceDate: null })

  test('편집 폼에 「회의록」 줄이 없고 노트도 조회하지 않는다', async () => {
    const { requests } = await renderCalendar({ detail: () => MASTER }, { path: '/calendar?eventId=5' })
    await screen.findByTestId('calendar-event-dialog')
    expect(screen.getByTestId('calendar-form-title')).toBeInTheDocument()
    expect(screen.queryByTestId('event-note-pick')).not.toBeInTheDocument()
    expect(screen.queryByTestId('event-note-row')).not.toBeInTheDocument()
    expect(requests.noteGets).toHaveLength(0)
  })

  test('읽기 전용 상세에도 줄이 없고 노트를 조회하지 않는다', async () => {
    const invited = calendarEvent({ ...MASTER, calendarId: 99, myRole: 'ATTENDEE' })
    const { requests } = await renderCalendar({ detail: () => invited }, { path: '/calendar?eventId=5' })
    await screen.findByTestId('event-detail-view')
    expect(screen.queryByTestId('event-note-row')).not.toBeInTheDocument()
    expect(requests.noteGets).toHaveLength(0)
  })
})

describe('새 일정 — 저장 뒤 잇기', () => {
  /** 새 일정 폼에서 제목을 넣고 노트 연결 창으로 첫 결과를 골라 닫는다. */
  async function pickNoteOnNewEvent(user: Parameters<typeof pickFirstNote>[0] & { paste: (t: string) => Promise<void> }) {
    await user.click(screen.getByTestId('calendar-new-event'))
    await screen.findByTestId('calendar-event-dialog')
    await user.click(screen.getByTestId('calendar-form-title'))
    await user.paste('킥오프')
    await user.click(await screen.findByTestId('event-note-pick'))
    expect(await screen.findByTestId('note-link-search')).toHaveValue('킥오프')
    await pickFirstNote(user)
  }

  test('노트를 고르면 카드에 「저장하면 연결」이 보이고, 저장하면 POST 뒤 만든 id 로 PUT 한다', async () => {
    const { user, requests } = await renderCalendar({}, { handlers: [wikiSearch] })
    await pickNoteOnNewEvent(user)
    expect(await screen.findByTestId('event-note-card')).toHaveTextContent('저장하면 연결')
    // 고르는 것만으로는 잇지 않는다
    expect(requests.notePuts).toHaveLength(0)

    await user.click(screen.getByTestId('calendar-form-submit'))
    await waitFor(() => expect(requests.notePuts).toHaveLength(1))
    expect(requests.posts).toHaveLength(1)
    expect(requests.notePuts[0].url.pathname).toBe('/api/v1/calendar/events/999/note')
    expect(requests.notePuts[0].body).toEqual({ pageId: 11 })
    expect(requests.notePuts[0].url.searchParams.has('occurrenceDate')).toBe(false)
  })

  test('고른 노트를 X 로 버리면 저장해도 잇지 않는다', async () => {
    const { user, requests } = await renderCalendar({}, { handlers: [wikiSearch] })
    await pickNoteOnNewEvent(user)
    await user.click(await screen.findByRole('button', { name: '회의록 연결 해제' }))
    expect(await screen.findByTestId('event-note-pick')).toBeInTheDocument()
    await user.click(screen.getByTestId('calendar-form-submit'))
    await waitFor(() => expect(requests.posts).toHaveLength(1))
    expect(requests.notePuts).toHaveLength(0)
  })

  test('노트를 고르고 취소하면 PUT 이 없다', async () => {
    const { user, requests } = await renderCalendar({}, { handlers: [wikiSearch] })
    await pickNoteOnNewEvent(user)
    await screen.findByTestId('event-note-card')
    await user.click(screen.getByRole('button', { name: '취소' }))
    await waitFor(() => expect(screen.queryByTestId('calendar-event-dialog')).not.toBeInTheDocument())
    expect(requests.posts).toHaveLength(0)
    expect(requests.notePuts).toHaveLength(0)
  })

  test('새 일정 저장 뒤 PUT 이 실패하면 「일정은 저장했지만 노트를 연결하지 못했습니다」 토스트', async () => {
    const failing = http.put('/api/v1/calendar/events/:id/note', () => HttpResponse.json({ message: '실패' }, { status: 500 }))
    const { user, requests } = await renderCalendar({}, { handlers: [failing, wikiSearch] })
    await pickNoteOnNewEvent(user)
    await user.click(screen.getByTestId('calendar-form-submit'))
    expect(await screen.findByText('일정은 저장했지만 노트를 연결하지 못했습니다')).toBeInTheDocument()
    // 일정은 그대로 저장됐다
    expect(requests.posts).toHaveLength(1)
  })

  test('반복 일정은 목록 조회로 펼친 실제 첫 회차(DTSTART 가 아닌)에 잇는다', async () => {
    // 월요일 시작인데 화·목 반복 — 서버는 DTSTART 를 회차로 내지 않으므로 첫 회차는 화요일이다
    const recurringPost = http.post('/api/v1/calendar/events', () =>
      HttpResponse.json(
        calendarEvent({ id: 999, title: '킥오프', recurrenceRule: 'FREQ=WEEKLY;BYDAY=TU,TH', startsAt: '2026-06-15T01:00:00Z' }),
        { status: 201 },
      ),
    )
    const occurrences = ['2026-06-18T01:00:00Z', '2026-06-16T01:00:00Z'].map((date) =>
      calendarEvent({ id: 999, masterEventId: 999, recurrenceRule: 'FREQ=WEEKLY;BYDAY=TU,TH', startsAt: date, occurrenceDate: date }),
    )
    let listed = false
    const recurringList = http.get('/api/v1/calendar/events', ({ request }) => {
      // 첫 회차를 찾는 조회(만든 일정의 startsAt 부터)만 회차를 돌려준다
      if (new URL(request.url).searchParams.get('from') === '2026-06-15T01:00:00.000Z' || new URL(request.url).searchParams.get('from') === '2026-06-15T01:00:00Z') {
        listed = true
        return HttpResponse.json(occurrences)
      }
      return HttpResponse.json([])
    })
    const { user, requests } = await renderCalendar({}, { handlers: [recurringPost, recurringList, wikiSearch] })
    await pickNoteOnNewEvent(user)
    await user.click(screen.getByTestId('calendar-form-submit'))
    await waitFor(() => expect(requests.notePuts).toHaveLength(1))
    expect(listed).toBe(true)
    expect(requests.notePuts[0].url.searchParams.get('occurrenceDate')).toBe('2026-06-16T01:00:00Z')
  })

  test('반복 일정인데 첫 회차를 못 찾으면 토스트', async () => {
    const recurringPost = http.post('/api/v1/calendar/events', () =>
      HttpResponse.json(calendarEvent({ id: 999, title: '킥오프', recurrenceRule: 'FREQ=WEEKLY' }), { status: 201 }),
    )
    const { user, requests } = await renderCalendar({}, { handlers: [recurringPost, wikiSearch] })
    await pickNoteOnNewEvent(user)
    await user.click(screen.getByTestId('calendar-form-submit'))
    expect(await screen.findByText('일정은 저장했지만 노트를 연결하지 못했습니다')).toBeInTheDocument()
    expect(requests.notePuts).toHaveLength(0)
  })
})

