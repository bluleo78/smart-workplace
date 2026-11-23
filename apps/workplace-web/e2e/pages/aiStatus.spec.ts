// /settings/ai-status — AI 현황 개요 배선(@wiring, WP-1824).
// 지표·그래프·표의 값 계산과 모바일 배치는 src/pages/admin/aiStatus/*.test.tsx 가 지킨다.
// 여기선 사이드바 「AI 현황」 → 라우트 → 개요 API → 지표 카드가 이어지는지만 본다(데스크톱 1024).
import { createAiStatusOverview } from '../factories/aiStatus.factory'
import { createPageResponse, mockApi } from '../fixtures/api-mock'
import { expect, test } from '../fixtures/auth.fixture'

test.use({ viewport: { width: 1024, height: 768 } })

test('사이드바 「AI 현황」 으로 들어가면 개요 API 값이 지표 카드에 그려진다', { tag: '@wiring' }, async ({ adminPage: page }) => {
  // 출발 화면(/settings/users)이 부르는 구성원 목록 — 빈 페이지면 충분하다.
  await mockApi(page, 'GET', '/api/v1/members', createPageResponse([]))
  // 응답은 AiStatusOverview 타입을 적용한 팩토리로 만든다(apps/workplace-web/CLAUDE.md 「모킹 데이터는 타입 적용」)
  await mockApi(page, 'GET', '/api/v1/admin/ai-status/overview', createAiStatusOverview())

  await page.goto('/settings/users')
  await page.getByTestId('settings-sidebar').getByRole('link', { name: 'AI 현황' }).click()

  await expect(page).toHaveURL(/\/settings\/ai-status$/)
  await expect(page.getByRole('heading', { name: 'AI 현황' })).toBeVisible()
  await expect(page.getByTestId('card-runs')).toContainText('12')
})
