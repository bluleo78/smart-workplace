// 캘린더 강제 리셋(모든 일정 삭제) — 케밥 메뉴 진입, 로컬만 노출, 확인 후 POST .../reset.
import type { Page } from '@playwright/test'

import type { Calendar } from '../../../src/types/calendar'
import { calendar } from '../../factories/calendar.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'

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

// ────────────────────────────────────────────────────────────
// 쓰기가능 외부 동기화 캘린더(isReadOnly:false, accountEmail 보유) 편집 다이얼로그 제약 (이슈 #608)
// ────────────────────────────────────────────────────────────

test('쓰기가능 연동 캘린더(Calendar) 편집 다이얼로그: 삭제 버튼 없음 + 이름 경고 문구 노출', async ({
  authenticatedPage: page,
}) => {
  await stub(page)
  await page.goto('/calendar')

  const row = page.getByTestId('calendar-list-item-10')
  await row.hover()
  await page.getByTestId('calendar-menu-10').click()
  await page.getByTestId('calendar-edit-10').click()

  await expect(page.getByTestId('calendar-edit-dialog')).toBeVisible()

  // 이름 입력은 여전히 값 확인 가능하지만, 외부 동기화 경고 문구가 함께 노출되어야 한다.
  await expect(page.getByTestId('calendar-edit-name')).toHaveValue('Calendar')
  await expect(page.getByTestId('calendar-edit-external-warning')).toBeVisible()
  await expect(page.getByTestId('calendar-edit-external-warning')).toContainText(
    '실제 계정 캘린더명과 동기화되지 않습니다',
  )

  // 삭제 버튼이 없어야 한다 — 로컬 삭제 시 동기화 재생성으로 고아 데이터 발생(#608).
  await expect(page.getByRole('button', { name: '삭제' })).toHaveCount(0)
})

test('로컬 캘린더 편집 다이얼로그: 삭제 버튼 노출 + 외부 경고 문구 없음 (회귀)', async ({
  authenticatedPage: page,
}) => {
  await stub(page)
  await page.goto('/calendar')

  // 로컬 비기본 캘린더 추가 스텁(기본 캘린더는 삭제 버튼 자체가 없으므로 별도 캘린더 필요)
  await mockApi(page, 'GET', '/api/v1/calendars', [
    calendar({ id: 1, name: '기본', isDefault: true }),
    calendar({ id: 2, name: '업무', isDefault: false, isReadOnly: false }),
    calendar({
      id: 10,
      name: 'Calendar',
      isDefault: false,
      isReadOnly: false,
      accountEmail: 'me@iacloud.kr',
      provider: 'M365_GRAPH',
    }),
  ])
  await page.reload()

  const row = page.getByTestId('calendar-list-item-2')
  await row.hover()
  await page.getByTestId('calendar-menu-2').click()
  await page.getByTestId('calendar-edit-2').click()

  await expect(page.getByTestId('calendar-edit-dialog')).toBeVisible()
  await expect(page.getByTestId('calendar-edit-external-warning')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '삭제' })).toBeVisible()
})

test('케밥 메뉴 버튼 — 마우스 없이 키보드 포커스만으로 노출됨 (#709)', async ({ authenticatedPage: page }) => {
  await stub(page)
  await page.goto('/calendar')

  await expect(page.getByTestId('calendar-list-item-1')).toBeVisible()
  const menuBtn = page.getByTestId('calendar-menu-1')
  // hover 전: opacity-0 이지만 focus 시엔 보여야 한다.
  await expect(menuBtn).toHaveCSS('opacity', '0')
  await menuBtn.focus()
  await expect(menuBtn).toHaveCSS('opacity', '1')
})
