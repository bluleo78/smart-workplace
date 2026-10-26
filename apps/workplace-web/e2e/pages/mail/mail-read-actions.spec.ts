// 메일 읽음 조작(WP-187) — 브라우저가 필요한 것만 남긴다: 행 토글의 투명도·키보드 포커스·터치 오탭(@input), 실제 SSE 변경 알림(@platform).
// 행 토글·열람 읽음(markSeen=false)·딥링크·WP-220 경합·상세 안읽음·롤백·모두 읽음 범위/asOf/옛 응답 버림/검색/취소는
// src/pages/mail/mailReadMove.test.tsx(vitest, WP-984)가 지킨다.
import type { Page } from '@playwright/test'

import { detail, mailAccount, summary } from '../../factories/mail.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { expectStays } from '../../fixtures/wait'
import { mockGatedEvents, resourceChangedFrame } from '../../fixtures/gatedEvents'

/** 계정·안 읽은 수·목록(10=안읽음, 11=읽음)을 모킹한다. 안 읽은 수 요청은 캡처해 갱신 여부를 본다(F25). */
async function stub(page: Page) {
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
  const counts = await mockApi(page, 'GET', '/api/v1/mail/accounts/1/unread-counts', {
    classificationActive: true, inbox: 1, byCategory: { 업무: 1, 개인: 0, 알림: 0, 프로모션: 0, 뉴스레터: 0 }, needsReply: 0,
  }, { capture: true })
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages', [summary({ id: 10, seen: false }), summary({ id: 11, seen: true })])
  return { counts }
}

test.describe('메일 읽음 조작 — 데스크톱(WP-187)', () => {

  test('토글은 hover 전엔 투명하지만 키보드 포커스로 드러나고 Enter 로 동작', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    await stub(page)
    const read = await mockApi(page, 'POST', '/api/v1/mail/messages/10/read', null, { capture: true })
    await page.goto('/mail/1')
    const toggle = page.getByTestId('mail-row-toggle-read-10')
    // display:none 이 아니라 opacity 로 숨긴다 — 탭 순서에 남아야 한다(R7).
    await expect(toggle).toHaveCSS('opacity', '0')
    await toggle.focus()
    await expect(toggle).toBeFocused()
    // 포커스되면 hover 없이도 보인다(focus-visible 등으로 불투명).
    await expect(toggle).toHaveCSS('opacity', '1')
    await page.keyboard.press('Enter')
    await read.waitForRequest()
    await expect(page.getByTestId('mail-unread-bar-10')).toHaveCount(0)
    await expect(page.getByTestId('mail-detail')).toHaveCount(0)
  })

  test('열린 메일을 hover 토글로 안읽음 → 상세는 열린 채, 변경 알림으로 상세를 다시 받아도 다시 읽음 처리하지 않는다(WP-214)', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
    const { counts } = await stub(page)
    const events = await mockGatedEvents(page)
    const det = await mockApi(page, 'GET', '/api/v1/mail/messages/10', detail({ id: 10 }), { capture: true })
    const read = await mockApi(page, 'POST', '/api/v1/mail/messages/10/read', null, { capture: true })
    const unread = await mockApi(page, 'POST', '/api/v1/mail/messages/10/unread', null, { capture: true })
    await page.goto('/mail/1')
    await page.getByTestId('mail-row-10').click()
    await expect(page.getByTestId('mail-detail')).toBeVisible()
    await read.waitForRequest()
    await expect(page.getByTestId('mail-unread-bar-10')).toHaveCount(0)
    await page.getByTestId('mail-row-10').hover()
    await expect(page.getByTestId('mail-row-toggle-read-10')).toHaveAttribute('aria-label', '안 읽음으로 표시')
    await page.getByTestId('mail-row-toggle-read-10').click()
    await unread.waitForRequest()
    await expect(page.getByTestId('mail-detail')).toBeVisible()
    await expect(page.getByTestId('mail-unread-bar-10')).toBeVisible()
    await expect.poll(() => counts.requests.length).toBeGreaterThan(1)
    const detBefore = det.requests.length
    // 서버가 안읽음 처리 뒤 보내는 mail 변경 프레임(messageId 포함 → 열린 상세를 다시 받는다).
    events.deliver(resourceChangedFrame({ resource: 'mail', op: 'updated', scopeType: 'USER', scopeId: 1, ids: [10], accountId: 1, messageId: 10, actorId: 99 }))
    await expect.poll(() => det.requests.length).toBeGreaterThan(detBefore)
    // 재조회는 읽음 처리하지 않고(markSeen=false), 같은 메일이 열려 있는 동안 읽음 요청도 다시 보내지 않는다.
    expect(det.requests.at(-1)?.searchParams.get('markSeen')).toBe('false')
    expect(read.requests).toHaveLength(1)
    await expect(page.getByTestId('mail-unread-bar-10')).toBeVisible()
  })

})

// WP-237: ≥1024 터치 태블릿 — 토글은 숨은(opacity 0) 채 남으므로 탭이 닿지 않아야 한다. 그 자리를 탭하면 행이 열린다.
test.describe('메일 행 토글 — 터치 태블릿(≥1024px) 오터치 방지', { tag: '@input' }, () => {
  test.use({ viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true })

  test('숨은 토글 자리를 탭해도 안읽음 API 는 나가지 않고 메일이 열린다', async ({ authenticatedPage: page }) => {
    await stub(page)
    await mockApi(page, 'GET', '/api/v1/mail/messages/11', { ...detail({ id: 11 }), seen: true })
    const unread = await mockApi(page, 'POST', '/api/v1/mail/messages/11/unread', null, { capture: true })
    await page.goto('/mail/1')
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)
    const toggle = page.getByTestId('mail-row-toggle-read-11')
    await expect(toggle).toHaveCSS('opacity', '0')
    await expect(toggle).toHaveCSS('pointer-events', 'none')
    // 같은 좌표를 터치스크린으로 탭(pointer-events:none 이라 행이 받는다 — actionability 우회용 force 대신).
    const tb = (await toggle.boundingBox())!
    await page.touchscreen.tap(tb.x + tb.width / 2, tb.y + tb.height / 2)
    await expect(page.getByTestId('mail-detail')).toBeVisible()
    await expectStays(page, () => unread.requests.length, 0)
  })
})
