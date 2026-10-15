// 개인 캘린더 컨테이너 E2E — 사이드바 캘린더별 토글 + CRUD + 초대받은 일정 필터.
// 백엔드 없이 page.route 로 /api/v1/calendars 와 /api/v1/calendar/events 를 모킹한다.
import type { Page } from '@playwright/test'

import type { Calendar, CalendarEvent } from '../../../src/types/calendar'
import { calendar } from '../../factories/calendar.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'

// 캘린더 컨테이너 목록 + 일정 + 이슈 마감 기본 스텁.
async function stubCalendars(page: Page, calendars: Calendar[], events: CalendarEvent[] = []) {
  await mockApi(page, 'GET', '/api/v1/calendars', calendars)
  await mockApi(page, 'GET', '/api/v1/calendar/events', events)
  await mockApi(page, 'GET', '/api/v1/me/issues', [])
}

test('사이드바에 캘린더 목록이 표시된다', async ({ authenticatedPage: page }) => {
  await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
  await stubCalendars(page, [
    calendar({ id: 1, name: '기본', color: 'blue', isDefault: true }),
    calendar({ id: 2, name: '업무', color: 'green', isDefault: false }),
  ])

  await page.goto('/calendar')

  // 두 캘린더 행이 사이드바에 보여야 한다.
  await expect(page.getByTestId('calendar-list-item-1')).toBeVisible()
  await expect(page.getByTestId('calendar-list-item-2')).toBeVisible()
  await expect(page.getByTestId('calendar-list-item-1')).toContainText('기본')
  await expect(page.getByTestId('calendar-list-item-2')).toContainText('업무')
})

test(
  'POST /calendars payload 검증 — 이름·색 선택 후 저장',
  { tag: '@smoke' },
  async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
    const calendarsStore: Calendar[] = [calendar({ id: 1, name: '기본', color: 'blue', isDefault: true })]

    // GET /calendars 는 store 를 직접 반환, POST 시 store 에 추가.
    await page.route(
      (url) => url.pathname === '/api/v1/calendars',
      (route) => {
        const method = route.request().method()
        if (method === 'GET') {
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(calendarsStore) })
        }
        if (method === 'POST') {
          const body = JSON.parse(route.request().postData() ?? '{}') as Partial<Calendar>
          const newCal = calendar({ id: 99, name: body.name ?? '새 캘린더', color: body.color ?? 'blue', isDefault: false })
          calendarsStore.push(newCal)
          return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(newCal) })
        }
        return route.fallback()
      },
    )
    await mockApi(page, 'GET', '/api/v1/calendar/events', [])
    await mockApi(page, 'GET', '/api/v1/me/issues', [])

    await page.goto('/calendar')

    // ＋ 버튼 클릭 → 다이얼로그 열림.
    await page.getByTestId('calendar-add').click()
    await expect(page.getByTestId('calendar-edit-dialog')).toBeVisible()

    // 이름 입력.
    await page.getByTestId('calendar-edit-name').fill('업무')

    // 색 선택 — green 스와치 클릭.
    await page.getByTestId('calendar-color-green').click()

    // POST payload 캡처를 위한 별도 route 는 이미 위에서 처리됨.
    // 저장 버튼 클릭.
    const postCapture = page.waitForRequest(
      (req) => req.url().includes('/api/v1/calendars') && req.method() === 'POST',
    )
    await page.getByTestId('calendar-edit-submit').click()
    const posted = await postCapture

    // payload 검증 — { name, color } 포함.
    const payload = JSON.parse(posted.postData() ?? '{}') as { name: string; color: string }
    expect(payload.name).toBe('업무')
    expect(payload.color).toBe('green')

    // 다이얼로그 닫힘 + 새 캘린더 목록에 반영.
    await expect(page.getByTestId('calendar-edit-dialog')).toHaveCount(0)
    await expect(page.getByTestId('calendar-list-item-99')).toBeVisible()
    await expect(page.getByTestId('calendar-list-item-99')).toContainText('업무')
  },
)

// 캘린더 체크박스·"초대받은 일정" 토글 → 그리드 표시 규칙은 calendar.test(isEventVisible)가, 토글 wiring 은
// calendar-sidebar.spec(표시 토글로 일정/이슈 레이어를 끄고 켤 수 있다)이 지킨다.
