// 캘린더 화면 테스트 공용 도구(WP-966) — calendarPage·calendarEventDialog 테스트가 함께 쓴다.
// 캘린더 화면(CalendarPage)을 renderScreen 으로 띄우고, 일정·캘린더·이슈 마감 API 를 저장소(state) 하나로 모킹해
// 쓰기 요청(payload·쿼리)을 모은다. E2E 의 stubCalendarEvents·mockApi 자리다.
// 컴포넌트를 내보내지 않는 도구 모음이라 .ts 로 두고 JSX 대신 createElement 를 쓴다.
import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { createElement, type ReactElement } from 'react'
import { afterAll, beforeAll, beforeEach, vi } from 'vitest'

import { AIAssistantProvider } from '@/components/ai/AIAssistantContext'
import { CalendarPage } from '@/pages/calendar/CalendarPage'
import { renderScreen } from '@/test/renderScreen'
import type { Calendar, CalendarEvent, EventNoteRef } from '@/types/calendar'
import type { IssueResponse } from '@/types/issue'

import { calendar, calendarEvent, eventNote } from '../../../../e2e/factories/calendar.factory'
import { createIssue, createIssueSearchResponse } from '../../../../e2e/factories/issue.factory'

/** E2E 와 같은 「지금」 — 2026-06-10 12:00 KST(수). 월 보기가 2026년 6월을 그린다. */
export const NOW = new Date('2026-06-10T03:00:00Z')

/** 시계(Date)만 고정한다 — 타이머는 실제라 MSW·RTL 대기가 그대로 돈다. 다른 날이 필요한 테스트는 vi.setSystemTime 으로 바꾼다. */
export function fixClock() {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
  })
  // 테스트마다 NOW 로 되돌린다 — 다른 날을 쓴 테스트가 다음 테스트에 새지 않게.
  beforeEach(() => vi.setSystemTime(NOW))
  afterAll(() => vi.useRealTimers())
}

/** 2026-06-12 마감인 내 이슈(WP-42, id 7) — 이슈 마감 오버레이 테스트용. */
export const dueIssue = (dueDate = '2026-06-12') =>
  createIssue({ id: 7, projectKey: 'WP', number: 42, title: '로그인 버그', status: 'IN_PROGRESS', dueDate })

type ApiOptions = {
  events?: CalendarEvent[]
  calendars?: Calendar[]
  issues?: IssueResponse[]
  /** 단건 조회(GET /calendar/events/:id) 응답을 바꾼다 — 상세에만 실리는 필드(onlineMeeting 등)·지연 응답. */
  detail?: (id: number) => CalendarEvent | undefined | Promise<CalendarEvent | undefined>
  /** 새 일정 POST 응답을 늦춘다(저장 중 상태 관찰). 넘긴 promise 가 풀릴 때 응답한다. */
  holdPost?: () => Promise<void>
  /** 회의록 노트(WP-1701) — 키 `${일정 id}|${occurrenceDate ?? ''}` 로 처음부터 이어 둔 카드. 없으면 연결 없음 */
  notes?: Record<string, EventNoteRef>
  /** 노트 잇기(PUT) 응답 카드 — 기본은 eventNote({ pageId }) */
  linkedCard?: (pageId: number) => EventNoteRef
  /** 새 일정 기본 캘린더 설정(WP-2169) — GET /calendar/settings 의 defaultCalendarId. 기본 null(웹이 isDefault 로 폴백) */
  defaultCalendarId?: number | null
  /** Outlook 기본 캘린더 물었음(WP-2171) — 기본 true(확인 창 없음). false 면 창 후보 */
  outlookPrompted?: boolean
  /** PUT /calendar/settings 를 이 상태 코드로 실패시킨다(409 등) */
  settingsPutStatus?: number
  /** PUT /calendar/settings 응답을 늦춘다(요청 중 상태 관찰) */
  holdPut?: () => Promise<void>
  /** POST /calendar/settings/outlook-prompted 를 이 상태 코드로 실패시킨다(WP-2171 리뷰 후속 — 기록 실패 뒤 다시 묻기) */
  promptPostStatus?: number
}

/**
 * 캘린더 API 목 — state 를 공유해 저장 뒤 재조회가 최신 목록을 돌려준다(캐시 무효화 검증).
 * requests 에 쓰기 요청 본문·주소, 목록 조회 횟수, /me/issues 쿼리를 모은다.
 */
export function calendarApi(opts: ApiOptions = {}) {
  const state = {
    events: [...(opts.events ?? [])],
    calendars: [...(opts.calendars ?? [calendar({ id: 1, name: 'Works 캘린더', color: 'blue', isDefault: true })])],
    issues: opts.issues ?? [],
    notes: { ...(opts.notes ?? {}) } as Record<string, EventNoteRef>,
    // 새 일정 기본 캘린더 설정(WP-2169) — PUT 이 바꾸고 GET 이 돌려준다
    defaultCalendarId: opts.defaultCalendarId ?? null,
    outlookPrompted: opts.outlookPrompted ?? true,
  }
  const requests = {
    posts: [] as Record<string, unknown>[],
    patches: [] as { url: URL; body: Record<string, unknown> }[],
    deletes: [] as URL[],
    eventLists: 0,
    meIssues: [] as URLSearchParams[],
    calendarPosts: [] as Record<string, unknown>[],
    resets: [] as number[],
    // 노트 API 요청(WP-1701) — 쓰기는 본문·쿼리, 조회는 쿼리
    noteGets: [] as URL[],
    notePuts: [] as { url: URL; body: { pageId: number } }[],
    noteDeletes: [] as URL[],
    // 기본 캘린더 지정(PUT /calendar/settings) 본문(WP-2169)
    settingsPuts: [] as { calendarId: number }[],
    // Outlook 기본 캘린더 물었음 기록(POST /calendar/settings/outlook-prompted) 횟수(WP-2171)
    promptPosts: [] as true[],
    // 설정 GET 횟수 — 비활성 때 안 부르는지 본다(WP-2171)
    settingsGets: 0,
  }
  const noteKey = (id: number | string, url: URL) => `${id}|${url.searchParams.get('occurrenceDate') ?? ''}`
  const handlers = [
    http.get('/api/v1/calendars', () => HttpResponse.json(state.calendars)),
    // 새 일정 기본 캘린더 설정(WP-2169) — 지정하면 state 를 바꿔 다시 읽을 때 새 값을 준다
    http.get('/api/v1/calendar/settings', () => {
      requests.settingsGets++
      return HttpResponse.json({ defaultCalendarId: state.defaultCalendarId, outlookPrompted: state.outlookPrompted })
    }),
    http.put('/api/v1/calendar/settings', async ({ request }) => {
      const body = (await request.json()) as { calendarId: number }
      requests.settingsPuts.push(body)
      if (opts.holdPut) await opts.holdPut()
      if (opts.settingsPutStatus) return HttpResponse.json({ message: 'conflict' }, { status: opts.settingsPutStatus })
      state.defaultCalendarId = body.calendarId
      return HttpResponse.json({ defaultCalendarId: body.calendarId, outlookPrompted: state.outlookPrompted })
    }),
    http.post('/api/v1/calendar/settings/outlook-prompted', () => {
      requests.promptPosts.push(true)
      if (opts.promptPostStatus) return HttpResponse.json({ message: 'error' }, { status: opts.promptPostStatus })
      state.outlookPrompted = true
      return new HttpResponse(null, { status: 204 })
    }),
    http.post('/api/v1/calendars', async ({ request }) => {
      const body = (await request.json()) as { name: string; color: string }
      requests.calendarPosts.push(body)
      const created = calendar({ id: 99, name: body.name, color: body.color, isDefault: false })
      state.calendars = [...state.calendars, created]
      return HttpResponse.json(created, { status: 201 })
    }),
    http.post('/api/v1/calendars/:id/reset', ({ params }) => {
      requests.resets.push(Number(params.id))
      return new HttpResponse(null, { status: 204 })
    }),
    http.get('/api/v1/calendar/tags', () => HttpResponse.json([])),
    // 새 일정 폼의 참석자 고르기가 구성원 목록을 미리 부른다.
    http.get('/api/v1/members', () => HttpResponse.json({ content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 })),
    http.get('/api/v1/calendar/events', () => {
      requests.eventLists++
      return HttpResponse.json(state.events)
    }),
    // 일정(회차)의 회의록 노트 — 위 상세 GET 보다 구체적인 경로라 따로 둔다(WP-1701)
    http.get('/api/v1/calendar/events/:id/note', ({ request, params }) => {
      const url = new URL(request.url)
      requests.noteGets.push(url)
      return HttpResponse.json({ note: state.notes[noteKey(params.id as string, url)] ?? null })
    }),
    http.put('/api/v1/calendar/events/:id/note', async ({ request, params }) => {
      const url = new URL(request.url)
      const body = (await request.json()) as { pageId: number }
      requests.notePuts.push({ url, body })
      const note = opts.linkedCard ? opts.linkedCard(body.pageId) : eventNote({ pageId: body.pageId })
      state.notes[noteKey(params.id as string, url)] = note
      return HttpResponse.json({ note })
    }),
    http.delete('/api/v1/calendar/events/:id/note', ({ request, params }) => {
      const url = new URL(request.url)
      requests.noteDeletes.push(url)
      delete state.notes[noteKey(params.id as string, url)]
      return new HttpResponse(null, { status: 204 })
    }),
    http.get('/api/v1/calendar/events/:id', async ({ params }) => {
      const id = Number(params.id)
      const found = opts.detail ? await opts.detail(id) : state.events.find((e) => e.id === id)
      return found ? HttpResponse.json(found) : HttpResponse.json({ message: 'not found' }, { status: 404 })
    }),
    http.post('/api/v1/calendar/events', async ({ request }) => {
      const body = (await request.json()) as Partial<CalendarEvent>
      requests.posts.push(body as Record<string, unknown>)
      if (opts.holdPost) await opts.holdPost()
      const created = calendarEvent({ ...body, id: 999, title: body.title ?? '새 일정' })
      state.events = [...state.events, created]
      return HttpResponse.json(created, { status: 201 })
    }),
    http.patch('/api/v1/calendar/events/:id', async ({ request, params }) => {
      const body = (await request.json()) as Record<string, unknown>
      requests.patches.push({ url: new URL(request.url), body })
      const id = Number(params.id)
      state.events = state.events.map((e) => (e.id === id ? { ...e, ...body } : e))
      return HttpResponse.json(state.events.find((e) => e.id === id) ?? {})
    }),
    http.delete('/api/v1/calendar/events/:id', ({ request, params }) => {
      requests.deletes.push(new URL(request.url))
      const id = Number(params.id)
      state.events = state.events.filter((e) => e.id !== id)
      return new HttpResponse(null, { status: 204 })
    }),
    http.get('/api/v1/me/issues', ({ request }) => {
      requests.meIssues.push(new URL(request.url).searchParams)
      return HttpResponse.json(createIssueSearchResponse(state.issues))
    }),
  ]
  return { state, requests, handlers }
}

/**
 * 캘린더 화면을 띄우고 첫 화면(캘린더 목록 조회 뒤 사이드바 행)이 뜰 때까지 기다린다.
 * extra 는 이 테스트만의 추가 핸들러(앞에 둬 우선한다). ui 를 주면 CalendarPage 대신 그것을 띄운다(실시간 구독을 곁들일 때).
 */
export async function renderCalendar(
  opts: ApiOptions = {},
  extra: Parameters<typeof renderScreen>[1] = {},
  ui?: ReactElement,
) {
  const api = calendarApi(opts)
  // 일정 대화상자가 AI 사이드 패널과 공존하는 훅(useAiPanelAwareDialog)을 써서 앱 셸 대신 AIAssistantProvider 로 감싼다.
  const view = renderScreen(createElement(AIAssistantProvider, { hotkeysEnabled: false, children: ui ?? createElement(CalendarPage) }), {
    ...extra,
    path: extra.path ?? '/calendar',
    handlers: [...(extra.handlers ?? []), ...api.handlers],
  })
  await screen.findByTestId(`calendar-list-item-${api.state.calendars[0].id}`)
  return { ...view, ...api }
}
