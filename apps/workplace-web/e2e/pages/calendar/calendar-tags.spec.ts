// 캘린더 태그 E2E (WP-714·716) — 일정 상세 피커 체크 → PUT, 없는 이름 → 태그 POST → PUT 의 실제 배선(@wiring).
// 백엔드 없이 page.route 로 /api/v1/calendar/** 를 모킹한다.
// Outlook 범주 안내·읽기 전용 태그 줄, 편집·새 일정 폼 태그(PATCH·POST 의 tagIds, 취소·실패·반복 범위 안내), 사이드바 태그 묶음(지우기·만들기),
// 태그 이름·색 대화상자(Outlook 태그 이름 잠금)는 src/pages/calendar/calendarTags.test.tsx 가 지킨다(WP-966).
import type { Page } from '@playwright/test'

import type { CalendarEvent, CalendarTag } from '../../../src/types/calendar'
import { calendar, calendarEvent } from '../../factories/calendar.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'

// 타임존 고정 — 호스트 TZ 에 따라 날짜 경계가 달라진다(이슈 #493).
test.use({ timezoneId: 'Asia/Seoul' })

// 「사내 공유」는 Outlook 범주에서 온 태그(fromOutlook) — 이름 칸이 잠기는지 본다
const TAGS: CalendarTag[] = [
  { id: 1, name: '사내 공유', color: 'violet', eventCount: 12, hasFeed: true, fromOutlook: true },
  { id: 2, name: '운영', color: 'amber', eventCount: 5, hasFeed: false, fromOutlook: false },
]

/** 앱 일정(태그 수정 가능) — 초대받은 일정이라 캘린더 목록에 없는 calendarId. */
const appEvent = (over: Partial<CalendarEvent> = {}): CalendarEvent =>
  calendarEvent({
    id: 50,
    title: '주간 개발 회의',
    calendarId: 99,
    calendarName: null,
    myRole: 'ATTENDEE',
    tags: [{ id: 1, name: '사내 공유', color: 'violet' }],
    tagsEditable: true,
    ...over,
  })

/** 일정 목록·상세 + 태그 목록 스텁. 태그 PUT/POST/피드는 각 테스트가 더 구체적으로 다시 모킹한다(나중 등록 우선). */
async function stub(page: Page, events: CalendarEvent[], tags: CalendarTag[] = TAGS) {
  await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
  await mockApi(page, 'GET', '/api/v1/calendars', [
    calendar({ id: 1, name: '기본', isDefault: true }),
    calendar({ id: 10, name: '회사 일정', isDefault: false, isReadOnly: true, accountEmail: 'me@corp.kr', provider: 'M365_GRAPH' }),
    // 내 사서함의 쓸 수 있는 Outlook 달력 — 여기 일정의 태그는 Outlook 범주로 써 넣는다(WP-716)
    calendar({ id: 11, name: 'Outlook 일정', isDefault: false, isReadOnly: false, accountEmail: 'me@corp.kr', provider: 'M365_GRAPH' }),
  ])
  await mockApi(page, 'GET', '/api/v1/me/issues', [])
  await mockApi(page, 'GET', '/api/v1/calendar/tags', tags)
  await page.route(
    (url) => url.pathname.startsWith('/api/v1/calendar/events'),
    (route) => {
      const m = new URL(route.request().url()).pathname.match(/\/calendar\/events\/(\d+)$/)
      if (route.request().method() === 'GET') {
        const body = m ? events.find((e) => e.id === Number(m[1])) : events
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
      }
      return route.fallback()
    },
  )
}

test('앱 일정: 피커에서 체크하면 바로 PUT 으로 저장되고, 없는 이름은 만들어 바로 붙인다', { tag: '@wiring' }, async ({ authenticatedPage: page }) => {
  await stub(page, [appEvent()])
  const put = await mockApi(page, 'PUT', '/api/v1/calendar/events/50/tags', {}, { capture: true })
  const post = await mockApi(page, 'POST', '/api/v1/calendar/tags', { id: 9, name: '고객사', color: 'blue', eventCount: 0, hasFeed: false }, { capture: true })

  await page.goto('/calendar?eventId=50')
  await expect(page.getByTestId('event-detail-tag')).toHaveText(['사내 공유'])
  await page.getByTestId('event-detail-tag-add').click()
  const picker = page.getByTestId('calendar-tag-picker')
  await expect(picker.getByTestId('calendar-tag-option-1').getByRole('checkbox')).toBeChecked()

  // 「운영」 체크 → 현재 선택 전체를 PUT (교체 방식)
  await picker.getByTestId('calendar-tag-option-2').click()
  expect((await put.waitForRequest()).payload).toEqual({ tagIds: [1, 2] })

  // 대소문자만 다른 기존 이름은 「만들기」를 내지 않는다
  await page.getByTestId('calendar-tag-search').fill(' 운영 ')
  await expect(page.getByTestId('calendar-tag-create-option')).toHaveCount(0)

  // 없는 이름 → 「「고객사」 태그 만들기」 → POST(이름+이름에서 정한 색) 뒤 새 태그까지 포함해 PUT
  await page.getByTestId('calendar-tag-search').fill('고객사')
  await expect(page.getByTestId('calendar-tag-create-option')).toContainText('「고객사」 태그 만들기')
  await page.getByTestId('calendar-tag-create-option').click()
  const created = (await post.waitForRequest()).payload as { name: string; color: string }
  expect(created.name).toBe('고객사')
  expect(created.color).toMatch(/^(blue|green|red|amber|violet|pink|teal|gray)$/)
  await expect.poll(() => put.lastRequest()?.payload).toEqual({ tagIds: [1, 2, 9] })
})
