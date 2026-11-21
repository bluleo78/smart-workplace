// 메일 휴지통 「완전히 삭제」 초점 E2E(WP-1856) — 키보드로 확인 창을 거치는 동안 초점이 body 로 떨어지지 않는지(@input).
// 처리 중에는 「완전히 삭제」 단추가 disabled 라 초점을 받지 못한다. 확인 창이 닫히며 복원할 때 단추가 아니라
// 늘 감싸고 있는 이유 감싸개(mail-permanent-delete-reason, tabindex 0)가 대신 받아야 하고, 처리가 끝나 단추가 켜지면
// 초점이 단추로 돌아온다. 실제 브라우저의 disabled 요소 초점 규칙이 필요해 jsdom 이 아닌 Playwright 로 본다.
import type { Page } from '@playwright/test'

import type { MailMoveResponse } from '../../../src/types/mailFolder'
import type { MailUnreadCounts } from '../../../src/types/mailMessage'
import { detail, mailAccount, mailServerFolder, summary } from '../../factories/mail.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'

const COUNTS: MailUnreadCounts = {
  classificationActive: false,
  inbox: 0,
  byCategory: { 업무: 0, 개인: 0, 알림: 0, 프로모션: 0, 뉴스레터: 0 },
  needsReply: 0,
}

/**
 * 휴지통(id 9) 보기와 메일 10 상세를 목으로 깔고, 완전 삭제 POST 를 붙잡는 함수를 돌려준다.
 * release() 를 부르면 붙잡힌 응답이 ok=false 로 풀려 상세가 그대로 남는다.
 */
async function stubTrash(page: Page) {
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/unread-counts', COUNTS)
  await page.route(
    (u) => u.pathname === '/api/v1/mail/accounts/1/folders',
    (r) => r.fulfill({ json: [mailServerFolder({ id: 1, displayName: 'Archive', role: 'ARCHIVE' }), mailServerFolder({ id: 9, displayName: 'Trash', role: 'TRASH', totalCount: 3 })] }),
  )
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages', [summary({ id: 10, seen: true, subject: '지운 메일' })])
  await mockApi(page, 'GET', '/api/v1/mail/messages/10', detail({ id: 10, seen: true, subject: '지운 메일' }))
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/trash/empty', { state: 'IDLE', total: null, deleted: 0, failed: 0, startedAt: null, finishedAt: null, errorCode: null, error: null })
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/trash/count', { count: 3 })
  await mockApi(page, 'POST', '/api/v1/mail/accounts/1/folders/9/sync', { running: false, fetched: 0, saved: 0, seenChanged: 0, removed: 0, syncedSince: null, folderSyncedAt: null })

  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let posted = 0
  await page.route(
    (u) => u.pathname === '/api/v1/mail/accounts/1/messages/permanent-delete',
    async (r) => {
      posted += 1
      await gate
      const body: MailMoveResponse = { results: [{ messageId: 10, ok: false, error: '메일 서버에서 지우지 못했습니다' }] }
      await r.fulfill({ json: body })
    },
  )
  return { release: () => release(), posted: () => posted }
}

test.describe('메일 휴지통 완전 삭제 초점(WP-1856)', () => {
  test('키보드로 확인 → 처리 중 Esc 로 창을 닫아도 초점이 body 로 빠지지 않고 감싸개가 받으며, 처리가 끝나면 단추로 돌아온다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    const gate = await stubTrash(page)
    await page.goto('/mail/1?box=9')
    await page.getByTestId('mail-row-10').click()
    const button = page.getByTestId('mail-permanent-delete')
    await expect(button).toBeVisible()

    // 키보드: 단추에 초점 → Enter 로 확인 창 → 「삭제」에 초점이 있는 채 Enter(POST 는 붙잡힘).
    await button.focus()
    await page.keyboard.press('Enter')
    const ok = page.getByTestId('mail-permanent-delete-confirm-ok')
    await expect(ok).toBeVisible()
    await ok.focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => gate.posted()).toBe(1)
    // 처리 중에는 단추가 꺼져 있다.
    await expect(button).toBeDisabled()

    // Esc 로 창을 닫는다 — 막힌 단추 대신 이유 감싸개가 초점을 받아야 한다.
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('mail-permanent-delete-confirm')).toHaveCount(0)
    await expect(page.getByTestId('mail-permanent-delete-reason')).toBeFocused()
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false)

    // 응답을 ok=false 로 풀면 상세가 남고 초점이 단추로 돌아온다.
    gate.release()
    await expect(button).toBeEnabled()
    await expect(button).toBeFocused()
  })

  test('마우스만으로 열고 확인하고 「취소」로 닫아도 툴팁이 억지로 뜨지 않는다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    // 열린 동안 포인터만 썼으면(마지막 입력 수단이 마우스) 닫아도 감싸개로 옮기지 않는다(초점은 body — 설계상 트레이드오프). 여기서는 포인터만으로 끝까지 본다.
    const gate = await stubTrash(page)
    await page.goto('/mail/1?box=9')
    await page.getByTestId('mail-row-10').click()
    await page.getByTestId('mail-permanent-delete').click()
    await page.getByTestId('mail-permanent-delete-confirm-ok').click()
    await expect.poll(() => gate.posted()).toBe(1)
    // 처리 중에 「취소」를 눌러 창을 닫는다(처리 중에도 취소는 켜져 있다).
    await page.getByTestId('mail-permanent-delete-confirm').getByRole('button', { name: '취소' }).click()
    await expect(page.getByTestId('mail-permanent-delete-confirm')).toHaveCount(0)
    // 마우스 사용이라 초점 복원이 감싸개 툴팁을 강제로 띄우지 않는다.
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    gate.release()
    await expect(page.getByTestId('mail-permanent-delete')).toBeEnabled()
    await expect(page.getByRole('tooltip')).toHaveCount(0)
  })
})
