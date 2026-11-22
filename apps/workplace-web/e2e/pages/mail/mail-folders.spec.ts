// 서버 메일함 E2E — 사이드바 트리의 기하(WP-961)와 목록 재조회 동안 빈 안내의 라이브 영역 유지(WP-1963).
// 보관 줄·안 읽은 수·묶음 노드·접기(다시 그려도 유지)·메일함 열기(목록 folderId·가져오기 POST·상태 줄)·더 가져오기·
// 모두 읽음 범위·가져오기 실패는 src/pages/mail/mailSidebar.test.tsx(vitest, WP-984)가 지킨다.
import type { Page } from '@playwright/test'

import type { MailFolderSyncResult, MailServerFolder } from '../../../src/types/mailFolder'
import type { MailUnreadCounts } from '../../../src/types/mailMessage'
import { mailAccount, mailServerFolder, summary } from '../../factories/mail.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'

const COUNTS: MailUnreadCounts = {
  classificationActive: true,
  inbox: 4,
  byCategory: { 업무: 2, 개인: 1, 알림: 1, 프로모션: 0, 뉴스레터: 0 },
  needsReply: 0,
}

/** 프로젝트 › 견적 + 이름이 사이드바 폭을 넘는 메일함. */
function folderList(): MailServerFolder[] {
  return [
    mailServerFolder({ id: 5, displayName: '프로젝트', unreadCount: 3 }),
    mailServerFolder({ id: 6, displayName: '견적', parentId: 5, unreadCount: 0 }),
    mailServerFolder({ id: 7, displayName: '아주 긴 이름의 개인 보관 메일함 — 사이드바 폭을 넘는 이름', unreadCount: 1 }),
  ]
}

async function stub(page: Page) {
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/unread-counts', COUNTS)
  await page.route((u) => u.pathname === '/api/v1/mail/accounts/1/folders', (r) => r.fulfill({ json: folderList() }))
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages', [summary({ id: 10 })])
}

test.describe('메일 사이드바 — 내 메일함 트리(WP-961)', () => {
  test('하위 메일함은 부모보다 들여 쓰고, 긴 이름 행은 사이드바 밖으로 넘치지 않는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await stub(page)
    await page.goto('/mail/1')
    const sidebar = page.getByTestId('mail-sidebar')
    await expect(page.getByTestId('mail-box-6')).toBeVisible()
    // 하위(견적)는 부모(프로젝트)보다 더 들여 쓴다.
    const leftOf = async (id: number) => (await page.getByTestId(`mail-box-${id}`).boundingBox())!.x
    expect(await leftOf(6)).toBeGreaterThan(await leftOf(5))
    // 긴 이름은 말줄임 — 행이 사이드바 밖으로 넘치지 않는다.
    const sb = (await sidebar.boundingBox())!
    const lb = (await page.getByTestId('mail-box-7').boundingBox())!
    expect(lb.x + lb.width).toBeLessThanOrEqual(sb.x + sb.width)
  })
})

test('빈 서버 메일함은 새로 고침의 목록 재조회가 끝날 때까지 가져오는 중으로 알린다(WP-1963)', { tag: '@flow' }, async ({ authenticatedPage: page }) => {
  const at = new Date().toISOString()
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString()
  const accountApi = '/api/v1/mail/accounts/1'
  const listUrl = `${accountApi}/messages`
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
  await mockApi(page, 'GET', `${accountApi}/unread-counts`, COUNTS)
  await mockApi(page, 'GET', `${accountApi}/folders`, [mailServerFolder({ id: 5, displayName: '프로젝트', folderSyncedAt: at, syncedSince: since })])
  await mockApi(page, 'POST', `${accountApi}/folders/5/sync`, {
    running: false, fetched: 0, saved: 0, seenChanged: 0, removed: 0, folderSyncedAt: at, syncedSince: since,
  } satisfies MailFolderSyncResult)

  let holdList = false
  let releaseList!: () => void
  const pendingList = new Promise<void>((resolve) => { releaseList = resolve })
  await page.route((url) => url.pathname === listUrl && url.searchParams.get('folderId') === '5', async (route) => {
    if (holdList) await pendingList
    await route.fulfill({ json: [] })
  })

  try {
    await page.goto('/mail/1?box=5')
    const empty = page.getByTestId('mail-box-empty')
    const status = empty.getByRole('status')
    const row = page.getByTestId('mail-box-status-text')
    await expect(status).toHaveText('이 메일함에 메일이 없어요')
    await expect(row).toHaveText(/^최근 90일 · .+에 가져옴$/)
    const region = await status.evaluateHandle((element) => element)

    // 새로 고침 POST는 끝내고 이어지는 목록 GET만 보류한다. 캐시의 0건을 다시 보여서는 안 된다.
    holdList = true
    const request = page.waitForRequest((req) => new URL(req.url()).pathname === listUrl)
    await page.getByTestId('mail-box-refresh').click()
    await request
    await expect(row).toHaveText('메일함을 가져오는 중…')
    await expect(status.getByText('메일함을 가져오는 중…', { exact: true })).toBeVisible()
    await expect(status.getByText('잠시만 기다려 주세요.', { exact: true })).toBeVisible()
    expect(await region.evaluate((el) => el === document.querySelector('[data-testid="mail-box-empty"] [role="status"]'))).toBe(true)

    releaseList()
    await expect(row).toHaveText(/^최근 90일 · .+에 가져옴$/)
    await expect(status).toHaveText('이 메일함에 메일이 없어요')
    expect(await region.evaluate((el) => el === document.querySelector('[data-testid="mail-box-empty"] [role="status"]'))).toBe(true)
  } finally {
    releaseList()
  }
})
