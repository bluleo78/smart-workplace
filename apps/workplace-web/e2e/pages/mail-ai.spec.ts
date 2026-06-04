// 메일 AI 비서 E2E — 배지/요약/답장 초안. 백엔드 없이 page.route 모킹.
import { detail, mailAccount, summary } from '../factories/mail.factory'
import { mockApi } from '../fixtures/api-mock'
import { expect, test } from '../fixtures/auth.fixture'

test.describe('메일 AI 비서', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount({ aiEnabled: true })])
  })

  test('목록 배지 — 카테고리 칩 + 답장필요 점', async ({ authenticatedPage: page }) => {
    await page.route(
      (u) => u.pathname === '/api/v1/mail/accounts/1/messages',
      (route) => route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify([summary({ id: 7, aiCategory: '업무', aiNeedsReply: true })]) }),
    )
    await page.goto('/mail/1')
    await expect(page.getByTestId('mail-badge-category-7')).toHaveText('업무')
    await expect(page.getByTestId('mail-badge-needsreply-7')).toBeVisible()
  })

  test('요약 스트립 — 열람 시 자동 로드', async ({ authenticatedPage: page }) => {
    await page.route(
      (u) => u.pathname === '/api/v1/mail/accounts/1/messages',
      (route) => route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify([summary({ id: 7 })]) }),
    )
    await mockApi(page, 'GET', '/api/v1/mail/messages/7', detail({ id: 7, bodyText: '본문' }))
    await mockApi(page, 'GET', '/api/v1/mail/messages/7/summary', { summary: '• 자동요약' })
    await page.goto('/mail/1')
    await page.getByTestId('mail-row-7').click()
    await expect(page.getByTestId('mail-ai-summary')).toContainText('자동요약')
  })

  test('AI 답장 초안 → 작성 도크 본문 프리필', async ({ authenticatedPage: page }) => {
    await page.route((u) => u.pathname === '/api/v1/mail/accounts/1/messages',
      (route) => route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify([summary({ id: 7, fromAddress: 'alice@example.com' })]) }))
    await mockApi(page, 'GET', '/api/v1/mail/messages/7', detail({ id: 7, fromAddress: 'alice@example.com', bodyText: '원문' }))
    await mockApi(page, 'GET', '/api/v1/mail/messages/7/summary', { summary: '• 요약' })
    await page.route((u) => u.pathname === '/api/v1/mail/messages/7/reply-draft',
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ draftBody: 'AI가 작성한 답장' }) }))
    await page.goto('/mail/1')
    await page.getByTestId('mail-row-7').click()
    await page.getByTestId('mail-ai-reply-draft').click()
    await expect(page.getByTestId('mail-compose-dock')).toBeVisible()
    await expect(page.getByTestId('mail-composer-body')).toContainText('AI가 작성한 답장')
  })
})
