// 모바일 캘린더 일정 목록(WP-136) — 페이지 테스트(WP-981).
// 초대받은 일정 표기·상세 보기, 이슈 마감 행과 이동, 진행 중(여러 날) 일정 묶음·순서, 월 보기에서 옮긴 달로 목록 시작,
// 이슈 마감 조회 실패의 다시 시도 줄은 요청 범위·문구·조건부 렌더라 e2e/pages/mobile/calendar-agenda.spec.ts 에서 옮겼다.
// 스크롤로 이어 불러오기(빈 90일 자동 멈춤 포함 — 끝 센티널 교차가 필요)·헤더 월 따라가기·스와이프·기하·포커스·시간 흐름은 그 E2E 가 지킨다.
// 오늘 = 2026-10-13(화) 08:40 KST 고정(vitest 는 TZ=Asia/Seoul). 일정 API 는 요청 범위(from/to)와 겹치는 일정만 돌려준다.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterAll, beforeAll, expect, test, vi } from 'vitest'

import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import { mockViewport } from '@/test/viewport'
import type { CalendarEvent } from '@/types/calendar'
import type { IssueResponse } from '@/types/issue'

import { calendar, calendarEvent } from '../../../e2e/factories/calendar.factory'
import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { createProject } from '../../../e2e/factories/project.factory'

mockViewport()
// jsdom 에는 요소 scrollTo 가 없다 — 세대가 바뀔 때 목록을 맨 위로 올리는 호출(스크롤 위치는 E2E @layout 이 본다).
if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {}

const NOW = new Date('2026-10-12T23:40:00Z') // 2026-10-13 08:40 KST
// 시계만 고정한다(타이머는 실제) — MSW·RTL 대기는 그대로 돈다.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterAll(() => vi.useRealTimers())

const TEAM = 2
const kst = (date: string, hm: string) => new Date(`${date}T${hm}:00+09:00`).toISOString()

function baseEvents(): CalendarEvent[] {
  const ev = (id: number, title: string, date: string, start: string, end: string, over: Partial<CalendarEvent> = {}) =>
    calendarEvent({ id, title, startsAt: kst(date, start), endsAt: kst(date, end), ...over })
  const team = { calendarId: TEAM, calendarName: '팀 일정', effectiveColor: 'green' }
  return [
    ev(1, '아침 스탠드업', '2026-10-13', '07:00', '07:30', team),
    ev(2, '주간 스프린트 회의', '2026-10-13', '09:30', '10:30', team),
    ev(3, '고객사 데모 리허설', '2026-10-13', '14:00', '15:30', { location: '3층 회의실' }),
    calendarEvent({ id: 4, title: '모바일 에픽 마감 주간', allDay: true, startsAt: '2026-10-14T00:00:00Z', endsAt: '2026-10-15T00:00:00Z', ...team }),
    ev(5, '모바일 캘린더 시안 리뷰', '2026-10-15', '11:00', '12:00'),
    ev(301, '12월 초 점검', '2026-12-05', '10:00', '11:00'),
  ]
}

const DUE_ISSUE = createIssue({ id: 7, projectKey: 'WP', number: 136, title: 'WP-136 모바일 캘린더 일정 목록', status: 'IN_PROGRESS', dueDate: '2026-10-14' })

/** 캘린더·일정·이슈 마감 응답. requests 에 일정 목록 요청 범위를 모은다. failDues() 가 참이면 마감 조회는 500. */
function stubCalendar(opts: { events?: CalendarEvent[]; issues?: IssueResponse[]; failDues?: () => boolean } = {}) {
  const events = opts.events ?? baseEvents()
  const issues = opts.issues ?? [DUE_ISSUE]
  const requests: { from: string; to: string }[] = []
  const handlers = [
    http.get('/api/v1/calendars', () =>
      HttpResponse.json([calendar({ id: 1, name: '기본' }), calendar({ id: TEAM, name: '팀 일정', color: 'green', isDefault: false, position: 1 })]),
    ),
    http.get('/api/v1/calendar/events/:id', ({ params }) => HttpResponse.json(events.find((e) => e.id === Number(params.id)))),
    http.get('/api/v1/calendar/events', ({ request }) => {
      const q = new URL(request.url).searchParams
      const from = q.get('from') ?? ''
      const to = q.get('to') ?? ''
      requests.push({ from, to })
      return HttpResponse.json(events.filter((e) => e.startsAt < to && e.endsAt > from))
    }),
    http.get('/api/v1/me/issues', ({ request }) => {
      const q = new URL(request.url).searchParams
      if (opts.failDues?.()) return HttpResponse.json({ message: 'boom' }, { status: 500 })
      const dueFrom = q.get('dueFrom') ?? ''
      const dueTo = q.get('dueTo') ?? ''
      return HttpResponse.json(createIssueSearchResponse(issues.filter((i) => i.dueDate && i.dueDate >= dueFrom && i.dueDate <= dueTo)))
    }),
  ]
  return { requests, handlers }
}

const list = () => screen.getByTestId('calendar-view-agenda')
const firstDayKey = () => list().querySelector<HTMLElement>('[data-day-key]')?.dataset.dayKey

test('초대받은 일정 — 목록은 「초대받은 일정」, 창은 입력칸 없는 상세 보기·캘린더 칩·반복 문장(WP-604·WP-708)', async () => {
  const invited = calendarEvent({
    id: 50, title: '주간 회의', startsAt: kst('2026-10-13', '11:00'), endsAt: kst('2026-10-13', '12:00'),
    calendarId: 99, calendarName: '기본', myRole: 'ATTENDEE', recurrenceRule: 'FREQ=WEEKLY;INTERVAL=1;COUNT=5',
  })
  const cal = stubCalendar({ events: [...baseEvents(), invited] })
  const { user } = renderPage('/calendar', { handlers: cal.handlers })
  const row = await screen.findByTestId('calendar-event-50', {}, { timeout: PAGE_LOAD_TIMEOUT })
  // 주최자 캘린더 이름(「기본」)이 아니라 사이드바 범례와 같은 「초대받은 일정」.
  expect(row).toHaveTextContent('초대받은 일정')
  expect(row).not.toHaveTextContent('기본')
  await user.click(row)
  const dialog = await screen.findByTestId('calendar-event-dialog')
  expect(within(dialog).getByRole('heading', { name: '주간 회의' })).toBeInTheDocument()
  expect(within(dialog).getByTestId('event-detail-calendar')).toHaveTextContent('초대받은 일정')
  expect(within(dialog).getByTestId('event-detail-time')).toHaveTextContent('10월 13일 (화)')
  expect(within(dialog).getByTestId('event-detail-time')).toHaveTextContent('오전 11:00 – 오후 12:00')
  expect(within(dialog).getByTestId('event-detail-recurrence')).toHaveTextContent('매주 화요일 · 5회')
  // 입력칸이 없으니 열자마자 숫자 칸 포커스(휴대폰 숫자 키보드)가 생길 수 없다(WP-604).
  expect(dialog.querySelectorAll('input, textarea, select')).toHaveLength(0)
})

test('이슈 마감 행 — ⚑ 마감·이슈 키, 그 날 묶음 건수에 들어가고, 누르면 이슈 상세로', async () => {
  const cal = stubCalendar()
  const { user, location } = renderPage('/calendar', {
    handlers: [
      ...cal.handlers,
      // 도착한 이슈 상세의 최소 응답 — 이동만 본다.
      http.get('/api/v1/projects/WP', () => HttpResponse.json(createProject({ key: 'WP' }))),
      http.get('/api/v1/projects/WP/issues/136', () => HttpResponse.json(createIssueDetail({ summary: DUE_ISSUE }))),
      http.get('/api/v1/projects/WP/issues/136/*', () => HttpResponse.json([])),
    ],
  })
  const row = await screen.findByTestId('calendar-issue-due-7', {}, { timeout: PAGE_LOAD_TIMEOUT })
  expect(row).toHaveTextContent('마감')
  expect(row).toHaveTextContent('WP-136 모바일 캘린더 일정 목록')
  expect(row).toHaveTextContent('이슈 마감 · WP-136')
  // 마감은 그 날(10/14) 묶음 안 — 종일 일정과 함께 2건.
  expect(screen.getByTestId('calendar-agenda-day-2026-10-14')).toHaveTextContent('2건')
  await user.click(row)
  await waitFor(() => expect(location()).toBe('/projects/WP/issues/136'), { timeout: PAGE_LOAD_TIMEOUT })
})

test('진행 중 일정 — 어제 시작한 여러 날 일정이 오늘 묶음 맨 앞에 끝 날짜와 함께, 미니 달력으로 고른 날에도 보인다', async () => {
  const ongoing = [
    calendarEvent({ id: 400, title: '추계 학회', allDay: true, startsAt: '2026-10-11T00:00:00Z', endsAt: '2026-10-17T00:00:00Z' }),
    calendarEvent({ id: 401, title: '야간 배포 점검', startsAt: kst('2026-10-12', '22:00'), endsAt: kst('2026-10-13', '09:00') }),
    calendarEvent({ id: 402, title: '어제 밤 끝난 회의', startsAt: kst('2026-10-12', '22:00'), endsAt: kst('2026-10-13', '00:00') }),
    calendarEvent({ id: 403, title: '어제 종일', allDay: true, startsAt: '2026-10-12T00:00:00Z', endsAt: '2026-10-13T00:00:00Z' }),
  ]
  const cal = stubCalendar({ events: [...baseEvents(), ...ongoing] })
  const { user } = renderPage('/calendar', { handlers: cal.handlers })
  const todayHead = await screen.findByTestId('calendar-agenda-day-2026-10-13', {}, { timeout: PAGE_LOAD_TIMEOUT })
  // 오늘 묶음 = 이어지는 일정 2건 + 오늘 일정 3건. 끝이 정확히 오늘 자정인 일정·어제 묶음은 없다.
  await waitFor(() => expect(todayHead).toHaveTextContent('5건'))
  expect(screen.queryByTestId('calendar-event-402')).not.toBeInTheDocument()
  expect(screen.queryByTestId('calendar-event-403')).not.toBeInTheDocument()
  expect(firstDayKey()).toBe('2026-10-13')
  const today = list().querySelector<HTMLElement>('[data-day-key="2026-10-13"]')!
  const order = [...today.querySelectorAll<HTMLElement>('[data-testid^="calendar-event-"]')].map((e) => e.dataset.testid)
  expect(order).toEqual(['calendar-event-401', 'calendar-event-400', 'calendar-event-1', 'calendar-event-2', 'calendar-event-3'])
  // 시간 칸 — 종일은 「종일 / ~10/16」(마지막 날), 시간 일정은 「시작 날짜 / ~끝 시각」.
  expect(screen.getByTestId('calendar-event-400')).toHaveTextContent(/종일\s*~10\/16/)
  expect(screen.getByTestId('calendar-event-401')).toHaveTextContent(/10\/12\s*~09:00/)
  // 지금 선은 끝난 07:00 다음, 09:30 앞 — 이어지는 일정이 선을 맨 위로 끌어올리지 않는다.
  expect((screen.getByTestId('calendar-agenda-now').nextElementSibling as HTMLElement).dataset.testid).toBe('calendar-event-2')

  // 미니 달력으로 학회 기간 중 날(10/16)을 고르면 그 날 묶음 맨 앞에 학회(이미 끝난 점검은 없다).
  await user.click(screen.getByTestId('calendar-title-toggle'))
  await user.click(within(await screen.findByTestId('calendar-mobile-mini')).getByRole('button', { name: '2026년 10월 16일 금요일' }))
  await waitFor(() => expect(firstDayKey()).toBe('2026-10-16'))
  const oct16 = list().querySelector<HTMLElement>('[data-day-key="2026-10-16"]')!
  expect(oct16.querySelector('[data-testid^="calendar-event-"]')).toHaveAttribute('data-testid', 'calendar-event-400')
  expect(within(oct16).getByTestId('calendar-event-400')).toHaveTextContent('~10/16')
  expect(screen.queryByTestId('calendar-event-401')).not.toBeInTheDocument()
  expect(screen.getAllByTestId('calendar-event-400')).toHaveLength(1)
})

test('월 보기에서 다른 달로 넘긴 뒤 목록으로 바꾸면 그 달 1일부터, 이번 달이면 오늘부터 보인다', async () => {
  const cal = stubCalendar()
  const { user } = renderPage('/calendar', { handlers: cal.handlers })
  await screen.findByTestId('calendar-agenda-day-2026-10-13', {}, { timeout: PAGE_LOAD_TIMEOUT })
  const select = () => screen.getByTestId('calendar-view-select')

  // 월 보기 › › → 12월. 목록으로 → 12/1 부터 조회해 12/5 일정이 첫 묶음(12/13 부터면 숨는다).
  fireEvent.change(select(), { target: { value: 'month' } })
  await user.click(await screen.findByTestId('calendar-next'))
  await user.click(screen.getByTestId('calendar-next'))
  await waitFor(() => expect(screen.getByTestId('calendar-title')).toHaveTextContent('12월'))
  fireEvent.change(select(), { target: { value: 'agenda' } })
  await waitFor(() => expect(cal.requests).toContainEqual({ from: '2026-11-30T15:00:00.000Z', to: '2026-12-30T15:00:00.000Z' }))
  expect(await screen.findByTestId('calendar-event-301')).toHaveTextContent('12월 초 점검')
  expect(firstDayKey()).toBe('2026-12-05')
  expect(screen.getByTestId('calendar-title')).toHaveTextContent('12월')

  // 다시 월 보기에서 이번 달(10월)로 돌아와 목록 → 10/1 이 아니라 오늘부터.
  fireEvent.change(select(), { target: { value: 'month' } })
  await user.click(await screen.findByTestId('calendar-prev'))
  await user.click(screen.getByTestId('calendar-prev'))
  await waitFor(() => expect(screen.getByTestId('calendar-title')).toHaveTextContent('10월'))
  fireEvent.change(select(), { target: { value: 'agenda' } })
  await waitFor(() => expect(firstDayKey()).toBe('2026-10-13'))
  expect(screen.getByTestId('calendar-agenda-day-2026-10-13')).toHaveTextContent('오늘 · 10월 13일 (화)')
})

test('이슈 마감 조회가 실패해도 일정은 보이고, 하단 다시 시도 줄로 마감까지 되살린다', async () => {
  let failDues = true
  const cal = stubCalendar({ failDues: () => failDues })
  const { user } = renderPage('/calendar', { handlers: cal.handlers })
  const retry = await screen.findByRole('button', { name: '일부 일정을 불러오지 못했습니다 — 다시 시도' }, { timeout: PAGE_LOAD_TIMEOUT })
  // 일정 행은 그대로, 마감 행만 빠져 있다.
  expect(screen.getByTestId('calendar-event-2')).toBeInTheDocument()
  expect(screen.queryByTestId('calendar-issue-due-7')).not.toBeInTheDocument()
  failDues = false
  await user.click(retry)
  expect(await screen.findByTestId('calendar-issue-due-7')).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByRole('button', { name: /다시 시도$/ })).not.toBeInTheDocument())
})
