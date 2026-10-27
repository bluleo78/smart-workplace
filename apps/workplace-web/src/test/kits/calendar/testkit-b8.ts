// 캘린더 화면 테스트 공용 도구(WP-966 웨이브 3, b8) — calendarAttendees·calendarColor·calendarExternal·calendarTags 테스트가 함께 쓴다.
// 일정 다이얼로그(EventDialog)·캘린더 화면(CalendarPage)을 renderScreen 으로 띄우고, E2E 와 같은 팩토리 데이터를 MSW 로 준다.
// 두 화면 모두 AI 사이드 패널과 공존하는 다이얼로그 훅(useAiPanelAwareDialog)을 써서 AIAssistantProvider 가 필요하다 — 앱 셸 대신 여기서 감싼다.
// 컴포넌트가 아닌 도우미만 내보내는 .ts 라 JSX 대신 createElement 를 쓴다(react-refresh lint).
import { http, HttpResponse, type RequestHandler } from 'msw'
import { createElement, type ReactElement } from 'react'
import { vi } from 'vitest'

import { AIAssistantProvider } from '@/components/ai/AIAssistantContext'
import { EventDialog } from '@/components/calendar/EventDialog'
import { CalendarPage } from '@/pages/calendar/CalendarPage'
import { renderScreen } from '@/test/renderScreen'
import type { Calendar, CalendarEvent, CalendarEventRequest, CalendarTag } from '@/types/calendar'

/** E2E 와 같은 기준 시각(2026-06-10 12:00 KST) — 월간 보기·새 일정 기본 시각이 이 날을 기준으로 잡힌다. */
export const NOW = new Date('2026-06-10T03:00:00Z')

/** Date 만 고정한다 — 타이머까지 가짜로 두면 MSW·react-query·userEvent 의 대기가 멈춘다. */
export function pinNow() {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
}

const API = '/api/v1'

/** 요청 본문을 모으는 쓰기 핸들러 — 메서드·경로·응답을 받아 [핸들러, 받은 본문 목록, 받은 URL 목록]을 돌려준다. */
export function capture(
  method: 'post' | 'put' | 'patch' | 'delete',
  path: string,
  respond: () => Response = () => new HttpResponse(null, { status: 204 }),
) {
  const bodies: unknown[] = []
  const urls: URL[] = []
  const handler = http[method](`${API}${path}`, async ({ request }) => {
    urls.push(new URL(request.url))
    const text = await request.text()
    bodies.push(text ? JSON.parse(text) : null)
    return respond()
  })
  return { handler, bodies, urls }
}

/** 캘린더 화면 기본 조회 — 캘린더 목록·범위 일정(+상세)·내 이슈 마감·태그 목록·구성원 검색(빈 결과). 테스트가 더 구체적인 핸들러를 앞에 줘 덮는다. */
export function calendarHandlers({
  calendars,
  events = [],
  tags = [],
}: {
  calendars: Calendar[]
  events?: CalendarEvent[]
  tags?: CalendarTag[]
}): RequestHandler[] {
  return [
    http.get(`${API}/calendars`, () => HttpResponse.json(calendars)),
    http.get(`${API}/calendar/events`, () => HttpResponse.json(events)),
    http.get(`${API}/calendar/events/:id`, ({ params }) => {
      const found = events.find((e) => e.id === Number(params.id))
      return found ? HttpResponse.json(found) : HttpResponse.json({ message: '없음' }, { status: 404 })
    }),
    http.get(`${API}/me/issues`, () => HttpResponse.json([])),
    http.get(`${API}/calendar/tags`, () => HttpResponse.json(tags)),
    // 참석자 줄의 구성원 검색(GET /members?search=) — 참석자 테스트는 결과를 주는 핸들러로 덮는다
    http.get(`${API}/members`, () => HttpResponse.json({ content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 })),
  ]
}

/** AI 패널 공존 훅이 쓰는 Provider 로 감싼다(단축키 끔). */
function withAi(ui: ReactElement) {
  return createElement(AIAssistantProvider, { hotkeysEnabled: false, children: ui })
}

/** 캘린더 화면 전체 — 사이드바·월간 보기·일정 다이얼로그·태그 대화상자·반복 범위 선택이 한 화면에서 이어지는 판정용. */
export function renderCalendarPage(path: string, handlers: RequestHandler[]) {
  return renderScreen(withAi(createElement(CalendarPage)), { path, handlers })
}

/**
 * 일정 다이얼로그 하나만 — 폼 입력 → 저장 본문(onSubmit), 상세 응답 → 보기 판정용.
 * 저장 본문은 CalendarPage 가 그대로 생성·수정 요청에 싣는다(submit → create/update.mutate).
 */
export function renderEventDialog(event: CalendarEvent | null, handlers: RequestHandler[]) {
  const onSubmit = vi.fn<(body: CalendarEventRequest) => void>()
  const view = renderScreen(
    withAi(createElement(EventDialog, { open: true, onOpenChange: () => {}, event, defaultStart: NOW, onSubmit })),
    { path: '/calendar', handlers },
  )
  return { ...view, onSubmit }
}
