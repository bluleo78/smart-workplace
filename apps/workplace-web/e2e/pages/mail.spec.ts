// 메일 상세 E2E — AI 요약 카드 + 생성 중 스켈레톤.
import { detail as mailDetail, mailAccount, summary as mailSummary } from '../factories/mail.factory'
import { mockApi } from '../fixtures/api-mock'
import { expect, test } from '../fixtures/auth.fixture'

/**
 * 메일 페이지 공통 모킹 + 첫 번째 메일 상세 열기.
 * aiEnabled: 계정의 AI 사용 여부.
 */
async function openFirstMail(page: import('@playwright/test').Page, aiEnabled = true) {
  // 계정 목록: AI 사용 상태 제어.
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount({ aiEnabled })])
  // 동기화 상태.
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/sync-status', { running: false })
  // 메시지 목록 — 1건.
  await page.route(
    (url) => url.pathname === '/api/v1/mail/accounts/1/messages',
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([mailSummary()]) }),
  )
  // 메시지 상세.
  await mockApi(page, 'GET', '/api/v1/mail/messages/10', mailDetail())

  await page.goto('/mail/1')
  // 첫 메일 행 클릭.
  await page.getByTestId('mail-row-10').click()
  // 상세 패널 노출 대기.
  await expect(page.getByTestId('mail-detail')).toBeVisible()
}

test.describe('메일 AI 요약', () => {
  test(
    'AI 요약 카드와 생성중 스켈레톤',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      // 요약 응답을 지연시켜 로딩 상태 노출.
      let release!: () => void
      const gate = new Promise<void>((r) => (release = r))
      await page.route('**/mail/messages/*/summary', async (route) => {
        await gate
        await route.fulfill({ json: { summary: '• 핵심 1\n• 핵심 2' } })
      })

      await openFirstMail(page, true)

      // 요약 응답 전 — 로딩 스켈레톤이 표시되어야 함.
      await expect(page.getByTestId('mail-ai-summary-loading')).toBeVisible()

      // 응답 해제 → 요약 텍스트로 대체.
      release()
      await expect(page.getByTestId('mail-ai-summary')).toContainText('핵심 1')
      await expect(page.getByTestId('mail-ai-summary-loading')).toHaveCount(0)
    },
  )

  test('AI OFF 계정은 요약 카드 미표시', async ({ authenticatedPage: page }) => {
    // AI 비활성 계정 — 요약 API 호출 없음.
    await mockApi(page, 'GET', '/api/v1/mail/messages/10/summary', { summary: null })
    await openFirstMail(page, false)
    await expect(page.getByTestId('mail-ai-summary')).toHaveCount(0)
    await expect(page.getByTestId('mail-ai-summary-loading')).toHaveCount(0)
  })
})
