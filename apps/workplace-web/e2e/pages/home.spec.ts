import type { Page } from '@playwright/test'

import { expect, test } from '../fixtures/auth.fixture'
import { mockApi } from '../fixtures/api-mock'
import { createIssue, createIssueSearchResponse } from '../factories/issue.factory'
import type { IssueSearchResponse } from '../../src/types/issue'
import type { ActivityPage } from '../../src/types/home'

// 7c 홈 E2E — 기본 구성 자동 로드(AI 미호출)·⌘K 명령→compose 재구성·멀티페이지 전환.
// 모든 홈 API(/me/issues, /me/watched-issues, /me/activity, /home/compose)를 모킹해 백엔드 없이 검증.

// 최소 이슈 1건(IssueSearchResponse). 기존 issue factory 재사용으로 타입 정합 보장.
function issueList(): IssueSearchResponse {
  return createIssueSearchResponse([
    createIssue({ id: 1, projectKey: 'WP', number: 7, title: '로그인 버그', status: 'IN_PROGRESS', priority: 'HIGH' }),
  ])
}

// 최근 활동 1건 — actorKind=AGENT(Claude) 로 AI 활동 표시 검증.
function activity(): ActivityPage {
  return {
    items: [
      {
        id: 1,
        issueId: 1,
        projectKey: 'WP',
        issueNumber: 7,
        issueTitle: '로그인 버그',
        actorId: 9,
        actorName: 'Claude',
        actorKind: 'AGENT',
        eventType: 'STATUS_CHANGE',
        createdAt: '2026-05-30T01:00:00Z',
      },
    ],
    nextCursor: null,
  }
}

// 홈 기본 구성용 데이터 모킹. mockApi 는 pathname 정확 매칭(쿼리스트링 무시)이라
// /me/issues?assignee=me&size=50 같은 호출도 같은 응답으로 매칭된다. fixture 의 빈 기본 스텁을 덮어쓴다.
async function mockHome(page: Page) {
  await mockApi(page, 'GET', '/api/v1/me/issues', issueList())
  await mockApi(page, 'GET', '/api/v1/me/watched-issues', issueList())
  await mockApi(page, 'GET', '/api/v1/me/activity', activity())
}

test('홈 기본 구성이 AI 호출 없이 로드된다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  await mockHome(page)
  await page.goto('/')

  // 위젯 3종이 렌더(기본 구성: my_tasks + issue_list + activity)
  await expect(page.getByTestId('home-widget')).toHaveCount(3)
  await expect(page.getByTestId('issuelist-items')).toContainText('로그인 버그')
  await expect(page.getByTestId('activity-items')).toContainText('Claude')
  // 떠있는 챗 입력창은 평소 보임, 메시지 패널은 접힘
  await expect(page.getByTestId('chat-input')).toBeVisible()
  await expect(page.getByTestId('chat-panel')).toHaveCount(0)
})

test('⌘K 로 챗을 열고 명령하면 캔버스가 재구성된다', async ({ authenticatedPage: page }) => {
  await mockHome(page)
  const composeCapture = await mockApi(
    page,
    'POST',
    '/api/v1/home/compose',
    {
      sessionId: 's1',
      message: 'HIGH 이슈만 보여드려요',
      widgets: [{ type: 'issue_list', params: { assignee: 'me', priority: ['HIGH'] }, layout: { page: 'current' } }],
    },
    { capture: true },
  )

  await page.goto('/')
  await expect(page.getByTestId('home-widget')).toHaveCount(3)

  // ⌘K → 패널 펼침
  await page.keyboard.press('Meta+k')
  await expect(page.getByTestId('chat-panel')).toBeVisible()

  // 명령 입력 → 전송
  await page.getByTestId('chat-input').fill('내 HIGH 이슈')
  await page.getByRole('button', { name: '보내기' }).click()

  // 요청 페이로드 검증(sessionId null, query)
  const req = await composeCapture.waitForRequest()
  expect(req.payload).toMatchObject({ sessionId: null, query: '내 HIGH 이슈' })

  // 재구성: 현재 페이지가 issue_list 1개로 교체(replace-all)
  await expect(page.getByTestId('home-widget')).toHaveCount(1)
  // 응답 완료 → 자동 접힘
  await expect(page.getByTestId('chat-panel')).toHaveCount(0)
})

test('compose 가 page=new 면 새 페이지가 생기고 전환된다', async ({ authenticatedPage: page }) => {
  await mockHome(page)
  await mockApi(page, 'POST', '/api/v1/home/compose', {
    sessionId: 's1',
    message: '새 페이지에 마감 이슈를 띄웠어요',
    widgets: [
      {
        type: 'issue_list',
        params: { assignee: 'me', dueTo: '2026-06-05' },
        layout: { page: 'new', pageLabel: '이번 주 마감' },
      },
    ],
  })

  await page.goto('/')
  await page.keyboard.press('Meta+k')
  await page.getByTestId('chat-input').fill('이번 주 마감')
  await page.getByRole('button', { name: '보내기' }).click()

  // 페이지 인디케이터가 2개 점을 보인다(기본 페이지 + 새 페이지)
  const indicator = page.getByTestId('page-indicator')
  await expect(indicator).toBeVisible()
  await expect(indicator.getByRole('button')).toHaveCount(2)
})
