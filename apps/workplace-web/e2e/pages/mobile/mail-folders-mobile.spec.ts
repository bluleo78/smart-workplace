// 모바일 메일 메뉴 시트 — 보관·내 메일함(WP-961). 시트 안 트리, 접기는 시트를 닫지 않고, 메일함을 누르면 시트가 닫히며 그 메일함이 열린다.
import type { Page } from '@playwright/test'

import type { MailFolderSyncResult } from '../../../src/types/mailFolder'
import { mailAccount, mailServerFolder, summary } from '../../factories/mail.factory'
import { mockApi } from '../../fixtures/api-mock'
import { trackRequests } from '../../fixtures/requests'
import { expect, expectNoHorizontalOverflow, stubChat, test } from '../../fixtures/mobile.fixture'

async function stubMail(page: Page) {
  await stubChat(page)
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
  await mockApi(page, 'GET', '/api/v1/mail/unread-summary', { workUnread: 2 })
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/unread-counts', {
    classificationActive: true, inbox: 4, byCategory: { 업무: 2, 개인: 1, 알림: 1, 프로모션: 0, 뉴스레터: 0 }, needsReply: 0,
  })
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/folders', [
    mailServerFolder({ id: 1, displayName: 'Archive', role: 'ARCHIVE', unreadCount: 2 }),
    mailServerFolder({ id: 5, displayName: '프로젝트', unreadCount: 3 }),
    mailServerFolder({ id: 6, displayName: '견적 — 아주 긴 이름의 하위 메일함이 시트 폭을 넘는 경우', parentId: 5, unreadCount: 1,
      syncedSince: '2026-07-27T00:00:00Z', folderSyncedAt: '2026-10-25T00:00:00Z' }),
  ])
  const result: MailFolderSyncResult = {
    running: false, fetched: 0, saved: 0, seenChanged: 0, removed: 0,
    syncedSince: '2026-07-27T00:00:00Z', folderSyncedAt: '2026-10-25T00:00:00Z',
  }
  await page.route((u) => /^\/api\/v1\/mail\/accounts\/1\/folders\/\d+\/sync$/.test(u.pathname), (r) => r.fulfill({ json: result }))
  return mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages', [summary({ id: 10 })], { capture: true })
}

test('☰ 시트에 보관·내 메일함 트리 — 접기는 시트 유지, 메일함을 누르면 시트가 닫히고 그 메일함 목록', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  const list = await stubMail(page)
  const syncs = trackRequests(page, 'POST', '/api/v1/mail/accounts/1/folders/6/sync')
  await page.goto('/mail/1')
  await page.getByTestId('mobile-sidebar-trigger').click()
  const sheet = page.getByTestId('mobile-sidebar-sheet')
  await expect(sheet.getByTestId('mail-folder-archive')).toContainText('보관')
  await expect(sheet.getByText('내 메일함', { exact: true })).toBeVisible()
  await expect(sheet.getByTestId('mail-count-box-5')).toHaveText('3')
  await expectNoHorizontalOverflow(page)

  // 접기 ▾ — 시트는 그대로, 하위만 숨는다. 다시 펼친다.
  await sheet.getByTestId('mail-box-toggle-5').click()
  await expect(sheet).toBeVisible()
  await expect(sheet.getByTestId('mail-box-6')).toHaveCount(0)
  await sheet.getByTestId('mail-box-toggle-5').click()

  // 하위 메일함 탭 → 시트 닫힘, 주소·목록 요청·가져오기.
  await sheet.getByTestId('mail-box-6').click()
  await expect(sheet).toHaveCount(0)
  await expect(page).toHaveURL(/\/mail\/1\?box=6$/)
  await expect.poll(() => list.lastRequest()?.searchParams.get('folderId')).toBe('6')
  await syncs.waitFor()
  expect(syncs.lastUrl()!.searchParams.get('older')).toBe('false')
  await expect(page.getByTestId('page-header').locator('h1')).toContainText('견적')
  await expect(page.getByTestId('mail-box-status-text')).toHaveText(/^최근 90일 · .+에 가져옴$/)
  await expectNoHorizontalOverflow(page)
})
