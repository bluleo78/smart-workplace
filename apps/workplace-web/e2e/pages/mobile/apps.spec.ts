// 앱 목록(안드로이드식)·탭 편집·알림 화면(WP-121/WP-126).
// 앱 목록: 전체 앱 그리드 + 고정 표시, 길게 눌러 탭바 고정/교체, 아바타 → 계정·워크스페이스 시트.
// 브라우저가 있어야 판정되는 것만 남긴다 — 앱 목록·알림 화면 배선(@wiring), 실제 길게 누르기·키보드 Enter(@input),
// 새로고침 뒤 탭 구성 유지(@platform). 우클릭 교체·계정 시트·테마·로그아웃·탭 편집 저장 비활성·홈 멘션 셀 이동·알림 빈 상태는
// 페이지 테스트 src/pages/mobile/mobileApps.test.tsx, 데스크톱 폭 /apps → 홈은 src/pages/mobile/mobileAppsDesktop.test.tsx 가 지킨다(WP-981).
import type { Page } from '@playwright/test'

import { mockApi } from '../../fixtures/api-mock'
import { mockAgentWorkDetail } from '../../fixtures/issue-detail-mock'
import { expect, expectNoHorizontalOverflow, stubChat, test } from '../../fixtures/mobile.fixture'

const ALL_APPS = ['home', 'chat', 'mail', 'calendar', 'tasks', 'drive', 'wiki', 'contacts', 'notifications', 'settings']

/** 탭바 버튼 testid 를 화면 순서대로 — 슬롯 교체가 "같은 자리"에 들어갔는지 검증용. */
async function tabIds(page: Page) {
  // evaluateAll 은 자동 대기가 없으므로 탭바(끝 칸)가 그려진 뒤 수집한다.
  await expect(page.getByTestId('mobile-tab-apps')).toBeVisible()
  return page.getByTestId('mobile-tabbar')
    .locator('[data-testid^="mobile-tab-"]:not([data-testid^="mobile-tab-badge"]):not([data-testid="mobile-tab-ai-capsule"])')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))
}

/**
 * 실제 마우스로 길게 누른다 — 메뉴가 뜰 때까지 누른 채 기다렸다가 뗀다.
 * 떼는 순간 브라우저가 진짜 click 을 발생시키므로 "길게 누르기가 이동을 일으키지 않는다"까지 함께 검증된다.
 */
async function longPress(page: Page, testId: string) {
  await page.getByTestId(testId).hover()
  await page.mouse.down()
  await expect(page.getByTestId('apps-menu')).toBeVisible()
  await page.mouse.up()
}

test('앱 목록: 전체 10개 앱이 순서대로 보이고 탭바 고정 앱엔 표시가 붙는다', { tag: '@wiring' }, async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/apps')
  await expect(page.getByTestId('apps-app-settings')).toBeVisible()
  const ids = await page.locator('[data-testid^="apps-app-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))
  expect(ids).toEqual(ALL_APPS.map((id) => `apps-app-${id}`))
  // 넓은 폰(iPhone 13, 390pt) 기본 구성 5칸(WP-877).
  for (const id of ['home', 'chat', 'mail', 'calendar', 'drive']) await expect(page.getByTestId(`apps-pinned-${id}`)).toBeVisible()
  await expect(page.getByTestId('apps-pinned-tasks')).toHaveCount(0)
  await expect(page.getByTestId('apps-app-home')).toHaveAccessibleName(/탭바에 고정됨/)
  // 탭바 끝 칸은 "앱" 이고 /apps 에서 활성.
  await expect(page.getByTestId('mobile-tab-apps')).toHaveAttribute('aria-current', 'page')
  await expect(page.getByText('길게 눌러 탭바에 고정')).toBeVisible()
  // 터치 타깃 44px 이상.
  const box = (await page.getByTestId('apps-app-calendar').boundingBox())!
  expect(box.height).toBeGreaterThanOrEqual(44)
  expect(box.width).toBeGreaterThanOrEqual(44)
  await expectNoHorizontalOverflow(page)
  await page.getByTestId('apps-app-calendar').click()
  await expect(page).toHaveURL(/\/calendar$/)
})

test('길게 누르기: 작업을 메일 대신 고정하면 3번째 칸에 들어가고 새로고침 후에도 유지', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/apps')
  await longPress(page, 'apps-app-tasks')
  // 길게 누르기는 이동을 일으키지 않는다(뗄 때의 click 억제).
  await expect(page).toHaveURL(/\/apps$/)
  await expect(page.getByTestId('apps-swap')).toHaveCount(0)
  await page.getByTestId('apps-pin').click()
  await expect(page.getByText('탭바가 꽉 찼어요 — 바꿀 탭 선택')).toBeVisible()
  await expect(page.getByTestId('apps-replace-mail')).toHaveText(/메일 대신/)
  await expectNoHorizontalOverflow(page)
  await page.getByTestId('apps-replace-mail').click()
  await expect(page.getByTestId('apps-menu')).toHaveCount(0)
  await expect(page.getByText('작업을 탭바에 고정했어요')).toBeVisible()
  const pinned = ['mobile-tab-home', 'mobile-tab-chat', 'mobile-tab-tasks', 'mobile-tab-ai', 'mobile-tab-calendar', 'mobile-tab-drive', 'mobile-tab-apps']
  expect(await tabIds(page)).toEqual(pinned)
  await expect(page.getByTestId('apps-pinned-tasks')).toBeVisible()
  await expect(page.getByTestId('apps-pinned-mail')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
  await page.reload()
  expect(await tabIds(page)).toEqual(pinned)
  await expect(page).toHaveURL(/\/apps$/)
})

test('길게 누르기 메뉴의 열기는 앱으로 이동, 설정은 길게 눌러도 메뉴가 없다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/apps')
  // 설정은 고정 불가 — 우클릭해도 메뉴가 뜨지 않는다.
  await page.getByTestId('apps-app-settings').click({ button: 'right' })
  await expect(page.getByTestId('apps-menu')).toHaveCount(0)
  await expect(page).toHaveURL(/\/apps$/)
  await longPress(page, 'apps-app-wiki')
  await expectNoHorizontalOverflow(page)
  await page.getByTestId('apps-open').click()
  await expect(page).toHaveURL(/\/wiki$/)
})

test('우클릭으로 메뉴를 연 뒤 닫고 키보드 Enter 로 누르면 정상 이동(클릭 억제가 새지 않음)', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/apps')
  const cal = page.getByTestId('apps-app-calendar')
  await cal.click({ button: 'right' })
  await expect(page.getByTestId('apps-menu')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('apps-menu')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
  await cal.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/calendar$/)
})

test('탭 편집: 메일을 빼고 작업을 넣으면 새로고침 후에도 유지', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/apps/tabs')
  // 넓은 폰은 5칸을 고른다(WP-877).
  await expect(page.getByText('나머지 5칸을 고르세요')).toBeVisible()
  await expect(page.getByTestId('tab-edit-slot-4')).toBeVisible()
  await page.getByTestId('tab-edit-remove-2').click() // mail
  await page.getByTestId('tab-edit-add-tasks').click()
  await page.getByTestId('tab-edit-save').click()
  await expect(page).toHaveURL(/\/apps$/)
  await page.reload()
  await expect(page.getByTestId('mobile-tab-tasks')).toBeVisible()
  await expect(page.getByTestId('mobile-tab-mail')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})

// WP-452 — 모바일 알림 화면에서도 이슈 챗 AI 질문 알림을 같은 행으로 보이고, 누르면 이슈 챗 드로워가 열린 이슈로 간다.
test('알림 화면: 이슈 챗 AI 질문 알림 → 이슈 챗 드로워로 이동 (WP-452)', { tag: '@wiring' }, async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/notifications/unread-count', { count: 1 })
  await mockApi(page, 'GET', '/api/v1/notifications', [
    {
      id: 31,
      type: 'AI_QUESTION',
      actorId: 9,
      actorName: '개발 에이전트',
      actorKind: 'AGENT',
      issueId: 7,
      projectKey: 'WP',
      issueNumber: 12,
      issueTitle: '알림 연결',
      commentId: null,
      eventId: null,
      eventTitle: null,
      eventStartsAt: null,
      read: false,
      createdAt: new Date().toISOString(),
    },
  ])
  await mockApi(page, 'POST', '/api/v1/notifications/31/read', {}, { status: 204 })
  await mockAgentWorkDetail(page, undefined)
  await page.goto('/notifications')
  const item = page.getByTestId('inbox-item').first()
  await expect(item).toContainText('님이 이슈 챗에서 질문했습니다')
  await expectNoHorizontalOverflow(page)
  await item.click()
  await expect(page).toHaveURL(/\/projects\/WP\/issues\/12\?chat=1$/)
  await expect(page.getByTestId('issue-chat-drawer')).toBeVisible()
})
