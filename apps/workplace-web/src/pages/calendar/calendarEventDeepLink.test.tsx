// 캘린더 일정 딥링크(?eventId) 실패 처리(#659·WP-208) — 화면 컴포넌트 테스트(WP-971, WP-995).
// 삭제됐거나 권한이 없는 일정으로 들어오면 다이얼로그 없이 캘린더를 보이고 안내한 뒤 eventId 를 주소에서 지운다(남기면 다음 일정 열기가
// push 되지 않아 닫기가 캘린더를 떠난다). 브라우저 없이 판정되므로 e2e/pages/inbox.spec.ts 에서 옮겼다.
// 알림 → 일정 상세가 실제로 열리는 흐름은 inbox.spec.ts 의 @flow 가 지킨다.
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { AIAssistantProvider } from '@/components/ai/AIAssistantContext'
import { CalendarPage } from '@/pages/calendar/CalendarPage'
import { renderScreen } from '@/test/renderScreen'

test('존재하지 않는 eventId 딥링크는 다이얼로그 없이 월 보기와 안내를 보이고 eventId 를 지운다', async () => {
  let fetched = 0
  const { location } = renderScreen(
    // 캘린더 화면은 AI 패널 모드(useAssistant)를 읽는다 — AppLayout 과 같은 Provider 로 감싼다.
    <AIAssistantProvider hotkeysEnabled={false}>
      <CalendarPage />
    </AIAssistantProvider>,
    {
      path: '/calendar?eventId=999',
      handlers: [
        http.get('/api/v1/calendar/events/999', () => {
          fetched++
          return HttpResponse.json({ message: '일정을 찾을 수 없습니다' }, { status: 404 })
        }),
        // 캘린더 목록·일정·태그와 할 일 패널(내 이슈)은 빈 값으로 둔다.
        http.get('/api/v1/calendars', () => HttpResponse.json([])),
        http.get('/api/v1/calendar/events', () => HttpResponse.json([])),
        http.get('/api/v1/calendar/tags', () => HttpResponse.json([])),
        http.get('/api/v1/me/issues', () => HttpResponse.json({ items: [], nextCursor: null, hasMore: false })),
      ],
    },
  )
  expect(await screen.findByText('일정을 찾을 수 없거나 접근 권한이 없습니다')).toBeInTheDocument()
  expect(fetched).toBeGreaterThan(0)
  expect(screen.getByTestId('calendar-view-month')).toBeInTheDocument()
  expect(screen.queryByTestId('calendar-event-dialog')).not.toBeInTheDocument()
  await waitFor(() => expect(location()).toBe('/calendar'))
})
