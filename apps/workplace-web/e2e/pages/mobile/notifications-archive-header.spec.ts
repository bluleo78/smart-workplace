// WP-1690 — 모바일 알림 화면 머리(탭 루트·푸시 화면)에 「알림 | 보관함」 전환과 두 액션이 390px 한 줄에 들어가는지.
// 글자 폭·말줄임·가로 넘침은 브라우저 레이아웃이 있어야 알 수 있어(@layout) E2E 로 둔다. 전환·되돌리기 동작은
// src/pages/mobile/notificationsArchive.test.tsx 가 지킨다.
import type { Locator, Page } from '@playwright/test'

import { mockApi } from '../../fixtures/api-mock'
import { expect, expectNoHorizontalOverflow, test } from '../../fixtures/mobile.fixture'

/** 알림 화면이 부르는 조회를 비워 둔다(머리 기하만 본다). */
async function stubNotifications(page: Page) {
  await mockApi(page, 'GET', '/api/v1/notifications', [])
  await mockApi(page, 'GET', '/api/v1/notifications/archived', [])
  await mockApi(page, 'GET', '/api/v1/notifications/unread-count', { count: 0 })
}

/** 머리 안에서 제목이 말줄임되지 않고, 전환·두 액션이 머리 폭 안에 있으며, 머리가 가로로 넘치지 않는지. */
async function expectHeaderFits(page: Page, header: Locator, title: Locator) {
  const hb = (await header.boundingBox())!
  expect(await header.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  // 제목이 잘리지 않는다(truncate 로 ellipsis 가 걸리면 scrollWidth > clientWidth).
  expect(await title.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  for (const id of ['inbox-tab-inbox', 'inbox-tab-archive', 'inbox-mark-all', 'inbox-archive-read']) {
    const b = (await header.getByTestId(id).boundingBox())!
    expect(b.x, id).toBeGreaterThanOrEqual(hb.x)
    expect(b.x + b.width, id).toBeLessThanOrEqual(hb.x + hb.width + 0.5)
  }
  // 탭 글자가 줄바꿈되지 않는다(한 줄 높이).
  expect((await header.getByTestId('inbox-tab-archive').boundingBox())!.height).toBeLessThan(32)
  await expectNoHorizontalOverflow(page)
}

test('알림 푸시 화면 머리: 제목·전환·모두 읽음·읽은 알림 보관이 390px 한 줄에 들어간다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await stubNotifications(page)
  await page.goto('/notifications')
  const header = page.getByTestId('notifications-header')
  await expect(header.getByTestId('inbox-tab-archive')).toBeVisible()
  await expectHeaderFits(page, header, header.getByTestId('mobile-back-title'))
})

test('알림 탭 루트 머리: 제목·전환·두 액션이 390px 한 줄에 들어간다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await stubNotifications(page)
  await page.goto('/apps') // 탭 구성을 심기 위해 앱 안에서 저장한 뒤 이동
  await page.evaluate(() => localStorage.setItem('mobile-tabs', JSON.stringify(['notifications', 'home', 'chat', 'mail', 'calendar'])))
  await page.goto('/notifications')
  const header = page.getByTestId('mobile-list-header')
  await expect(header.getByTestId('inbox-tab-archive')).toBeVisible()
  await expectHeaderFits(page, header, header.locator('h1'))
})
