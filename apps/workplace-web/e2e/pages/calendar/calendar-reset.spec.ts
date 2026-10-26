// 캘린더 케밥 메뉴 — 브라우저가 필요한 판정만 남겼다(WP-966).
// - @input: 마우스 없이 키보드 포커스만으로 케밥이 보인다
// - @layout: 터치 태블릿에서 케밥이 상시 44px·이름과 안 겹침(+ 탭으로 열어 리셋)
// 「모든 일정 삭제」 POST·재조회, 연동 캘린더 제약(리셋 없음·삭제 버튼 없음·이름 경고)은
// src/pages/calendar/calendarPage.test.tsx(renderScreen)가 지킨다.
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

test('케밥 메뉴 버튼 — 마우스 없이 키보드 포커스만으로 노출됨 (#709)', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  await stub(page)
  await page.goto('/calendar')

  await expect(page.getByTestId('calendar-list-item-1')).toBeVisible()
  const menuBtn = page.getByTestId('calendar-menu-1')
  // hover 전: opacity-0 이지만 focus 시엔 보여야 한다.
  await expect(menuBtn).toHaveCSS('opacity', '0')
  await menuBtn.focus()
  await expect(menuBtn).toHaveCSS('opacity', '1')
})

// WP-237: 터치 태블릿(≥1024px, pointer: coarse)은 hover 가 없어 케밥에 닿지 못했다 → 상시 노출 + 44px.
test.describe('캘린더 케밥 — 터치 태블릿(≥1024px)', { tag: '@layout' }, () => {
  test.use({ viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true })

  test('케밥이 상시 보이고(44px, 이름과 안 겹침) 탭으로 열어 리셋 POST 한다', async ({ authenticatedPage: page }) => {
    await stub(page)
    await mockApi(page, 'POST', '/api/v1/calendars/1/reset', undefined, { status: 204 })
    await page.goto('/calendar')
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)

    const menu = page.getByTestId('calendar-menu-1')
    await expect(menu).toHaveCSS('opacity', '1')
    const m = (await menu.boundingBox())!
    expect(m.width).toBeGreaterThanOrEqual(44)
    expect(m.height).toBeGreaterThanOrEqual(44)
    const name = (await page.getByTestId('calendar-list-item-1').getByText('기본', { exact: true }).boundingBox())!
    expect(name.x + name.width).toBeLessThanOrEqual(m.x)

    await menu.tap()
    await page.getByTestId('calendar-reset-1').click()
    const resetPost = page.waitForRequest(
      (r) => r.url().includes('/api/v1/calendars/1/reset') && r.method() === 'POST',
    )
    await page.getByTestId('calendar-reset-confirm-submit').click()
    await resetPost
  })
})
