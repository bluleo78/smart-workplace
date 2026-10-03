// 메일 읽음 조작(WP-187) — 데스크톱 행 hover 토글·상세 안읽음.
import type { Page } from '@playwright/test'

import { detail, mailAccount, summary } from '../../factories/mail.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'

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
  test('행 hover ✉ → 읽음 API, 행이 읽음 스타일로(열리지 않음), 안 읽은 수 재조회', async ({ authenticatedPage: page }) => {
    const { counts } = await stub(page)
    const read = await mockApi(page, 'POST', '/api/v1/mail/messages/10/read', null, { capture: true })
    await page.goto('/mail/1')
    await counts.waitForRequest()
    await expect(page.getByTestId('mail-unread-bar-10')).toBeVisible()
    const before = counts.requests.length
    await page.getByTestId('mail-row-10').hover()
    await expect(page.getByTestId('mail-row-toggle-read-10')).toHaveAttribute('aria-label', '읽음으로 표시')
    await page.getByTestId('mail-row-toggle-read-10').click()
    await read.waitForRequest()
    await expect(page.getByTestId('mail-unread-bar-10')).toHaveCount(0)
    // 토글은 행 열기와 분리 — 선택(bg-accent)도 상세도 생기지 않는다.
    await expect(page.getByTestId('mail-row-10')).not.toHaveClass(/bg-accent(?!\/)/)
    await expect(page.getByTestId('mail-detail-empty')).toBeVisible()
    await expect(page.getByTestId('mail-detail')).toHaveCount(0)
    // 완료 후 안 읽은 수를 서버에서 다시 받는다(F25).
    await expect.poll(() => counts.requests.length).toBeGreaterThan(before)
  })

  test('읽은 행 토글 → 안읽음 API', async ({ authenticatedPage: page }) => {
    await stub(page)
    const unread = await mockApi(page, 'POST', '/api/v1/mail/messages/11/unread', null, { capture: true })
    await page.goto('/mail/1')
    await page.getByTestId('mail-row-11').hover()
    await expect(page.getByTestId('mail-row-toggle-read-11')).toHaveAttribute('aria-label', '안읽음으로 표시')
    await page.getByTestId('mail-row-toggle-read-11').click()
    await unread.waitForRequest()
    await expect(page.getByTestId('mail-unread-bar-11')).toBeVisible()
  })

  test('토글은 hover 전엔 투명하지만 키보드 포커스로 드러나고 Enter 로 동작', async ({ authenticatedPage: page }) => {
    await stub(page)
    const read = await mockApi(page, 'POST', '/api/v1/mail/messages/10/read', null, { capture: true })
    await page.goto('/mail/1')
    const toggle = page.getByTestId('mail-row-toggle-read-10')
    // display:none 이 아니라 opacity 로 숨긴다 — 탭 순서에 남아야 한다(R7).
    await expect(toggle).toHaveCSS('opacity', '0')
    await toggle.focus()
    await expect(toggle).toBeFocused()
    await page.keyboard.press('Enter')
    await read.waitForRequest()
    await expect(page.getByTestId('mail-unread-bar-10')).toHaveCount(0)
    await expect(page.getByTestId('mail-detail')).toHaveCount(0)
  })

  test('상세 안읽음 → API 후 상세 닫힘, 상세 재조회 없음', async ({ authenticatedPage: page }) => {
    await stub(page)
    const det = await mockApi(page, 'GET', '/api/v1/mail/messages/10', { ...detail({ id: 10 }), seen: true }, { capture: true })
    const unread = await mockApi(page, 'POST', '/api/v1/mail/messages/10/unread', null, { capture: true })
    await page.goto('/mail/1')
    await page.getByTestId('mail-row-10').click()
    await expect(page.getByTestId('mail-detail')).toBeVisible()
    // 열람으로 읽음 처리된 뒤에 누른다.
    await expect(page.getByTestId('mail-unread-bar-10')).toHaveCount(0)
    const before = det.requests.length
    await page.getByTestId('mail-mark-unread').click()
    await unread.waitForRequest()
    await expect(page.getByTestId('mail-detail')).toHaveCount(0)
    await expect(page.getByTestId('mail-unread-bar-10')).toBeVisible()
    // 이 단언은 "닫으면서 상세를 다시 부르지 않는다"만 확인한다. SSE mail 이벤트에 의한 무효화 경로는 E2E 에서 스트림이 막혀 있어 직접 검증하지 못한다 —
    // 그 경로의 보호는 설계(선택 해제로 상세 쿼리 비활성화 → 비활성 쿼리는 무효화돼도 재조회되지 않음)에 의존한다. 행 상태 확인 뒤에 단언(F18).
    expect(det.requests.length).toBe(before)
  })

  test('열린 메일을 hover 토글로 안읽음 → 상세도 닫힘(R5)', async ({ authenticatedPage: page }) => {
    await stub(page)
    const det = await mockApi(page, 'GET', '/api/v1/mail/messages/10', { ...detail({ id: 10 }), seen: true }, { capture: true })
    const unread = await mockApi(page, 'POST', '/api/v1/mail/messages/10/unread', null, { capture: true })
    await page.goto('/mail/1')
    await page.getByTestId('mail-row-10').click()
    await expect(page.getByTestId('mail-detail')).toBeVisible()
    await expect(page.getByTestId('mail-unread-bar-10')).toHaveCount(0)
    const before = det.requests.length
    await page.getByTestId('mail-row-10').hover()
    await expect(page.getByTestId('mail-row-toggle-read-10')).toHaveAttribute('aria-label', '안읽음으로 표시')
    await page.getByTestId('mail-row-toggle-read-10').click()
    await unread.waitForRequest()
    await expect(page.getByTestId('mail-detail')).toHaveCount(0)
    await expect(page.getByTestId('mail-unread-bar-10')).toBeVisible()
    expect(det.requests.length).toBe(before)
  })

  test('토글 실패 → 에러 토스트, 원래 상태로 되돌림', async ({ authenticatedPage: page }) => {
    await stub(page)
    const read = await mockApi(page, 'POST', '/api/v1/mail/messages/10/read', { message: 'boom' }, { status: 500, capture: true })
    await page.goto('/mail/1')
    await page.getByTestId('mail-row-10').hover()
    await page.getByTestId('mail-row-toggle-read-10').click()
    await read.waitForRequest()
    // 실패 토스트가 뜬 뒤(낙관 갱신 롤백 완료) 안읽음 막대가 다시 보인다.
    await expect(page.getByText('boom')).toBeVisible()
    await expect(page.getByTestId('mail-unread-bar-10')).toBeVisible()
    await expect(page.getByTestId('mail-row-toggle-read-10')).toHaveAttribute('aria-label', '읽음으로 표시')
  })
})
