// 모바일 메일 읽음 조작(WP-187) — 상세 헤더 바 "안읽음", 터치 셸에서 행 hover 토글 미렌더.
import type { Page } from '@playwright/test'

import { detail, mailAccount, summary } from '../../factories/mail.factory'
import { mockApi } from '../../fixtures/api-mock'
import { longPress } from '../../fixtures/mobile-chat'
import { expect, stubChat, test } from '../../fixtures/mobile.fixture'

/** 메일 화면·탭 배지에 필요한 API 를 모킹한다(mail-views.spec 의 stubMail 과 같은 구성 + 상세). */
async function stubMail(page: Page) {
  await stubChat(page)
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
  await mockApi(page, 'GET', '/api/v1/mail/unread-summary', { workUnread: 1 })
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/unread-counts', {
    classificationActive: true, inbox: 1, byCategory: { 업무: 1, 개인: 0, 알림: 0, 프로모션: 0, 뉴스레터: 0 }, needsReply: 0,
  })
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages', [summary({ id: 10, seen: false })])
  await mockApi(page, 'GET', '/api/v1/mail/messages/10', { ...detail({ id: 10 }), seen: true })
}

test('모바일 상세 바의 안읽음 → 안읽음 API 후 목록으로 복귀', async ({ authenticatedPage: page }) => {
  await stubMail(page)
  const unread = await mockApi(page, 'POST', '/api/v1/mail/messages/10/unread', null, { capture: true })
  await page.goto('/mail/1')
  // 터치 셸에는 hover 가 없어 행 전환 버튼을 렌더하지 않는다(R7).
  await expect(page.getByTestId('mail-row-10')).toBeVisible()
  await expect(page.getByTestId('mail-row-toggle-read-10')).toHaveCount(0)
  await page.getByTestId('mail-row-10').click()
  await expect(page.getByTestId('mail-detail')).toBeVisible()
  // 데스크톱 상세 아이콘은 모바일에서 숨기고, ✦ 바로 왼쪽(헤더 바 trailing)에 "안읽음"을 둔다.
  await expect(page.getByTestId('mail-mark-unread')).toHaveCount(0)
  const bar = page.getByTestId('mail-back')
  await expect(bar.getByTestId('mobile-mark-unread')).toHaveText('안읽음')
  await bar.getByTestId('mobile-mark-unread').click()
  await unread.waitForRequest()
  await expect(page.getByTestId('mail-detail')).toHaveCount(0)
  await expect(page.getByTestId('mail-list')).toBeVisible()
  await expect(page.getByTestId('mail-unread-bar-10')).toBeVisible()
})

test('행 길게 누르기 → 메뉴의 읽음으로 표시 → 읽음 API, 상세는 열리지 않음', async ({ authenticatedPage: page }) => {
  await stubMail(page)
  const read = await mockApi(page, 'POST', '/api/v1/mail/messages/10/read', null, { capture: true })
  await page.goto('/mail/1')
  await expect(page.getByTestId('mail-unread-bar-10')).toBeVisible()
  await longPress(page, page.getByTestId('mail-row-10'))
  await expect(page.getByTestId('message-action-sheet')).toBeVisible()
  // 이모지 줄 없이 메일 작업만 — 첫 항목이 읽음 전환.
  await expect(page.getByTestId('message-action-react-more')).toHaveCount(0)
  await expect(page.getByTestId('message-action-toggle-read')).toHaveText('읽음으로 표시')
  await expect(page.getByTestId('message-action-reply')).toBeVisible()
  await expect(page.getByTestId('message-action-forward')).toBeVisible()
  await page.getByTestId('message-action-toggle-read').click()
  await read.waitForRequest()
  await expect(page.getByTestId('mail-unread-bar-10')).toHaveCount(0)
  await expect(page.getByTestId('mail-detail')).toHaveCount(0)
})

test('모바일 모두 읽음 다이얼로그 — 폭을 채운 세로 버튼, 확인이 위', async ({ authenticatedPage: page }) => {
  await stubMail(page)
  // 실사용처럼 "N분 전 동기화됨"(가장 짧은 "동기화 안 됨"보다 김)이 있어도 툴바가 넘치지 않는지 본다.
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount({ lastSyncedAt: new Date(Date.now() - 12 * 60_000).toISOString() })])
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages/unread-count', { count: 2, asOf: '2026-10-03T01:00:00Z' })
  await page.goto('/mail/1')
  await expect(page.getByTestId('mail-synced-at')).toContainText('분 전 동기화됨')
  // 툴바 버튼도 토글과 같은 터치 규격(시각 36px + 히트 영역 확장).
  await expect(page.getByTestId('mail-mark-all-read')).toBeEnabled()
  const btn = await page.getByTestId('mail-mark-all-read').boundingBox()
  expect(btn!.height).toBeGreaterThanOrEqual(36)
  // 토글과 나란히 놓여도 툴바가 화면 밖으로 넘치지 않는다.
  expect(btn!.x + btn!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  await page.getByTestId('mail-mark-all-read').click()
  await expect(page.getByTestId('mail-mark-all-dialog')).toBeVisible()
  const dialog = await page.getByTestId('mail-mark-all-dialog').boundingBox()
  const confirm = await page.getByTestId('mail-mark-all-confirm').boundingBox()
  const cancel = await page.getByTestId('mail-mark-all-cancel').boundingBox()
  expect(confirm!.y).toBeLessThan(cancel!.y)
  expect(confirm!.height).toBeGreaterThanOrEqual(44)
  expect(cancel!.height).toBeGreaterThanOrEqual(44)
  // 폭을 채운다 — 두 버튼 폭이 같고 다이얼로그 폭의 대부분을 차지한다.
  expect(Math.abs(confirm!.width - cancel!.width)).toBeLessThan(1)
  expect(confirm!.width).toBeGreaterThan(dialog!.width * 0.7)
})
