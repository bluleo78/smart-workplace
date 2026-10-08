// 모바일 내 작업·AI 위임 작업 스모크(페이지 레이아웃 통합) — 390px 에서 제목 h1 한 번, 목록 행 노출,
// Page.Body 스크롤 영역이 실제로 스크롤되어 뒤쪽 행이 보이는지 확인한다(헤더 바를 빼도 본문 스크롤이 살아 있어야 함).
import type { Page } from '@playwright/test'

import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, expectNoHorizontalOverflow, stubChat, test } from '../../fixtures/mobile.fixture'
import type { UserSummary } from '../../../src/types/user'

const agent: UserSummary = { id: 9, username: 'claude', name: 'Claude', kind: 'AGENT' }
// 한 화면(844px)을 넘기도록 충분히 많은 행.
const ISSUES = Array.from({ length: 30 }, (_, i) =>
  createIssue({ id: 100 + i, title: `모바일 작업 ${i + 1}`, assignees: [agent] }),
)
const LAST_ID = 100 + ISSUES.length - 1

async function setup(page: Page, path: string) {
  await stubChat(page)
  await mockApi(page, 'GET', '/api/v1/me/issues', createIssueSearchResponse(ISSUES))
  await page.goto(path)
}

/** 제목 h1 이 한 번만 있고, 첫 행이 보이며, 본문 스크롤 영역을 내리면 마지막 행이 보인다. */
async function expectSmoke(page: Page, title: string, rowPrefix: string) {
  await expect(page.getByRole('heading', { level: 1, name: title })).toHaveCount(1)
  await expect(page.getByTestId(`${rowPrefix}-100`)).toBeVisible()
  const last = page.getByTestId(`${rowPrefix}-${LAST_ID}`)
  await expect(last).not.toBeInViewport()
  const body = page.getByTestId('page-body')
  await body.evaluate((el) => el.scrollTo(0, el.scrollHeight))
  await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  await expect(last).toBeInViewport()
  await expectNoHorizontalOverflow(page)
}

test('내 작업 — 제목 h1 한 번, 행 노출, 본문 스크롤로 마지막 행까지 보인다', async ({ authenticatedPage: page }) => {
  await setup(page, '/me/tasks/assigned')
  await expectSmoke(page, '내 작업', 'assigned-row')
})

test('AI 위임 작업 — 제목 h1 한 번, 행 노출, 본문 스크롤로 마지막 행까지 보인다', async ({ authenticatedPage: page }) => {
  await setup(page, '/me/ai-tasks')
  await expectSmoke(page, 'AI 위임 작업', 'ai-row')
})
