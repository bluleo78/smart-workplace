// 모바일 뒤로가기 히스토리 — AI 시트(router state aiOpen, 쿼리 없음)(WP-209). 모바일 AI 는 WP-191 부터 하단 시트(ai-sheet).
// 시스템 뒤로가기가 AI 만 닫고, AI 를 닫은 뒤 back 은 그 아래 화면(메일 상세 등)을 닫는다. 탭 전환은 AI 항목을 교체한다.
import { detail, mailAccount, summary } from '../../factories/mail.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, stubChat, test } from '../../fixtures/mobile.fixture'

test('탭바 AI → goBack 은 AI 만 닫고 같은 화면에 남는다', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages', [summary()])
  await page.goto('/mail/1')
  await page.getByTestId('mobile-tab-ai').tap()
  const fs = page.getByTestId('ai-sheet')
  await expect(fs).toBeVisible()
  await expect(page).toHaveURL(/\/mail\/1$/)

  await page.goBack()
  await expect(fs).toHaveCount(0)
  await expect(page).toHaveURL(/\/mail\/1$/)
  await expect(page.getByTestId('mail-list')).toBeVisible()
})

test('메일 상세 ✦ → AI 닫기(×) 후 goBack 은 상세를 닫는다(AI 항목이 남지 않음)', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages', [summary()])
  await mockApi(page, 'GET', '/api/v1/mail/messages/10', detail())
  await page.goto('/mail/1')
  await page.getByTestId('mail-row-10').click()
  await page.getByTestId('mobile-back-ai').tap()
  const fs = page.getByTestId('ai-sheet')
  await expect(fs).toBeVisible()
  await page.getByTestId('ai-panel-close').tap()
  await expect(fs).toHaveCount(0)
  await expect(page).toHaveURL(/\/mail\/1\?messageId=10$/)
  await expect(page.getByTestId('mail-detail')).toBeVisible()

  await page.goBack()
  await expect(page).toHaveURL(/\/mail\/1$/)
  await expect(page.getByTestId('mail-list')).toBeVisible()
})

test('AI 를 연 채 다른 탭 → 탭 이동, goBack 은 AI 가 아니라 원래 화면', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/')
  await page.getByTestId('mobile-tab-ai').tap()
  await expect(page.getByTestId('ai-sheet')).toBeVisible()
  await page.getByTestId('mobile-tab-chat').tap()
  await expect(page).toHaveURL(/\/chat$/)
  await expect(page.getByTestId('ai-sheet')).toHaveCount(0)

  await page.goBack()
  await expect.poll(() => new URL(page.url()).pathname).toBe('/')
  await expect(page.getByTestId('ai-sheet')).toHaveCount(0)
})

test('새로고침으로 닫힌 뒤 다시 열어도 goBack 한 번에 닫히고 화면을 떠나지 않는다', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/chat')
  await page.getByTestId('mobile-tab-ai').tap()
  await expect(page.getByTestId('ai-sheet')).toBeVisible()
  await page.reload()
  await expect(page.getByTestId('ai-sheet')).toHaveCount(0)
  await page.getByTestId('mobile-tab-ai').tap()
  await expect(page.getByTestId('ai-sheet')).toBeVisible()
  await page.goBack()
  await expect(page.getByTestId('ai-sheet')).toHaveCount(0)
  await expect(page).toHaveURL(/\/chat$/)
})

test('AI 를 연 채 새로고침 → 남은 표식이 지워져 하위 화면 back·✦ 닫기가 AI 를 되살리거나 상세를 닫지 않는다', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages', [summary()])
  await mockApi(page, 'GET', '/api/v1/mail/messages/10', detail())
  await page.goto('/mail/1')
  await page.getByTestId('mobile-tab-ai').tap()
  const fs = page.getByTestId('ai-sheet')
  await expect(fs).toBeVisible()
  await page.reload()
  await expect(fs).toHaveCount(0)

  // 하위 화면(?messageId)을 열고 back — AI 가 되살아나지 않고 목록에 남는다.
  await page.getByTestId('mail-row-10').click()
  await expect(page).toHaveURL(/\/mail\/1\?messageId=10$/)
  await page.goBack()
  await expect(page).toHaveURL(/\/mail\/1$/)
  await expect(page.getByTestId('mail-list')).toBeVisible()
  await expect(fs).toHaveCount(0)

  // 상세에서 ✦ 열기 → × 닫기는 상세를 그대로 둔다.
  await page.getByTestId('mail-row-10').click()
  await expect(page.getByTestId('mail-detail')).toBeVisible()
  await page.getByTestId('mobile-back-ai').tap()
  await expect(fs).toBeVisible()
  await page.getByTestId('ai-panel-close').tap()
  await expect(fs).toHaveCount(0)
  await expect(page).toHaveURL(/\/mail\/1\?messageId=10$/)
  await expect(page.getByTestId('mail-detail')).toBeVisible()
})
