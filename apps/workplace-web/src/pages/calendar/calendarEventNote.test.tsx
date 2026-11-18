// @vitest-environment jsdom
// 일정 회의록 노트 줄(WP-1701) — 「노트 연결」 → 고르기 → 카드, X 해제, 볼 수 없는 노트, 읽기 전용 상세, 반복 회차 쿼리,
// 새 일정의 저장 뒤 잇기(대기·취소·잇기 실패 토스트). CalendarPage 를 renderScreen 으로 띄우고 노트 API 는 calendarPageKit 의 목이 받는다.
// 「회의록 만들기」(WP-1702) — 창(제목·위치·틀), 만들기 → 틀 심기 → 잇기 순서, 위치 바꾸기·기억, 실패 처리, 새 일정의 저장 뒤 만들기.
// 390px 레이아웃은 e2e(calendar-event-note.spec.ts @layout)가 지킨다. 지금 = 2026-06-10 12:00 KST.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { fixClock, renderCalendar } from '@/test/kits/calendar/calendarPageKit'

import {
  attendee,
  calendarEvent,
  eventNote,
  eventNoteRestricted,
  noteSearchResult,
  recurringCalendarEvent,
} from '../../../e2e/factories/calendar.factory'
import { wikiPageDetail, wikiPageSummary, wikiSpace } from '../../../e2e/factories/wiki.factory'

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
  test('연결이 없으면 「회의록 만들기」 다음 「노트 연결」 단추가 보인다', async () => {
    const { user } = await renderCalendar({ events: [MEETING] })
    await openEvent(user, 'calendar-event-1')
    expect(await screen.findByTestId('event-note-pick')).toHaveTextContent('노트 연결')
    const create = screen.getByTestId('event-note-create')
    expect(create).toHaveTextContent('회의록 만들기')
    // 시안 순서 — 만들기가 앞
    expect(create.compareDocumentPosition(screen.getByTestId('event-note-pick')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
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

/** 처음 failTimes 번은 500, 그 뒤로는 기본 목(calendarPageKit)으로 흘려보내는 노트 GET(WP-1737). */
function failingNoteGet(failTimes: number) {
  let calls = 0
  return http.get('/api/v1/calendar/events/:id/note', () => {
    calls += 1
    if (calls <= failTimes) return HttpResponse.json({ message: '실패' }, { status: 500 })
    // 반환하지 않으면 다음 핸들러(기본 목)가 받는다
    return undefined
  })
}

/**
 * jsdom 은 레이아웃이 없어 모든 요소의 getClientRects 가 비어 「보이지 않음」이 된다 — LoadErrorState 는 보이는 요소에만 초점을 옮기므로,
 * 초점 옮기기를 확인하는 테스트에서만 회의록 줄 안의 요소를 보이는 것으로 둔다(afterEach 에서 되돌린다). 줄 밖까지 보이게 하면 달력 쪽
 * 측정이 바뀌어 다른 조회가 더 일어나므로 범위를 줄 안으로 좁힌다.
 */
function showNoteRowElements() {
  const original = Element.prototype.getClientRects
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
    if (this.closest('[data-testid="event-note-row"]')) return [new DOMRect(0, 0, 1, 1)] as unknown as DOMRectList
    return original.call(this)
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('회의록 줄 — 노트 조회 실패(WP-1737)', () => {

  test('500 이면 줄은 그리고 카드 자리에 오류 문구와 「다시 시도」가 보인다 — 「노트 연결」은 없다', async () => {
    const { user } = await renderCalendar({ events: [MEETING] }, { handlers: [failingNoteGet(Infinity)] })
    await openEvent(user, 'calendar-event-1')
    const error = await screen.findByTestId('event-note-error')
    expect(error).toHaveTextContent('회의록을 불러오지 못했습니다')
    expect(within(error).getByRole('button', { name: '다시 시도' })).toBeInTheDocument()
    expect(screen.getByTestId('event-note-row')).toBeInTheDocument()
    expect(screen.queryByTestId('event-note-pick')).not.toBeInTheDocument()
    expect(screen.queryByTestId('event-note-card')).not.toBeInTheDocument()
  })

  test('다시 시도가 성공하면 오류가 사라지고 카드가 보이며, 초점은 body 로 사라지지 않고 카드의 「열기」로 간다', async () => {
    showNoteRowElements()
    const { user, requests } = await renderCalendar(
      { events: [MEETING], notes: { '1|': eventNote() } },
      { handlers: [failingNoteGet(1)] },
    )
    await openEvent(user, 'calendar-event-1')
    await user.click(await screen.findByTestId('event-note-error-retry'))
    const card = await screen.findByTestId('event-note-card')
    expect(card).toHaveTextContent('주간 회의록')
    expect(screen.queryByTestId('event-note-error')).not.toBeInTheDocument()
    // 기본 목은 성공한 다시 부르기만 기록한다
    expect(requests.noteGets).toHaveLength(1)
    // LoadErrorState 의 초점 옮기기(WP-881) — 눌렀던 「다시 시도」가 사라져도 초점이 body 로 떨어지지 않는다
    await waitFor(() => expect(within(card).getByTestId('event-note-open')).toHaveFocus())
  })

  test('다시 시도가 성공했는데 연결이 없으면 「노트 연결」이 보인다', async () => {
    const { user } = await renderCalendar({ events: [MEETING] }, { handlers: [failingNoteGet(1)] })
    await openEvent(user, 'calendar-event-1')
    await user.click(await screen.findByTestId('event-note-error-retry'))
    expect(await screen.findByTestId('event-note-pick')).toHaveTextContent('노트 연결')
    expect(screen.queryByTestId('event-note-error')).not.toBeInTheDocument()
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

  test('노트 조회가 500 이면 줄을 숨기지 않고 오류·「다시 시도」를 보이고, 다시 시도가 성공하면 카드로 바뀐다(WP-1737)', async () => {
    const { user, requests } = await renderCalendar(
      { events: [INVITED], notes: { '2|': eventNote() } },
      { handlers: [failingNoteGet(1)] },
    )
    await openEvent(user, 'calendar-event-2')
    await screen.findByTestId('event-detail-view')
    const error = await screen.findByTestId('event-note-error')
    expect(error).toHaveTextContent('회의록을 불러오지 못했습니다')
    expect(screen.getByTestId('event-note-row')).toBeInTheDocument()
    expect(screen.queryByTestId('event-note-card')).not.toBeInTheDocument()

    await user.click(within(error).getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByTestId('event-note-card')).toHaveTextContent('주간 회의록')
    expect(screen.queryByTestId('event-note-error')).not.toBeInTheDocument()
    // 읽기 전용이라 단추·X 는 여전히 없다
    expect(screen.queryByTestId('event-note-pick')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '회의록 연결 해제' })).not.toBeInTheDocument()
    expect(requests.noteGets).toHaveLength(1)
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

// ────────────────────────────────────────────────────────────
// 「회의록 만들기」(WP-1702)
// ────────────────────────────────────────────────────────────

/** 내 공간(id 1, 나=Tester id 1 소유) · 기획팀 공간(id 3, 편집자) · 보기 전용 공간(id 5) */
const SPACES = [
  wikiSpace({ id: 1, type: 'PERSONAL', name: '내 노트', ownerId: 1, role: 'OWNER' }),
  wikiSpace({ id: 3, type: 'TEAM', name: '기획팀 공간', ownerId: 2, role: 'EDITOR' }),
  wikiSpace({ id: 5, type: 'TEAM', name: '보기 공간', ownerId: 2, role: 'VIEWER' }),
]

/**
 * 위키 목 — 공간 목록·트리·노트 만들기(POST)·본문 심기(PUT)를 받고, 만들기·심기·잇기 순서를 order 에 남긴다.
 * 잇기(PUT /note)는 순서만 적고 응답은 calendarPageKit 의 목에 넘긴다(리졸버가 아무것도 돌려주지 않으면 다음 핸들러로).
 */
function wikiMock(
  opts: { createStatus?: number; seedStatus?: number; linkStatus?: number; spacesFailures?: number } = {},
) {
  const order: string[] = []
  // 공간 목록이 처음 이만큼 실패한다(다시 시도 검사용)
  let spacesFailures = opts.spacesFailures ?? 0
  const creates: { spaceId: number; body: { parentId: number | null; title: string } }[] = []
  const seeds: { pageId: number; body: { title: null; body: string; version: number } }[] = []
  const handlers = [
    http.get('/api/v1/wiki/spaces', () => {
      if (spacesFailures > 0) {
        spacesFailures--
        return HttpResponse.json({ message: '실패' }, { status: 500 })
      }
      return HttpResponse.json(SPACES)
    }),
    http.get('/api/v1/wiki/spaces/:id/pages', ({ params }) =>
      HttpResponse.json(
        Number(params.id) === 3
          ? [
              wikiPageSummary({ id: 30, parentId: null, title: '회의록', position: 0 }),
              // AI 가 쓴 리포트 페이지 — 리포트 위치 창은 빼지만 회의록 위치 창은 보인다
              wikiPageSummary({ id: 31, parentId: null, title: 'AI 주간 리포트', position: 1, aiLastAction: 'report' }),
            ]
          : [],
      ),
    ),
    http.post('/api/v1/wiki/spaces/:id/pages', async ({ params, request }) => {
      const body = (await request.json()) as { parentId: number | null; title: string }
      creates.push({ spaceId: Number(params.id), body })
      order.push('create')
      if (opts.createStatus) return HttpResponse.json({ message: '노트를 만들 수 없습니다' }, { status: opts.createStatus })
      return HttpResponse.json(
        wikiPageDetail({ id: 60, spaceId: Number(params.id), parentId: body.parentId, title: body.title, version: 4 }),
      )
    }),
    http.put('/api/v1/wiki/pages/:id', async ({ params, request }) => {
      seeds.push({ pageId: Number(params.id), body: (await request.json()) as never })
      order.push('seed')
      if (opts.seedStatus) return HttpResponse.json({ message: '실패' }, { status: opts.seedStatus })
      return HttpResponse.json(wikiPageDetail({ id: Number(params.id), version: 5 }))
    }),
    http.put('/api/v1/calendar/events/:id/note', () => {
      order.push('link')
      if (opts.linkStatus) return HttpResponse.json({ message: '실패' }, { status: opts.linkStatus })
      return undefined
    }),
  ]
  return { order, creates, seeds, handlers }
}

/** 장소·참석자가 있는 내 일정 — 상세 응답에 참석자가 실린다(나 = 주최자). */
const PLANNING = calendarEvent({
  id: 1,
  title: '주간 기획 회의',
  location: '3층 회의실',
  myRole: 'ORGANIZER',
  attendees: [attendee('ORGANIZER', 1, { name: 'Tester' }), attendee('ATTENDEE', 2, { name: '김민수' })],
})

/** 일정 창의 「회의록 만들기」를 눌러 창이 열리고 위치가 풀릴 때까지 기다린다. */
async function openCreate(user: { click: (el: Element) => Promise<void> }) {
  await user.click(await screen.findByTestId('event-note-create'))
  const dialog = await screen.findByTestId('meeting-note-dialog')
  await waitFor(() => expect(within(dialog).getByTestId('meeting-note-location')).not.toHaveTextContent('불러오는 중'))
  return dialog
}

describe('회의록 만들기 — 기존 일정', () => {
  test('창: 제목이 채워져 전체 선택되고, 위치는 내 공간, 틀에 일시·장소·참석이 보인다', async () => {
    const wiki = wikiMock()
    const { user } = await renderCalendar({ events: [PLANNING] }, { handlers: wiki.handlers })
    await openEvent(user, 'calendar-event-1')
    // 참석자 상세가 와야 틀에 참석이 실린다
    await screen.findByText('김민수')
    const dialog = await openCreate(user)

    const title = within(dialog).getByTestId('meeting-note-title') as HTMLInputElement
    expect(title).toHaveValue('6/10 주간 기획 회의 회의록')
    await waitFor(() => expect(title).toHaveFocus())
    expect([title.selectionStart, title.selectionEnd]).toEqual([0, title.value.length])

    expect(within(dialog).getByTestId('meeting-note-location')).toHaveTextContent('내 노트')
    expect(within(dialog).getByText('내 공간')).toBeInTheDocument()
    const lines = within(within(dialog).getByTestId('meeting-note-template'))
      .getAllByRole('listitem')
      .map((li) => li.textContent)
    expect(lines).toEqual([
      '일시 · 6월 10일 (수) 10:00–11:00',
      '장소 · 3층 회의실',
      '참석 · Tester, 김민수',
      '안건',
      '결정',
      '할 일',
    ])
  })

  test('「만들기」 → 노트 POST → 틀 PUT → 잇기 PUT 순서, 카드·토스트, 일정 창은 열린 채, 위치를 기억한다', async () => {
    const wiki = wikiMock()
    const { user, requests } = await renderCalendar({ events: [PLANNING] }, { handlers: wiki.handlers })
    await openEvent(user, 'calendar-event-1')
    await screen.findByText('김민수')
    const dialog = await openCreate(user)
    await user.click(within(dialog).getByTestId('meeting-note-submit'))

    await waitFor(() => expect(requests.notePuts).toHaveLength(1))
    expect(wiki.order).toEqual(['create', 'seed', 'link'])
    expect(wiki.creates).toEqual([{ spaceId: 1, body: { parentId: null, title: '6/10 주간 기획 회의 회의록' } }])
    expect(wiki.seeds[0].pageId).toBe(60)
    // 만든 응답의 version 을 기준으로 심는다
    expect(wiki.seeds[0].body).toEqual({
      title: null,
      version: 4,
      body: [
        '- 일시: 6월 10일 (수) 10:00–11:00',
        '- 장소: 3층 회의실',
        '- 참석: Tester, 김민수',
        '',
        '## 안건',
        '',
        '## 결정',
        '',
        '## 할 일',
        '',
      ].join('\n'),
    })
    expect(requests.notePuts[0].body).toEqual({ pageId: 60 })
    expect(requests.notePuts[0].url.pathname).toBe('/api/v1/calendar/events/1/note')

    expect(await screen.findByTestId('event-note-card')).toBeInTheDocument()
    expect(await screen.findByText('회의록 만듦')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '열기' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId('meeting-note-dialog')).not.toBeInTheDocument())
    expect(screen.getByTestId('calendar-event-dialog')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('calendar.meetingNoteLocation:1:1') ?? 'null')).toEqual({ spaceId: 1, parentId: null })
  })

  test('「바꾸기」로 다른 공간의 상위 노트를 고르면 그 아래에 만들고, 다음에 열면 그 자리가 「지난번 회의록 위치」다', async () => {
    const wiki = wikiMock()
    const { user } = await renderCalendar({ events: [MEETING] }, { handlers: wiki.handlers })
    await openEvent(user, 'calendar-event-1')
    const dialog = await openCreate(user)

    await user.click(within(dialog).getByTestId('meeting-note-location-change'))
    const picker = await screen.findByTestId('report-location-dialog')
    expect(within(picker).getByRole('heading', { name: '회의록 위치' })).toBeInTheDocument()
    // 공간 고르기에는 쓸 수 있는 공간만(보기 공간 없음)
    fireEvent.keyDown(within(picker).getByRole('combobox', { name: '공간' }), { key: 'Enter' })
    expect(screen.queryByRole('option', { name: '보기 공간' })).not.toBeInTheDocument()
    await user.click(await screen.findByRole('option', { name: '기획팀 공간' }))
    await user.click(await within(picker).findByRole('option', { name: /^회의록/ }))
    expect(within(picker).getByRole('option', { name: 'AI 주간 리포트' })).toBeInTheDocument()
    await user.click(within(picker).getByRole('button', { name: '고르기' }))

    await waitFor(() => expect(screen.queryByTestId('report-location-dialog')).not.toBeInTheDocument())
    expect(within(dialog).getByTestId('meeting-note-location')).toHaveTextContent('기획팀 공간 › 회의록')
    expect(within(dialog).queryByText('내 공간')).not.toBeInTheDocument()
    // 고르기만 해서는 기억하지 않는다
    expect(localStorage.getItem('calendar.meetingNoteLocation:1:1')).toBeNull()

    await user.click(within(dialog).getByTestId('meeting-note-submit'))
    await waitFor(() => expect(wiki.creates).toHaveLength(1))
    expect(wiki.creates[0]).toEqual({ spaceId: 3, body: { parentId: 30, title: '6/10 팀 회의 회의록' } })
    await screen.findByTestId('event-note-card')

    // 연결을 풀고 다시 열면 기억한 자리로 시작한다
    await user.click(screen.getByRole('button', { name: '회의록 연결 해제' }))
    const again = await openCreate(user)
    await waitFor(() => expect(within(again).getByTestId('meeting-note-location')).toHaveTextContent('기획팀 공간 › 회의록'))
    expect(within(again).getByText('지난번 회의록 위치')).toBeInTheDocument()
  })

  test('고치던(저장 안 한) 제목·장소가 아니라 저장된 일정 값으로 제목·틀을 만든다 — 노트는 바로 잇기 때문', async () => {
    const wiki = wikiMock()
    const { user } = await renderCalendar({ events: [PLANNING] }, { handlers: wiki.handlers })
    await openEvent(user, 'calendar-event-1')
    await screen.findByText('김민수')
    fireEvent.change(screen.getByTestId('calendar-form-title'), { target: { value: '아직 저장 안 한 제목' } })
    fireEvent.change(screen.getByTestId('calendar-form-location'), { target: { value: '저장 안 한 장소' } })
    fireEvent.change(screen.getByTestId('calendar-form-start'), { target: { value: '2026-06-12T15:00' } })
    fireEvent.change(screen.getByTestId('calendar-form-end'), { target: { value: '2026-06-12T16:00' } })
    const dialog = await openCreate(user)
    expect(within(dialog).getByTestId('meeting-note-title')).toHaveValue('6/10 주간 기획 회의 회의록')
    const template = within(dialog).getByTestId('meeting-note-template')
    expect(template).toHaveTextContent('일시 · 6월 10일 (수) 10:00–11:00')
    expect(template).toHaveTextContent('장소 · 3층 회의실')
    expect(template).not.toHaveTextContent('저장 안 한')
  })

  test('이름이 같은 다른 참석자는 둘 다 틀에 들어간다', async () => {
    const twins = calendarEvent({
      ...PLANNING,
      attendees: [
        attendee('ORGANIZER', 1, { name: 'Tester' }),
        attendee('ATTENDEE', 2, { name: '김민수' }),
        attendee('ATTENDEE', 3, { name: '김민수' }),
      ],
    })
    const wiki = wikiMock()
    const { user } = await renderCalendar({ events: [twins] }, { handlers: wiki.handlers })
    await openEvent(user, 'calendar-event-1')
    await screen.findAllByText('김민수')
    const dialog = await openCreate(user)
    expect(within(dialog).getByTestId('meeting-note-template')).toHaveTextContent('참석 · Tester, 김민수, 김민수')
  })

  test('공간 목록을 못 읽으면 오류와 「다시 시도」, 다시 시도해 읽히면 위치가 보인다', async () => {
    const wiki = wikiMock({ spacesFailures: 1 })
    const { user } = await renderCalendar({ events: [MEETING] }, { handlers: wiki.handlers })
    await openEvent(user, 'calendar-event-1')
    await user.click(await screen.findByTestId('event-note-create'))
    const dialog = await screen.findByTestId('meeting-note-dialog')
    expect(await within(dialog).findByText('공간 목록을 불러오지 못했습니다')).toBeInTheDocument()
    expect(within(dialog).queryByText('노트를 만들 수 있는 공간이 없습니다')).not.toBeInTheDocument()
    expect(within(dialog).getByTestId('meeting-note-submit')).toBeDisabled()
    await user.click(within(dialog).getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(within(dialog).getByTestId('meeting-note-location')).toHaveTextContent('내 노트'))
    expect(within(dialog).getByTestId('meeting-note-submit')).toBeEnabled()
  })

  test('기억한 위치의 공간이 목록에 없으면(나감) 내 공간 최상위로 연다', async () => {
    localStorage.setItem('calendar.meetingNoteLocation:1:1', JSON.stringify({ spaceId: 42, parentId: 7 }))
    const wiki = wikiMock()
    const { user } = await renderCalendar({ events: [MEETING] }, { handlers: wiki.handlers })
    await openEvent(user, 'calendar-event-1')
    const dialog = await openCreate(user)
    expect(within(dialog).getByTestId('meeting-note-location')).toHaveTextContent('내 노트')
    expect(within(dialog).getByText('내 공간')).toBeInTheDocument()
  })

  test('제목을 비우면 「만들기」가 잠긴다', async () => {
    const wiki = wikiMock()
    const { user } = await renderCalendar({ events: [MEETING] }, { handlers: wiki.handlers })
    await openEvent(user, 'calendar-event-1')
    const dialog = await openCreate(user)
    fireEvent.change(within(dialog).getByTestId('meeting-note-title'), { target: { value: '   ' } })
    expect(within(dialog).getByTestId('meeting-note-submit')).toBeDisabled()
  })

  test('만들기가 실패하면 창 안에 오류가 보이고 창은 열린 채, 잇지 않는다', async () => {
    const wiki = wikiMock({ createStatus: 500 })
    const { user, requests } = await renderCalendar({ events: [MEETING] }, { handlers: wiki.handlers })
    await openEvent(user, 'calendar-event-1')
    const dialog = await openCreate(user)
    await user.click(within(dialog).getByTestId('meeting-note-submit'))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('노트를 만들 수 없습니다')
    expect(screen.getByTestId('meeting-note-dialog')).toBeInTheDocument()
    expect(requests.notePuts).toHaveLength(0)
    expect(localStorage.getItem('calendar.meetingNoteLocation:1:1')).toBeNull()
  })

  test('잇기만 실패하면 창을 닫고 「노트는 만들었지만 연결하지 못함」 토스트, 줄은 비어 있다', async () => {
    const wiki = wikiMock({ linkStatus: 500 })
    const { user } = await renderCalendar({ events: [MEETING] }, { handlers: wiki.handlers })
    await openEvent(user, 'calendar-event-1')
    const dialog = await openCreate(user)
    await user.click(within(dialog).getByTestId('meeting-note-submit'))
    expect(await screen.findByText('노트는 만들었지만 연결하지 못함')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId('meeting-note-dialog')).not.toBeInTheDocument())
    expect(screen.getByTestId('event-note-create')).toBeInTheDocument()
    expect(screen.queryByTestId('event-note-card')).not.toBeInTheDocument()
    expect(wiki.creates).toHaveLength(1)
  })

  test('틀 심기만 실패하면 경고하고 빈 노트로 계속 잇는다', async () => {
    const wiki = wikiMock({ seedStatus: 500 })
    const { user, requests } = await renderCalendar({ events: [MEETING] }, { handlers: wiki.handlers })
    await openEvent(user, 'calendar-event-1')
    const dialog = await openCreate(user)
    await user.click(within(dialog).getByTestId('meeting-note-submit'))
    await waitFor(() => expect(requests.notePuts).toHaveLength(1))
    expect(await screen.findByText('회의록 틀을 넣지 못했습니다')).toBeInTheDocument()
    expect(await screen.findByTestId('event-note-card')).toBeInTheDocument()
  })

  test('「만들기」를 같은 틱에 두 번 눌러도 노트는 하나', async () => {
    const wiki = wikiMock()
    const { user, requests } = await renderCalendar({ events: [MEETING] }, { handlers: wiki.handlers })
    await openEvent(user, 'calendar-event-1')
    const dialog = await openCreate(user)
    const submit = within(dialog).getByTestId('meeting-note-submit')
    act(() => {
      submit.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      submit.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await waitFor(() => expect(requests.notePuts).toHaveLength(1))
    expect(wiki.creates).toHaveLength(1)
  })

  test('반복 회차에서 만들면 제목 날짜가 그 회차, 잇기는 그 회차(occurrenceDate)', async () => {
    const occ = ['2026-06-08T01:00:00Z', '2026-06-15T01:00:00Z']
    const wiki = wikiMock()
    const { user, requests } = await renderCalendar({ events: recurringCalendarEvent(5, occ) }, { handlers: wiki.handlers })
    await openEvent(user, `calendar-event-5-${occ[1]}`)
    const dialog = await openCreate(user)
    expect(within(dialog).getByTestId('meeting-note-title')).toHaveValue('6/15 팀 회의 회의록')
    await user.click(within(dialog).getByTestId('meeting-note-submit'))
    await waitFor(() => expect(requests.notePuts).toHaveLength(1))
    expect(requests.notePuts[0].url.searchParams.get('occurrenceDate')).toBe(occ[1])
  })

  test('노트 연결 창에서 결과가 없으면 「회의록 만들기」로 이 창을 닫고 만들기 창을 연다', async () => {
    const empty = http.get('/api/v1/wiki/search', () => HttpResponse.json([]))
    const wiki = wikiMock()
    const { user } = await renderCalendar({ events: [MEETING] }, { handlers: [empty, ...wiki.handlers] })
    await openEvent(user, 'calendar-event-1')
    await user.click(await screen.findByTestId('event-note-pick'))
    const results = await screen.findByTestId('note-link-results')
    await within(results).findByText('검색 결과 없음')
    await user.click(within(results).getByRole('button', { name: '회의록 만들기' }))
    expect(await screen.findByTestId('meeting-note-dialog')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId('note-link-dialog')).not.toBeInTheDocument())
    expect(screen.getByTestId('meeting-note-title')).toHaveValue('6/10 팀 회의 회의록')
  })
})

describe('회의록 만들기 — 상세를 읽기 전(WP-1748)', () => {
  /** 상세 조회(GET /events/:id)를 붙잡아 두는 목 — release() 전까지 응답하지 않는다. 목록 일정엔 참석자가 없다. */
  function heldDetail(detail: typeof PLANNING) {
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    return {
      release,
      detail: async () => {
        await gate
        return detail
      },
    }
  }
  /** 목록 응답의 일정 — 참석자는 상세에만 실린다(실제 API 와 같다) */
  const LISTED = calendarEvent({ id: 1, title: '주간 기획 회의', location: '3층 회의실', myRole: 'ORGANIZER' })

  test('상세를 읽는 중엔 「회의록 만들기」가 잠기고, 상세가 오면 풀려 만든 노트에 「참석」 줄이 있다', async () => {
    const held = heldDetail(PLANNING)
    const wiki = wikiMock()
    const { user } = await renderCalendar({ events: [LISTED], detail: held.detail }, { handlers: wiki.handlers })
    await openEvent(user, 'calendar-event-1')
    expect(await screen.findByTestId('event-note-create')).toBeDisabled()

    held.release()
    await waitFor(() => expect(screen.getByTestId('event-note-create')).toBeEnabled())
    const dialog = await openCreate(user)
    expect(within(dialog).getByTestId('meeting-note-template')).toHaveTextContent('참석 · Tester, 김민수')
    await user.click(within(dialog).getByTestId('meeting-note-submit'))
    await waitFor(() => expect(wiki.seeds).toHaveLength(1))
    expect(wiki.seeds[0].body.body).toContain('- 참석: Tester, 김민수')
  })

  test('노트 연결 창의 결과 없음 「회의록 만들기」도 상세를 읽는 중엔 잠긴다', async () => {
    const empty = http.get('/api/v1/wiki/search', () => HttpResponse.json([]))
    const held = heldDetail(PLANNING)
    const wiki = wikiMock()
    const { user } = await renderCalendar(
      { events: [LISTED], detail: held.detail },
      { handlers: [empty, ...wiki.handlers] },
    )
    await openEvent(user, 'calendar-event-1')
    await user.click(await screen.findByTestId('event-note-pick'))
    const results = await screen.findByTestId('note-link-results')
    await within(results).findByText('검색 결과 없음')
    expect(within(results).getByRole('button', { name: '회의록 만들기' })).toBeDisabled()

    held.release()
    await waitFor(() => expect(within(results).getByRole('button', { name: '회의록 만들기' })).toBeEnabled())
    await user.click(within(results).getByRole('button', { name: '회의록 만들기' }))
    const dialog = await screen.findByTestId('meeting-note-dialog')
    expect(within(dialog).getByTestId('meeting-note-template')).toHaveTextContent('참석 · Tester, 김민수')
  })

  test('상세 조회가 실패(500)하면 잠그지 않는다 — 참석자 없이 만들 수 있다', async () => {
    const failed = http.get('/api/v1/calendar/events/:id', () => HttpResponse.json({ message: '실패' }, { status: 500 }))
    const wiki = wikiMock()
    const { user } = await renderCalendar({ events: [LISTED] }, { handlers: [failed, ...wiki.handlers] })
    await openEvent(user, 'calendar-event-1')
    await waitFor(() => expect(screen.getByTestId('event-note-create')).toBeEnabled())
    const dialog = await openCreate(user)
    expect(within(dialog).getByTestId('meeting-note-template')).not.toHaveTextContent('참석 ·')
    await user.click(within(dialog).getByTestId('meeting-note-submit'))
    await waitFor(() => expect(wiki.seeds).toHaveLength(1))
  })
})

describe('회의록 만들기 — 새 일정', () => {
  /** 새 일정 폼에 제목을 넣고 「회의록 만들기」 창에서 「만들기」까지 누른다. */
  async function createOnNewEvent(user: Parameters<typeof openCreate>[0] & { paste: (t: string) => Promise<void> }) {
    await user.click(screen.getByTestId('calendar-new-event'))
    await screen.findByTestId('calendar-event-dialog')
    await user.click(screen.getByTestId('calendar-form-title'))
    await user.paste('킥오프')
    const dialog = await openCreate(user)
    expect(within(dialog).getByTestId('meeting-note-title')).toHaveValue('6/10 킥오프 회의록')
    await user.click(within(dialog).getByTestId('meeting-note-submit'))
    await waitFor(() => expect(screen.queryByTestId('meeting-note-dialog')).not.toBeInTheDocument())
  }

  test('만들기는 서버를 부르지 않고 카드에 「저장하면 만듦」, 일정 창을 취소하면 아무것도 만들지 않는다', async () => {
    const wiki = wikiMock()
    const { user, requests } = await renderCalendar({}, { handlers: wiki.handlers })
    await createOnNewEvent(user)
    const card = await screen.findByTestId('event-note-card')
    expect(card).toHaveTextContent('6/10 킥오프 회의록')
    expect(card).toHaveTextContent('내 노트 · 저장하면 만듦')
    expect(wiki.creates).toHaveLength(0)
    // 아직 노트가 없으니 위치도 기억하지 않는다 — 저장해 만든 뒤에 기억한다
    expect(localStorage.getItem('calendar.meetingNoteLocation:1:1')).toBeNull()

    await user.click(screen.getByRole('button', { name: '취소' }))
    await waitFor(() => expect(screen.queryByTestId('calendar-event-dialog')).not.toBeInTheDocument())
    expect(requests.posts).toHaveLength(0)
    expect(wiki.creates).toHaveLength(0)
  })

  test('X 로 버리면 저장해도 만들지 않는다', async () => {
    const wiki = wikiMock()
    const { user, requests } = await renderCalendar({}, { handlers: wiki.handlers })
    await createOnNewEvent(user)
    await user.click(await screen.findByRole('button', { name: '회의록 연결 해제' }))
    expect(await screen.findByTestId('event-note-create')).toBeInTheDocument()
    await user.click(screen.getByTestId('calendar-form-submit'))
    await waitFor(() => expect(requests.posts).toHaveLength(1))
    expect(wiki.creates).toHaveLength(0)
  })

  test('저장하면 일정 POST 뒤 노트를 만들고(틀은 저장 순간의 폼 값) 만든 일정에 잇는다', async () => {
    const wiki = wikiMock()
    const { user, requests } = await renderCalendar({}, { handlers: wiki.handlers })
    await createOnNewEvent(user)
    // 창을 닫은 뒤 장소를 넣었다 — 틀은 저장할 때의 값으로 만든다
    await user.click(screen.getByTestId('calendar-form-location'))
    await user.paste('2층 라운지')
    await user.click(screen.getByTestId('calendar-form-submit'))

    await waitFor(() => expect(requests.notePuts).toHaveLength(1))
    expect(requests.posts).toHaveLength(1)
    expect(wiki.order).toEqual(['create', 'seed', 'link'])
    expect(wiki.creates).toEqual([{ spaceId: 1, body: { parentId: null, title: '6/10 킥오프 회의록' } }])
    expect(wiki.seeds[0].body.body).toContain('- 장소: 2층 라운지')
    expect(wiki.seeds[0].body.body).toContain('- 참석: Tester')
    expect(requests.notePuts[0].url.pathname).toBe('/api/v1/calendar/events/999/note')
    expect(requests.notePuts[0].body).toEqual({ pageId: 60 })
    expect(await screen.findByText('회의록 만듦')).toBeInTheDocument()
    // 노트를 만든 뒤에야 위치를 기억한다
    expect(JSON.parse(localStorage.getItem('calendar.meetingNoteLocation:1:1') ?? 'null')).toEqual({ spaceId: 1, parentId: null })
  })

  test('창을 연 뒤 날짜·제목을 고치면 카드와 만든 노트의 제목이 저장 순간의 값을 따른다', async () => {
    const wiki = wikiMock()
    const { user } = await renderCalendar({}, { handlers: wiki.handlers })
    await createOnNewEvent(user)
    fireEvent.change(screen.getByTestId('calendar-form-start'), { target: { value: '2026-06-12T10:00' } })
    fireEvent.change(screen.getByTestId('calendar-form-end'), { target: { value: '2026-06-12T11:00' } })
    fireEvent.change(screen.getByTestId('calendar-form-title'), { target: { value: '킥오프 미팅' } })
    expect(await screen.findByTestId('event-note-card')).toHaveTextContent('6/12 킥오프 미팅 회의록')
    await user.click(screen.getByTestId('calendar-form-submit'))
    await waitFor(() => expect(wiki.creates).toHaveLength(1))
    expect(wiki.creates[0].body.title).toBe('6/12 킥오프 미팅 회의록')
    await waitFor(() => expect(wiki.seeds).toHaveLength(1))
    expect(wiki.seeds[0].body.body).toContain('- 일시: 6월 12일 (금) 10:00–11:00')
  })

  test('창에서 제목을 직접 고쳤으면 날짜·일정 제목을 바꿔도 그 제목을 지킨다', async () => {
    const wiki = wikiMock()
    const { user } = await renderCalendar({}, { handlers: wiki.handlers })
    await user.click(screen.getByTestId('calendar-new-event'))
    await screen.findByTestId('calendar-event-dialog')
    await user.click(screen.getByTestId('calendar-form-title'))
    await user.paste('킥오프')
    const dialog = await openCreate(user)
    fireEvent.change(within(dialog).getByTestId('meeting-note-title'), { target: { value: '킥오프 메모' } })
    await user.click(within(dialog).getByTestId('meeting-note-submit'))
    await waitFor(() => expect(screen.queryByTestId('meeting-note-dialog')).not.toBeInTheDocument())
    fireEvent.change(screen.getByTestId('calendar-form-start'), { target: { value: '2026-06-12T10:00' } })
    fireEvent.change(screen.getByTestId('calendar-form-end'), { target: { value: '2026-06-12T11:00' } })
    expect(screen.getByTestId('event-note-card')).toHaveTextContent('킥오프 메모')
    await user.click(screen.getByTestId('calendar-form-submit'))
    await waitFor(() => expect(wiki.creates).toHaveLength(1))
    expect(wiki.creates[0].body.title).toBe('킥오프 메모')
  })

  test('저장 뒤 노트 만들기가 실패하면 「일정은 저장했지만 회의록을 만들지 못했습니다」', async () => {
    const wiki = wikiMock({ createStatus: 500 })
    const { user, requests } = await renderCalendar({}, { handlers: wiki.handlers })
    await createOnNewEvent(user)
    await user.click(screen.getByTestId('calendar-form-submit'))
    expect(await screen.findByText('일정은 저장했지만 회의록을 만들지 못했습니다')).toBeInTheDocument()
    expect(requests.posts).toHaveLength(1)
    expect(requests.notePuts).toHaveLength(0)
  })

  test('저장 뒤 잇기만 실패하면 「노트는 만들었지만 연결하지 못함」', async () => {
    const wiki = wikiMock({ linkStatus: 500 })
    const { user } = await renderCalendar({}, { handlers: wiki.handlers })
    await createOnNewEvent(user)
    await user.click(screen.getByTestId('calendar-form-submit'))
    expect(await screen.findByText('노트는 만들었지만 연결하지 못함')).toBeInTheDocument()
    expect(wiki.creates).toHaveLength(1)
  })

  test('노트를 고른 뒤 회의록을 만들면 고른 노트는 버려진다(하나만)', async () => {
    const wiki = wikiMock()
    const { user, requests } = await renderCalendar({}, { handlers: [wikiSearch, ...wiki.handlers] })
    await user.click(screen.getByTestId('calendar-new-event'))
    await screen.findByTestId('calendar-event-dialog')
    await user.click(screen.getByTestId('calendar-form-title'))
    await user.paste('킥오프')
    await user.click(await screen.findByTestId('event-note-pick'))
    await pickFirstNote(user)
    expect(await screen.findByTestId('event-note-card')).toHaveTextContent('저장하면 연결')
    // 카드가 있으면 단추가 없다 — X 로 풀지 않고는 만들 수 없으니, 고른 노트를 버리고 만든다
    await user.click(screen.getByRole('button', { name: '회의록 연결 해제' }))
    const dialog = await openCreate(user)
    await user.click(within(dialog).getByTestId('meeting-note-submit'))
    expect(await screen.findByTestId('event-note-card')).toHaveTextContent('저장하면 만듦')
    await user.click(screen.getByTestId('calendar-form-submit'))
    await waitFor(() => expect(requests.notePuts).toHaveLength(1))
    expect(requests.notePuts[0].body).toEqual({ pageId: 60 })
  })
})

