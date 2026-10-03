// 모바일 메일 읽음 조작(WP-187) — 상세 헤더 바 "안 읽음", 터치 셸에서 행 hover 토글 미렌더. WP-214: 첫 열람 읽음 요청.
import type { Page } from '@playwright/test'

import { detail, mailAccount, summary } from '../../factories/mail.factory'
import { mockApi } from '../../fixtures/api-mock'
import { mockGatedEvents, resourceChangedFrame } from '../../fixtures/gatedEvents'
import { longPress } from '../../fixtures/mobile-chat'
import { expect, stubChat, test } from '../../fixtures/mobile.fixture'

/** 메일 화면·탭 배지에 필요한 API 를 모킹한다(mail-views.spec 의 stubMail 과 같은 구성 + 상세). */
async function stubMail(page: Page) {
  await stubChat(page)
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
  await mockApi(page, 'GET', '/api/v1/mail/unread-summary', { workUnread: 1 })
  const counts = await mockApi(page, 'GET', '/api/v1/mail/accounts/1/unread-counts', {
    classificationActive: true, inbox: 1, byCategory: { 업무: 1, 개인: 0, 알림: 0, 프로모션: 0, 뉴스레터: 0 }, needsReply: 0,
  }, { capture: true })
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages', [summary({ id: 10, seen: false })])
  const det = await mockApi(page, 'GET', '/api/v1/mail/messages/10', detail({ id: 10 }), { capture: true })
  return { counts, det }
}

test('모바일 상세 바의 안읽음 → 안읽음 API 후 목록으로 복귀, mail SSE 뒤에도 다시 읽음 처리하지 않음', async ({ authenticatedPage: page }) => {
  const { counts, det } = await stubMail(page)
  // 안읽음 뒤 서버 mail 변경 프레임이 와도 다시 읽음 처리되지 않아야 한다(Review Focus 4, WP-214).
  const events = await mockGatedEvents(page)
  const read = await mockApi(page, 'POST', '/api/v1/mail/messages/10/read', null, { capture: true })
  const unread = await mockApi(page, 'POST', '/api/v1/mail/messages/10/unread', null, { capture: true })
  await page.goto('/mail/1')
  // 터치 셸에는 hover 가 없어 행 전환 버튼을 렌더하지 않는다(R7).
  await expect(page.getByTestId('mail-row-10')).toBeVisible()
  await expect(page.getByTestId('mail-row-toggle-read-10')).toHaveCount(0)
  await page.getByTestId('mail-row-10').click()
  await expect(page.getByTestId('mail-detail')).toBeVisible()
  // 연 메일은 읽음 요청을 따로 보낸다 — 상세 조회는 읽음 처리하지 않는다(WP-214).
  await read.waitForRequest()
  expect(det.requests[0].searchParams.get('markSeen')).toBe('false')
  // 데스크톱 상세 아이콘은 모바일에서 숨기고, ✦ 바로 왼쪽(헤더 바 trailing)에 "안 읽음"을 둔다.
  await expect(page.getByTestId('mail-mark-unread')).toHaveCount(0)
  const bar = page.getByTestId('mail-back')
  await expect(bar.getByTestId('mobile-mark-unread')).toHaveText('안 읽음')
  await bar.getByTestId('mobile-mark-unread').click()
  await unread.waitForRequest()
  await expect(page.getByTestId('mail-detail')).toHaveCount(0)
  await expect(page.getByTestId('mail-list')).toBeVisible()
  await expect(page.getByTestId('mail-unread-bar-10')).toBeVisible()
  // 완료 후 안 읽은 수 재조회가 끝난 뒤를 기준으로 프레임 처리 여부(안 읽은 수 재조회)를 확인한다.
  await expect.poll(() => counts.requests.length).toBeGreaterThan(1)
  const countsBefore = counts.requests.length
  events.deliver(resourceChangedFrame({ resource: 'mail', op: 'updated', scopeType: 'USER', scopeId: 1, ids: [10], accountId: 1, messageId: 10, actorId: 99 }))
  await expect.poll(() => counts.requests.length).toBeGreaterThan(countsBefore)
  expect(read.requests).toHaveLength(1)
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

test.describe('360px 툴바 — 동기화 진행률이 보여도 넘치지 않음', () => {
  test.use({ viewport: { width: 360, height: 780 } })

  test('모두 읽음(아이콘)이 화면 안에 있고 44px 터치 영역, 다이얼로그를 닫아도 화면이 옆으로 밀리지 않음', async ({ authenticatedPage: page }) => {
    await stubMail(page)
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount({ lastSyncedAt: new Date(Date.now() - 12 * 60_000).toISOString() })])
    await mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages/unread-count', { count: 2, asOf: '2026-10-03T01:00:00Z' })
    await mockApi(page, 'POST', '/api/v1/mail/accounts/1/sync', { fetched: 0, saved: 0 })
    await mockApi(page, 'GET', '/api/v1/mail/accounts/1/sync-status', { phase: 'BODIES', total: 4567, done: 1234, running: true })
    await page.goto('/mail/1')
    const markAll = page.getByTestId('mail-mark-all-read')
    // 진행률 전 툴바 높이 — 진행률이 떠도 같아야 한다(두 줄 꺾임 없음).
    const toolbar = markAll.locator('xpath=ancestor::div[contains(@class,"border-b")][1]')
    const heightBefore = (await toolbar.boundingBox())!.height
    await page.getByTestId('mail-sync').click()
    await expect(page.getByTestId('mail-sync-progress')).toHaveText('본문 1234/4567')
    // 진행률이 보이는 동안은 동기화 시각을 숨긴다.
    await expect(page.getByTestId('mail-synced-at')).toBeHidden()
    expect((await toolbar.boundingBox())!.height).toBe(heightBefore)
    // 모바일은 아이콘만 — 접근 이름은 유지, 오른쪽 끝이 화면 안.
    await expect(markAll).toHaveAccessibleName('모두 읽음')
    const box = (await markAll.boundingBox())!
    expect(box.x + box.width).toBeLessThanOrEqual(360)
    // 히트 영역(after 확장) = 시각 36px + 사방 4px.
    const hit = await markAll.evaluate((el) => {
      const s = getComputedStyle(el, '::after')
      return { w: el.getBoundingClientRect().width - 2 * parseFloat(s.left), h: el.getBoundingClientRect().height - 2 * parseFloat(s.top) }
    })
    expect(hit.w).toBeGreaterThanOrEqual(44)
    expect(hit.h).toBeGreaterThanOrEqual(44)
    // 툴바 안쪽 상자가 넘치지 않는다(바깥 overflow 에 가려진 넘침까지).
    const inner = markAll.locator('xpath=ancestor::div[contains(@class,"pl-3")][1]')
    expect(await inner.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    // 눌러 다이얼로그를 열고 닫아도 셸이 가로로 스크롤되지 않는다(H2).
    await markAll.click()
    await expect(page.getByTestId('mail-mark-all-dialog')).toBeVisible()
    await page.getByTestId('mail-mark-all-cancel').click()
    await expect(page.getByTestId('mail-mark-all-dialog')).toHaveCount(0)
    expect((await page.getByTestId('mail-row-10').boundingBox())!.x).toBe(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
})

test('행 길게 누르기 → 답장 — 상세는 읽음 처리 없이 받고, 안 읽은 메일이면 읽음 요청을 따로 보낸다(WP-214)', async ({ authenticatedPage: page }) => {
  const { det } = await stubMail(page)
  const read = await mockApi(page, 'POST', '/api/v1/mail/messages/10/read', null, { capture: true })
  await page.goto('/mail/1')
  await expect(page.getByTestId('mail-unread-bar-10')).toBeVisible()
  await longPress(page, page.getByTestId('mail-row-10'))
  await page.getByTestId('message-action-reply').click()
  await det.waitForRequest()
  expect(det.requests[0].searchParams.get('markSeen')).toBe('false')
  await read.waitForRequest()
  await expect(page.getByTestId('mail-unread-bar-10')).toHaveCount(0)
})
