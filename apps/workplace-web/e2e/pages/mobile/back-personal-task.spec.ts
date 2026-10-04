// 모바일 뒤로가기 히스토리 — 개인작업 패널(?task)(WP-208).
// 리스트 행은 replace 열기 → push 로 바뀌어 시스템 뒤로가기가 패널만 닫는다. 보드 모달 닫기는 "죽은 back" 을 남기지 않는다.
// WP-221: 모바일은 리스트·보드 모두 전체 화면 레이어(personal-task-mobile) — ESC 는 레이어 Dialog 가 처리.
import type { Page } from '@playwright/test'

import { createChatMessagePage, createChatThread } from '../../factories/chat.factory'
import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../factories/issue.factory'
import { createProject } from '../../factories/project.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/mobile.fixture'

const KEY = 'PME'
// 실데이터 폭 검증용 긴 제목.
const LONG_TITLE = '연말정산 증빙서류 정리 및 의료비·교육비 공제 항목 누락 여부 재확인 후 회사 제출'

async function stubPersonal(page: Page) {
  const issue = createIssue({ projectKey: KEY, number: 1, title: LONG_TITLE, status: 'TODO' })
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}`, createProject({ id: 7, key: KEY, name: '개인 작업', type: 'PERSONAL', isDefault: true }))
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/issues`, createIssueSearchResponse([issue]))
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/labels`, [])
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/cycles`, [])
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/types`, [])
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/issues/1`, createIssueDetail({ summary: issue, body: '' }))
  const thread = createChatThread()
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/issues/1/chat/thread`, thread)
  await mockApi(page, 'GET', `/api/v1/chat/threads/${thread.threadId}/messages`, createChatMessagePage([]))
}

test('행 → 전체 화면: goBack 은 상세만 닫고 개인작업에 남는다 — ‹ 도 같은 결과', async ({ authenticatedPage: page }) => {
  await stubPersonal(page)
  await page.goto(`/projects/${KEY}`)
  await page.getByTestId('personal-task-row-1').tap()
  const panel = page.getByTestId('personal-task-mobile')
  await expect(panel).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/projects/${KEY}\\?task=1$`))

  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`/projects/${KEY}$`))
  await expect(panel).toHaveCount(0)
  await expect(page.getByTestId('personal-checklist')).toBeVisible()

  await page.getByTestId('personal-task-row-1').tap()
  await expect(panel).toBeVisible()
  await page.getByTestId('personal-task-panel-close').tap()
  await expect(page).toHaveURL(new RegExp(`/projects/${KEY}$`))
  await expect(panel).toHaveCount(0)
})

test('보드 카드 → 상세: ESC 는 보드로 돌아가고 task 가 URL 에 남지 않는다', async ({ authenticatedPage: page }) => {
  await stubPersonal(page)
  await page.goto(`/projects/${KEY}?view=board`)
  await page.getByTestId('issue-card-1').getByRole('link').tap()
  const modal = page.getByTestId('personal-task-mobile')
  await expect(modal).toBeVisible()
  await page.keyboard.press('Escape')
  // 모바일 보드는 첫 로드 후 기본 탭을 URL(boardTab)에 고정한다(WP-195) — task 만 빠지면 된다.
  await expect(page).toHaveURL(new RegExp(`/projects/${KEY}\\?view=board(&boardTab=\\w+)?$`))
  await expect(modal).toHaveCount(0)
})

test('딥링크(?task) → ‹ 는 task 만 지우고 개인작업에 남는다', async ({ authenticatedPage: page }) => {
  await stubPersonal(page)
  await page.goto(`/projects/${KEY}?task=1`)
  await expect(page.getByTestId('personal-task-mobile')).toBeVisible()
  await page.getByTestId('personal-task-panel-close').tap()
  await expect(page).toHaveURL(new RegExp(`/projects/${KEY}$`))
})
