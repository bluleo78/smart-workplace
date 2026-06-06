import type { Page } from '@playwright/test'

import { expect, test } from '../fixtures/auth.fixture'
import { mockApi } from '../fixtures/api-mock'
import { createIssue, createIssueSearchResponse } from '../factories/issue.factory'
import type { IssueSearchResponse } from '../../src/types/issue'
import type { ActivityPage, HomeMessage, HomeSessionPage } from '../../src/types/home'

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

// 세션 목록 스텁(기본 빈; 인자로 채운 목록 주입). fixture 의 빈 기본 스텁을 덮어쓴다.
async function mockSessions(page: Page, sessions: HomeSessionPage = { items: [], nextCursor: null }) {
  await mockApi(page, 'GET', '/api/v1/home/sessions', sessions)
}

test('홈 기본 구성이 AI 호출 없이 로드된다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  await mockHome(page)
  await page.goto('/')

  // 위젯 3종이 렌더(기본 구성: my_tasks + issue_list + activity)
  await expect(page.getByTestId('home-widget')).toHaveCount(3)
  await expect(page.getByTestId('issuelist-items')).toContainText('로그인 버그')
  await expect(page.getByTestId('activity-items')).toContainText('Claude')
  // 상단 AI 칩(런처)은 평소 보임, 입력/메시지 패널은 접힘(칩 클릭/⌘K 로만 펼침)
  await expect(page.getByTestId('chat-launcher')).toBeVisible()
  await expect(page.getByTestId('chat-panel')).toHaveCount(0)
  await expect(page.getByTestId('chat-input')).toHaveCount(0)
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
  // B(#51): 응답이 위젯이어도 패널은 자동으로 닫히지 않는다(도크형·비차단). 대화가 그대로 보인다.
  await expect(page.getByTestId('chat-panel')).toBeVisible()
  await expect(page.getByTestId('chat-panel')).toContainText('내 HIGH 이슈')
  await expect(page.getByTestId('chat-panel')).toContainText('HIGH 이슈만 보여드려요')
  // 이력은 말풍선 단위로 렌더된다(사용자 질의 + 어시스턴트 응답 = 2개).
  await expect(page.getByTestId('chat-turn')).toHaveCount(2)
})

test('텍스트 전용 응답(위젯 없음)도 패널이 닫히지 않고 대화가 그대로 보인다 (#51)', async ({
  authenticatedPage: page,
}) => {
  await mockHome(page)
  // "안녕" 류 — 위젯 없이 텍스트만 답하는 응답.
  await mockApi(page, 'POST', '/api/v1/home/compose', {
    sessionId: 's1',
    message: '안녕하세요. 무엇을 도와드릴까요?',
    widgets: [],
  })
  await page.goto('/')

  await page.getByTestId('chat-launcher').click()
  await page.getByTestId('chat-input').fill('안녕')
  await page.getByRole('button', { name: '보내기' }).click()

  // 응답 후에도 자동 접힘 없이 패널이 그대로 열려 transcript 가 보여야 한다.
  await expect(page.getByTestId('chat-panel')).toBeVisible()
  await expect(page.getByTestId('chat-panel')).toContainText('안녕')
  await expect(page.getByTestId('chat-panel')).toContainText('안녕하세요. 무엇을 도와드릴까요?')
})

test('상단 칩 런처 — 클릭으로 패널 토글(열고 닫힘), 닫히면 칩만 남는다', async ({
  authenticatedPage: page,
}) => {
  await mockHome(page)
  await page.goto('/')
  await expect(page.getByTestId('home-widget')).toHaveCount(3)

  // 칩 클릭 → 모달 도크 펼침. 칩은 사라지지 않고 active 상태로 상주.
  await page.getByTestId('chat-launcher').click()
  await expect(page.getByTestId('chat-panel')).toBeVisible()
  await expect(page.getByTestId('chat-input')).toBeVisible()
  await expect(page.getByTestId('chat-launcher')).toBeVisible()

  // 다시 칩 클릭 → 모달 닫힘(칩은 그대로 상주)
  await page.getByTestId('chat-launcher').click()
  await expect(page.getByTestId('chat-panel')).toHaveCount(0)
  await expect(page.getByTestId('chat-input')).toHaveCount(0)
  await expect(page.getByTestId('chat-launcher')).toBeVisible()
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
  await page.getByTestId('chat-launcher').click()
  await page.getByTestId('chat-input').fill('이번 주 마감')
  await page.getByRole('button', { name: '보내기' }).click()

  // 페이지 인디케이터가 2개 점을 보인다(기본 페이지 + 새 페이지)
  const indicator = page.getByTestId('page-indicator')
  await expect(indicator).toBeVisible()
  await expect(indicator.getByRole('button')).toHaveCount(2)
})

// 7d 홈 세션 UI E2E — 세션 스위처 새세션·복원·삭제. /home/sessions 목록·{id}/messages·DELETE 모킹.

test('복원 — 세션 선택 시 대화 transcript + 캔버스 재구성(AI 재호출 없음)', async ({ authenticatedPage: page }) => {
  await mockHome(page)
  await mockSessions(page, {
    items: [{ id: 's9', title: 'HIGH 이슈 보기', lastMessageAt: '2026-05-31T00:00:00Z', widgetCount: 1 }],
    nextCursor: null,
  })
  const messages: HomeMessage[] = [
    { id: 1, role: 'USER', content: 'HIGH 이슈', widgets: null, createdAt: '2026-05-31T00:00:00Z' },
    {
      id: 2,
      role: 'ASSISTANT',
      content: '여기 있어요',
      widgets: [{ type: 'issue_list', params: { priority: 'HIGH' }, layout: { page: 'current' } }],
      createdAt: '2026-05-31T00:00:01Z',
    },
  ]
  await mockApi(page, 'GET', '/api/v1/home/sessions/s9/messages', messages)
  await page.goto('/')

  // 세션 선택 → 메시지 페치 후 캔버스 fold(위젯 1개) + transcript 재현
  await page.getByTestId('session-switcher').click()
  await page.getByTestId('session-select').click()

  await expect(page.getByTestId('home-widget')).toHaveCount(1)
  await page.getByTestId('chat-launcher').click()
  await expect(page.getByTestId('chat-panel')).toContainText('HIGH 이슈')
  await expect(page.getByTestId('chat-panel')).toContainText('여기 있어요')
  await expect(page.getByTestId('session-switcher')).toContainText('HIGH 이슈 보기')
})

test('삭제 — 휴지통 클릭 시 DELETE 호출 + 목록에서 제거', async ({ authenticatedPage: page }) => {
  await mockHome(page)
  await mockSessions(page, {
    items: [{ id: 's3', title: '삭제할 세션', lastMessageAt: '2026-05-31T00:00:00Z', widgetCount: 0 }],
    nextCursor: null,
  })
  const del = await mockApi(page, 'DELETE', '/api/v1/home/sessions/s3', null, { status: 204, capture: true })
  await page.goto('/')

  await page.getByTestId('session-switcher').click()
  await expect(page.getByTestId('session-item')).toHaveCount(1)
  // 삭제 성공 → 세션 목록 invalidate → 재페치는 빈 목록(나중 등록 라우트가 우선)
  await mockSessions(page)
  await page.getByTestId('session-delete').click()
  await del.waitForRequest()
  await expect(page.getByTestId('session-item')).toHaveCount(0)
})
