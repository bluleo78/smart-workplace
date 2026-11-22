// 서버 메일함(보관·내 메일함) E2E(WP-961) — 사이드바 트리의 기하(하위 들여쓰기·긴 이름이 사이드바를 넘지 않음)만 남긴다(@layout).
// 보관 줄·안 읽은 수·묶음 노드·접기(다시 그려도 유지)·메일함 열기(목록 folderId·가져오기 POST·상태 줄)·더 가져오기·
// 모두 읽음 범위·가져오기 실패는 src/pages/mail/mailSidebar.test.tsx(vitest, WP-984)가 지킨다.
import type { Page } from '@playwright/test'

import type { MailServerFolder } from '../../../src/types/mailFolder'
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
