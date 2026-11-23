// /settings/ai-status/history — AI 처리 이력 배선(@wiring, WP-1825).
// 필터·칩·시트 내용·모바일 카드는 src/pages/admin/aiStatus/*.test.tsx 가 지킨다.
// 여기선 주소(조건) → 목록 API → 행 → 클릭 → 상세 API → 시트의 오류 원문이 이어지는지만 본다(데스크톱 1024).
import { createAiRunDetail, createAiRunItem, createAiRunPage } from '../factories/aiStatus.factory'
import { mockApi } from '../fixtures/api-mock'
import { expect, test } from '../fixtures/auth.fixture'

test.use({ viewport: { width: 1024, height: 768 } })

test('처리 이력 행을 누르면 상세 시트에 오류 원문이 보인다', { tag: '@wiring' }, async ({ adminPage: page }) => {
  // 응답은 AiRunPage·AiRunDetail 타입을 적용한 팩토리로 만든다 — mockApi 는 쿼리스트링을 보지 않고 경로만 맞춘다.
  await mockApi(page, 'GET', '/api/v1/admin/ai-status/runs', createAiRunPage([createAiRunItem()]))
  await mockApi(
    page,
    'GET',
    '/api/v1/admin/ai-status/runs/0b6f0c1e-0000-4000-8000-000000000001',
    createAiRunDetail({ errorDetail: 'java.net.SocketTimeoutException: 응답 시간 초과 (30s)' }),
  )

  await page.goto('/settings/ai-status/history?kind=MAIL_CLASSIFY_BATCH&status=FAILED')

  const row = page.getByText('메일 20통 · 김민수').first()
  await expect(row).toBeVisible()
  await row.click()

  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()
  await expect(sheet).toContainText('java.net.SocketTimeoutException')
})
