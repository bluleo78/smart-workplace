// WP-1488 — 화면 폭이 lg(1024px) 경계를 넘어 셸이 바뀌어도 페이지 안 스크롤 위치가 남는다.
// AppLayout 이 셸을 바꿀 때 useNodeBridge 가 페이지 호스트([data-page-host])를 appendChild 로 옮기고,
// 브라우저는 이동된 노드 하위의 스크롤 오프셋을 0 으로 잃는다. 스크롤 위치는 jsdom 이 재현할 수 없어 @layout.
//
// 두 테스트: (1) 호스트 이동만 가려내는 스크롤 프로브(호스트 안, React 가 건드리지 않는 자리에 직접 붙임),
// (2) 실제 캘린더 주간 시간 격자(CalendarPage 가 모바일에서만 swipe 래퍼를 두어 다시 마운트되던 문제 포함).
import { expect, test } from '../../fixtures/auth.fixture'

test('페이지 호스트 안 스크롤 위치가 lg 경계를 넘어도 남는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

  await page.route(
    (url) => url.pathname.startsWith('/api/v1/calendar/events'),
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )

  await page.goto('/calendar')
  await page.getByTestId('calendar-view-week-btn').click()
  await expect(page.getByTestId('calendar-view-week')).toBeVisible()

  // 호스트 안에 스크롤 프로브(높이 200 / 내용 1000)를 붙이고 382 로 내려 둔다.
  await page.evaluate(() => {
    const host = document.querySelector('[data-page-host]') as HTMLElement
    const probe = document.createElement('div')
    probe.dataset.testid = 'scroll-probe'
    probe.style.cssText = 'height:200px;overflow:auto;position:fixed;left:0;bottom:0;width:100px;z-index:-1'
    const inner = document.createElement('div')
    inner.style.height = '1000px'
    probe.appendChild(inner)
    host.appendChild(probe)
    probe.scrollTop = 382
  })
  const probe = page.getByTestId('scroll-probe')
  await expect.poll(() => probe.evaluate((el) => el.scrollTop)).toBe(382)

  // 좁은 폭(모바일 셸)으로 — 호스트 DOM 이 옮겨진다
  await page.setViewportSize({ width: 390, height: 900 })
  await expect(page.getByTestId('calendar-view-week')).toBeVisible()
  await expect.poll(() => probe.evaluate((el) => el.scrollTop)).toBe(382)

  // 다시 넓은 폭(데스크톱 셸)으로
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(page.getByTestId('calendar-view-week')).toBeVisible()
  await expect.poll(() => probe.evaluate((el) => el.scrollTop)).toBe(382)
})

test('주간 시간 격자 스크롤 위치가 lg 경계를 넘어도 남는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

  await page.route(
    (url) => url.pathname.startsWith('/api/v1/calendar/events'),
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )

  await page.goto('/calendar')
  await page.getByTestId('calendar-view-week-btn').click()
  await expect(page.getByTestId('calendar-view-week')).toBeVisible()

  // 시간 격자 스크롤 요소 — 주간 뷰 루트 안에서 실제로 세로 스크롤이 걸린 요소(testid 없이 overflow 로 찾는다)
  const grid = page.getByTestId('calendar-view-week').locator('div.overflow-auto')
  await grid.evaluate((el) => {
    el.scrollTop = 382
  })
  await expect.poll(() => grid.evaluate((el) => el.scrollTop)).toBe(382)

  // 좁은 폭에서도 같은 주간 격자가 보이며 위치가 남아 있어야 한다
  await page.setViewportSize({ width: 390, height: 900 })
  await expect(page.getByTestId('calendar-view-week')).toBeVisible()
  await expect.poll(() => grid.evaluate((el) => Math.abs(el.scrollTop - 382))).toBeLessThanOrEqual(2)

  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(page.getByTestId('calendar-view-week')).toBeVisible()
  await expect.poll(() => grid.evaluate((el) => Math.abs(el.scrollTop - 382))).toBeLessThanOrEqual(2)
})
