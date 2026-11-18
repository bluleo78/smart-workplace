// WP-1690 — 모바일 알림 화면 머리(탭 루트·푸시 화면)에 「알림 | 보관함」 전환과 두 액션이 390px 한 줄에 들어가는지.
// 글자 폭·말줄임·가로 넘침은 브라우저 레이아웃이 있어야 알 수 있어(@layout) E2E 로 둔다. 전환·되돌리기 동작은
// src/pages/mobile/notificationsArchive.test.tsx 가 지킨다.
import type { Locator, Page } from '@playwright/test'

import type { NotificationResponse } from '../../../src/types/notification'
import { mockApi } from '../../fixtures/api-mock'
import { expect, expectNoHorizontalOverflow, test } from '../../fixtures/mobile.fixture'

/** 안 읽은 알림 1건 — 「모두 읽음」을 활성으로 만든다(WP-1731: 비활성 버튼이 아닌 실제로 눌리는 버튼의 hit-test 를 위해). */
const unreadNotification: NotificationResponse = {
  id: 1,
  type: 'COMMENTED',
  actorId: 9,
  actorName: '업무 비서',
  actorKind: 'AGENT',
  issueId: 7,
  projectKey: 'WP',
  issueNumber: 3,
  issueTitle: '리팩터링',
  commentId: 55,
  eventId: null,
  eventTitle: null,
  eventStartsAt: null,
  read: false,
  createdAt: new Date().toISOString(),
}

/** 알림 화면이 부르는 조회를 비워 둔다(머리 기하만 본다). unread 면 안 읽은 알림 1건·unread-count 1 을 준다. */
async function stubNotifications(page: Page, opts: { unread?: boolean } = {}) {
  await mockApi(page, 'GET', '/api/v1/notifications', opts.unread ? [unreadNotification] : [])
  await mockApi(page, 'GET', '/api/v1/notifications/archived', [])
  await mockApi(page, 'GET', '/api/v1/notifications/unread-count', { count: opts.unread ? 1 : 0 })
}

/** 탭바에 알림을 고정한 뒤(탭 루트 머리) 알림 화면으로 간다 — 탭 구성은 앱 안에서 localStorage 에 저장해야 읽힌다. */
async function gotoTabRootNotifications(page: Page) {
  await page.goto('/apps')
  await page.evaluate(() => localStorage.setItem('mobile-tabs', JSON.stringify(['notifications', 'home', 'chat', 'mail', 'calendar'])))
  await page.goto('/notifications')
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
  await gotoTabRootNotifications(page)
  const header = page.getByTestId('mobile-list-header')
  await expect(header.getByTestId('inbox-tab-archive')).toBeVisible()
  await expectHeaderFits(page, header, header.locator('h1'))
})

// WP-1731 — 360px 미만: 두 액션이 아이콘 버튼이 되고 제목은 시각적으로 숨어, 「모두 읽음」이 「보관함」 탭을 덮거나 클릭을 뺏지 않는다.

/** 좁은 폭 머리: 탭과 액션이 겹치지 않고(탭 오른쪽 x ≤ 액션 왼쪽 x), 「보관함」 탭 중심이 실제로 그 탭이며, 가로로 넘치지 않는지. */
async function expectNarrowHeaderNoOverlap(page: Page, header: Locator) {
  const tab = header.getByTestId('inbox-tab-archive')
  const tb = (await tab.boundingBox())!
  for (const id of ['inbox-mark-all', 'inbox-archive-read']) {
    const ab = (await header.getByTestId(id).boundingBox())!
    expect(tb.x + tb.width, id).toBeLessThanOrEqual(ab.x + 0.5)
  }
  // 겹침 때문에 클릭을 뺏기던 결함의 직접 재현: 탭 중심과 오른쪽 끝(−4px, 원래 「모두 읽음」이 덮던 자리)의 최상단 요소가 탭 안이어야 한다.
  const hits = await tab.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const y = r.y + r.height / 2
    const onTab = (x: number) => {
      const top = document.elementFromPoint(x, y)
      return top != null && el.contains(top)
    }
    return { 중심: onTab(r.x + r.width / 2), '오른쪽 끝': onTab(r.x + r.width - 4) }
  })
  expect(hits, '보관함 탭 중심·오른쪽 끝').toEqual({ 중심: true, '오른쪽 끝': true })
  expect(await header.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  await expectNoHorizontalOverflow(page)
}

test.describe('320px', () => {
  test.use({ viewport: { width: 320, height: 720 } })

  test('알림 푸시 화면 머리: 320px 에서 탭과 두 액션이 겹치지 않고 보관함 탭이 눌린다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await stubNotifications(page, { unread: true })
    await page.goto('/notifications')
    const header = page.getByTestId('notifications-header')
    await expect(header.getByTestId('inbox-tab-archive')).toBeVisible()
    await expect(header.getByTestId('inbox-mark-all')).toBeEnabled()
    await expectNarrowHeaderNoOverlap(page, header)
    await header.getByTestId('inbox-tab-archive').click()
    await expect(header.getByTestId('inbox-tab-archive')).toHaveAttribute('aria-selected', 'true')
    await expectNoHorizontalOverflow(page)
  })

  test('알림 탭 루트 머리: 320px 에서 탭과 두 액션이 겹치지 않는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await stubNotifications(page)
    await gotoTabRootNotifications(page)
    const header = page.getByTestId('mobile-list-header')
    await expect(header.getByTestId('inbox-tab-archive')).toBeVisible()
    await expectNarrowHeaderNoOverlap(page, header)
  })
})

test.describe('360px', () => {
  test.use({ viewport: { width: 360, height: 720 } })

  test('알림 푸시 화면 머리: 360px 에서는 글자 버튼 그대로 겹치지 않는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await stubNotifications(page)
    await page.goto('/notifications')
    const header = page.getByTestId('notifications-header')
    await expect(header.getByTestId('inbox-tab-archive')).toBeVisible()
    // 경계(360px)에서는 아직 글자 버튼이다.
    await expect(header.getByText('모두 읽음')).toBeVisible()
    await expectNarrowHeaderNoOverlap(page, header)
  })

  test('알림 탭 루트 머리: 360px 에서는 글자 버튼 그대로 겹치지 않는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await stubNotifications(page)
    await gotoTabRootNotifications(page)
    const header = page.getByTestId('mobile-list-header')
    await expect(header.getByTestId('inbox-tab-archive')).toBeVisible()
    await expect(header.getByText('모두 읽음')).toBeVisible()
    await expect(header.getByText('읽은 알림 보관')).toBeVisible()
    await expectNarrowHeaderNoOverlap(page, header)
  })
})
