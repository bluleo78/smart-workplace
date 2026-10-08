import { expect, test } from '../../fixtures/auth.fixture'
import { mockApi } from '../../fixtures/api-mock'
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory'
import { DESKTOP_WIDTHS, expectHeaderBottomAt56, expectStartAligned } from '../../fixtures/layout'
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
  // #201 — AI 위임 페이지는 어느 AI 담당인지가 핵심 → 행에 AGENT 담당자 칩(아바타+Bot 마커)이 보인다.
  const row = page.getByTestId('ai-row-31')
  await expect(row.getByTestId(`user-avatar-${agent.id}`)).toBeVisible()
  await expect(row.getByTestId(`user-avatar-${agent.id}-agent-marker`)).toBeVisible()
})

// #233-B — AI 위임 페이지에도 공통 facet. status query 가 합쳐지되 AGENT 스코프(클라이언트 필터)는 유지.
test('AI 위임 작업 — 상태 facet 이 status query 로 합쳐지고 AGENT 스코프는 유지된다', async ({
  authenticatedPage: page,
}) => {
  const cap = await mockApi(
    page,
    'GET',
    '/api/v1/me/issues',
    createIssueSearchResponse([
      createIssue({ id: 31, title: 'AI 가 담당', assignees: [agent] }),
      createIssue({ id: 32, title: '사람이 담당', assignees: [human] }),
    ]),
    { capture: true },
  )
  await page.goto('/me/ai-tasks')
  await cap.waitForRequest()
  expect(cap.lastRequest()?.searchParams.get('reporter')).toBe('me')

  await page.getByTestId('add-filter-trigger').click()
  await page.getByTestId('add-filter-facet-status').click()
  await page.getByTestId('facet-value-status-DONE').click()

  // status query 가 합쳐지고 reporter=me 는 유지된다.
  await expect.poll(() => cap.lastRequest()?.searchParams.get('status')).toBe('DONE')
  expect(cap.lastRequest()?.searchParams.get('reporter')).toBe('me')
  // AGENT 스코프(클라이언트 필터) 유지 — 사람 담당 이슈는 여전히 숨겨진다.
  await expect(page.getByTestId('ai-row-31')).toBeVisible()
  await expect(page.getByTestId('ai-row-32')).toHaveCount(0)
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

// 페이지 레이아웃 통합(Page) — AI 위임 작업도 h-14 헤더 바를 갖고, 헤더 제목·필터 바가 같은 시작선에 선다(넓은 화면 포함).
for (const width of DESKTOP_WIDTHS) {
  test.describe(`AI 위임 작업 헤더 바 @${width}px`, () => {
    test.use({ viewport: { width, height: 1000 } })

    test('제목은 헤더 바 안 h1, 헤더 하단 56px, 필터 바와 같은 x', async ({ authenticatedPage: page }) => {
      await mockApi(page, 'GET', '/api/v1/me/issues', createIssueSearchResponse([createIssue({ id: 31, assignees: [agent] })]))
      await page.goto('/me/ai-tasks')
      const header = page.getByTestId('page-header')
      const title = header.getByRole('heading', { level: 1, name: 'AI 위임 작업' })
      await expect(title).toBeVisible()
      await expect(page.getByRole('heading', { level: 1, name: 'AI 위임 작업' })).toHaveCount(1)
      await expectHeaderBottomAt56(header)
      await expectStartAligned(title, page.getByTestId('me-task-filter-bar'))
    })
  })
}
