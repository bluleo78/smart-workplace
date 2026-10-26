// 외부 동기화(M365) 일정 상세 보기 레이아웃 E2E — 긴 Teams 초대 본문에서 설명 문단은 잘리지 않고 다이얼로그 본문 하나만 스크롤된다(WP-708, @layout).
// 백엔드 없이 page.route 로 /api/v1/calendars·/api/v1/calendar/events 를 모킹한다. (이슈 #501)
// 사이드바 읽기 전용 배지·계정 묶음·표시 토글, 새 일정 캘린더 선택에서 읽기 전용 제외, 읽기 전용/로컬 일정의 상세 보기·편집 폼 분기,
// Teams 참가 링크·안내문 접기·참석자 접기, 회차 날짜 표시는 src/pages/calendar/calendarExternal.test.tsx 가 지킨다(WP-966).
import type { Page } from '@playwright/test'

import type { Calendar, CalendarEvent } from '../../../src/types/calendar'
import { calendar, calendarEvent } from '../../factories/calendar.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'

// 타임존 고정 — 이슈 #493 교훈: 호스트 TZ 에 따라 날짜 경계가 달라지므로 반드시 핀.
test.use({ timezoneId: 'Asia/Seoul' })

/**
 * 이벤트 목록 + 단일 이벤트 상세(GET /events/{id}) + 캘린더 목록 스텁.
 * 이벤트 클릭 → 다이얼로그 열기 시나리오에 사용.
 */
async function stubForDialog(page: Page, calendars: Calendar[], events: CalendarEvent[]) {
  await mockApi(page, 'GET', '/api/v1/calendars', calendars)
  await mockApi(page, 'GET', '/api/v1/me/issues', [])

  // /api/v1/calendar/events 경로 패밀리 — 목록 + 단일 상세 분기 처리
  await page.route(
    (url) => url.pathname.startsWith('/api/v1/calendar/events'),
    (route) => {
      const method = route.request().method()
      const pathname = new URL(route.request().url()).pathname

      // GET /events/{id} — 단일 상세
      if (method === 'GET' && pathname.match(/\/calendar\/events\/\d+$/)) {
        const id = Number(pathname.split('/').pop())
        const detail = events.find((e) => e.id === id) ?? events[0]
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(detail),
        })
      }

      // GET /events — 목록
      if (method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(events),
        })
      }

      return route.fallback()
    },
  )
}

test('M365 Teams 초대 — 상세 보기는 설명 문단을 자르지 않고 다이얼로그 본문 하나만 스크롤한다(WP-708)', { tag: '@layout' }, async ({
  authenticatedPage: page,
}) => {
  await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
  // Teams 안내문 + 긴 본문 — 예전엔 3줄 설명 칸 안에서 따로 스크롤되고 링크를 누를 수 없었다.
  const teamsUrl = 'https://teams.microsoft.com/meet/46286105292202?p=Xk2'
  const sep = '_'.repeat(80)
  const longBody = `${'회의 안건 메모\n'.repeat(30)}\n${sep}\nMicrosoft Teams 모임\n참가: ${teamsUrl}\n모임 ID: 462 861 052 922 02\n${sep}`
  const teamsEvent = calendarEvent({
    id: 43,
    title: '[아이에이클라우드] DCP-46 과제 컨소시엄 연구개발계획서 작성 방안 논의',
    calendarId: 10,
    calendarName: 'M365 캘린더',
    location: 'SynergiA',
    description: longBody,
    onlineMeeting: { provider: 'TEAMS', joinUrl: teamsUrl },
    external: true,
    myRole: 'ATTENDEE',
    myRsvpStatus: 'NEEDS_ACTION',
    attendees: [],
  })
  await stubForDialog(
    page,
    [
      calendar({ id: 1, name: '기본', color: 'blue', isDefault: true, isReadOnly: false }),
      calendar({ id: 10, name: 'M365 캘린더', color: 'indigo', isDefault: false, isReadOnly: true, provider: 'M365_GRAPH' }),
    ],
    [teamsEvent],
  )
  await page.goto('/calendar')
  await page.getByTestId('calendar-event-43').first().click()
  const view = page.getByTestId('event-detail-view')
  await expect(view).toBeVisible()
  await expect(view.getByTestId('event-detail-description')).toContainText('회의 안건 메모')

  // 스크롤은 본문 하나 — 설명 문단은 잘리지 않고(안쪽 스크롤 없음) 본문 컨테이너가 넘친다
  const desc = view.getByTestId('event-detail-description').locator('p')
  const inner = await desc.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }))
  expect(inner.sh).toBeLessThanOrEqual(inner.ch + 1)
  const outer = await view.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }))
  expect(outer.sh).toBeGreaterThan(outer.ch)
})
