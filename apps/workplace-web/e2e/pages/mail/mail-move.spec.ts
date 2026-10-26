// 메일 보관·옮기기·삭제 E2E(WP-962, 데스크톱) — 옮기기 메뉴 트리의 들여쓰기(기하)만 남긴다(@layout).
// 보관·삭제·옮기기 요청 본문(5초 뒤)·실행 취소·화면 숨김 즉시 전송·실패 되돌림·보기별 버튼 유무는
// src/pages/mail/mailReadMove.test.tsx(vitest, WP-984)가 지킨다.
import type { MailServerFolder } from '../../../src/types/mailFolder'
import { mailAccount, mailServerFolder, summary } from '../../factories/mail.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'

/** 보관(1) · 프로젝트(5) ⊃ 견적(6). */
const FOLDERS: MailServerFolder[] = [
  mailServerFolder({ id: 1, displayName: 'Archive', role: 'ARCHIVE', unreadCount: 0 }),
  mailServerFolder({ id: 5, displayName: '프로젝트', unreadCount: 0 }),
  mailServerFolder({ id: 6, displayName: '견적', parentId: 5, unreadCount: 0 }),
]

test.describe('메일 옮기기 메뉴 — 데스크톱(WP-962)', () => {
  test('옮기기 메뉴의 하위 메일함은 부모보다 더 들여 쓴다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
    await mockApi(page, 'GET', '/api/v1/mail/accounts/1/folders', FOLDERS)
    await mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages', [summary({ id: 10, subject: '보관할 메일' })])
    await page.goto('/mail/1')
    await page.getByTestId('mail-row-10').hover()
    await page.getByTestId('mail-row-move-10').click()
    const menu = page.getByTestId('mail-move-menu')
    await expect(menu.getByTestId('mail-move-target-folder-6')).toBeVisible()
    const x = async (id: number) => (await menu.getByTestId(`mail-move-target-folder-${id}`).locator('svg').boundingBox())!.x
    expect(await x(6)).toBeGreaterThan(await x(5))
  })
})
