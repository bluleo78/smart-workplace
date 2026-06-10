import { expect, test } from '../../fixtures/auth.fixture'
import { mockApi } from '../../fixtures/api-mock'
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory'
import type { UserSummary } from '../../../src/types/user'

const human: UserSummary = { id: 1, username: 'kim', name: '김사람', kind: 'HUMAN' }
const agent: UserSummary = { id: 9, username: 'claude', name: 'Claude', kind: 'AGENT' }

test('AI 위임 작업 — reporter=me 중 담당이 AGENT 인 이슈만 표시', async ({
  authenticatedPage: page,
}) => {
  const cap = await mockApi(
    page,
    'GET',
    '/api/v1/me/issues',
    createIssueSearchResponse([
      createIssue({ id: 31, title: 'AI 가 담당', assignees: [agent] }),
      createIssue({ id: 32, title: '사람이 담당', assignees: [human] }),
      createIssue({ id: 33, title: '담당 없음', assignees: [] }),
    ]),
    { capture: true },
  )
  await page.goto('/me/ai-tasks')

  const req = await cap.waitForRequest()
  expect(req.searchParams.get('reporter')).toBe('me')
  await expect(page.getByTestId('ai-row-31')).toContainText('AI 가 담당')
  await expect(page.getByTestId('ai-row-32')).toHaveCount(0)
  await expect(page.getByTestId('ai-row-33')).toHaveCount(0)
})

test('AI 위임 작업 — 비어 있으면 안내 문구', async ({ authenticatedPage: page }) => {
  await mockApi(
    page,
    'GET',
    '/api/v1/me/issues',
    createIssueSearchResponse([createIssue({ id: 41, assignees: [human] })]),
  )
  await page.goto('/me/ai-tasks')
  // DS §2.5 빈 상태 — [아이콘(svg)+제목+설명] 3요소 검증(#209).
  const empty = page.getByTestId('ai-row-empty')
  await expect(empty).toBeVisible()
  await expect(empty.locator('svg')).toBeVisible()
  await expect(empty).toContainText('AI에게 맡긴 작업이 아직 없어요')
  await expect(empty).toContainText('이슈를 만들 때 담당자를 AI로 지정하면 여기에 표시됩니다.')
})
