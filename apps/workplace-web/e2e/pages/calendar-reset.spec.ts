// 캘린더 강제 리셋(모든 일정 삭제) — 케밥 메뉴 진입, 로컬만 노출, 확인 후 POST .../reset.
import type { Page } from '@playwright/test'

import type { Calendar } from '../../src/types/calendar'
import { calendar } from '../factories/calendar.factory'
import { mockApi } from '../fixtures/api-mock'
import { expect, test } from '../fixtures/auth.fixture'

// 로컬 기본 캘린더(1) + M365 연동 캘린더(10, accountEmail 보유) 스텁.
async function stub(page: Page) {
  const cals: Calendar[] = [
    calendar({ id: 1, name: '기본', isDefault: true }),
    calendar({
      id: 10,
      name: 'Calendar',
      isDefault: false,
      isReadOnly: false,
      accountEmail: 'me@iacloud.kr',
      provider: 'M365_GRAPH',
    }),
  ]
  await mockApi(page, 'GET', '/api/v1/calendars', cals)
  await mockApi(page, 'GET', '/api/v1/calendar/events', [])
  await mockApi(page, 'GET', '/api/v1/me/issues', [])
}

test('로컬 캘린더 케밥에 "모든 일정 삭제" 노출 + 확인 시 POST .../reset 호출', async ({ authenticatedPage: page }) => {
  await stub(page)
  await mockApi(page, 'POST', '/api/v1/calendars/1/reset', undefined, { status: 204 })
  await page.goto('/calendar')

  // 초기 일정 로드가 끝난 뒤 케밥 → 리셋 진입
  await expect(page.getByTestId('calendar-list-item-1')).toBeVisible()
  const row = page.getByTestId('calendar-list-item-1')
  await row.hover()
  await page.getByTestId('calendar-menu-1').click()
  await page.getByTestId('calendar-reset-1').click()
  await expect(page.getByTestId('calendar-reset-confirm')).toBeVisible()

  // 확인 시 ① 리셋 POST 가 발생하고 ② 그 직후 일정 목록이 무효화→refetch(GET events)되는지 검증.
  // refetch 가 안 뜨면(무효화 키 회귀) waitForRequest 가 타임아웃 → 테스트 실패(teeth).
  const resetPost = page.waitForRequest(
    (r) => r.url().includes('/api/v1/calendars/1/reset') && r.method() === 'POST',
  )
  const refetch = page.waitForRequest(
    (r) => r.url().includes('/api/v1/calendar/events') && r.method() === 'GET',
  )
  await page.getByTestId('calendar-reset-confirm-submit').click()
  await resetPost
  await refetch
})

test('연동 캘린더 케밥에는 "모든 일정 삭제" 항목이 없다', async ({ authenticatedPage: page }) => {
  await stub(page)
  await page.goto('/calendar')

  const row = page.getByTestId('calendar-list-item-10')
  await row.hover()
  await page.getByTestId('calendar-menu-10').click()
  await expect(page.getByTestId('calendar-edit-10')).toBeVisible()
  await expect(page.getByTestId('calendar-reset-10')).toHaveCount(0)
})
