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

test('이슈 위젯 — 이슈 없을 때 개선된 empty state(아이콘·제목·설명·CTA)가 렌더된다 (#129)', async ({
  authenticatedPage: page,
}) => {
  // 이슈 없는 빈 응답으로 모킹
  const emptyIssues: IssueSearchResponse = createIssueSearchResponse([])
  await mockApi(page, 'GET', '/api/v1/me/issues', emptyIssues)
  await mockApi(page, 'GET', '/api/v1/me/watched-issues', emptyIssues)
  await mockApi(page, 'GET', '/api/v1/me/activity', activity())
  await page.goto('/')

  // 빈 상태 컨테이너 표시 확인
  const emptyState = page.getByTestId('issuelist-empty')
  await expect(emptyState).toBeVisible()

  // 제목·설명 텍스트가 맥락을 전달하는지 검증
  await expect(emptyState).toContainText('배정된 이슈가 없어요')
  await expect(emptyState).toContainText('나에게 할당된 이슈가 여기에 표시됩니다')

  // CTA 링크가 /projects 로 연결되는지 검증
  const ctaLink = emptyState.getByRole('link', { name: '프로젝트로 이동' })
  await expect(ctaLink).toBeVisible()
  await expect(ctaLink).toHaveAttribute('href', '/projects')

  // 아이콘 svg 가 렌더되는지 확인(존재 여부)
  await expect(emptyState.locator('svg')).toBeVisible()
})

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

test('상단 칩 런처 — 클릭으로 모드 순환(closed→side→fullscreen→closed), 칩은 상주', async ({
  authenticatedPage: page,
}) => {
  await mockHome(page)
  await page.goto('/')
  await expect(page.getByTestId('home-widget')).toHaveCount(3)

  // 첫 클릭 → side. 칩은 사라지지 않고 active 상태로 상주.
  await page.getByTestId('chat-launcher').click()
  await expect(page.getByTestId('chat-panel')).toBeVisible()
  await expect(page.getByTestId('chat-input')).toBeVisible()
  await expect(page.getByTestId('chat-launcher')).toBeVisible()

  // 두 번째 클릭 → fullscreen (여전히 chat-panel 렌더)
  await page.getByTestId('chat-launcher').click()
  await expect(page.getByTestId('chat-panel')).toBeVisible()

  // 세 번째 클릭 → closed (패널 사라지고 칩만 상주)
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

test('활동 위젯 — eventType 이 한국어 레이블로 변환되어 표시된다 (#147)', async ({
  authenticatedPage: page,
}) => {
  // 다양한 eventType 을 포함한 활동 목록으로 모킹
  const activityWithEvents: ActivityPage = {
    items: [
      {
        id: 1,
        issueId: 1,
        projectKey: 'WP',
        issueNumber: 7,
        issueTitle: '로그인 버그',
        actorId: 2,
        actorName: '양동희',
        actorKind: 'HUMAN',
        eventType: 'STATUS_CHANGED',
        createdAt: '2026-06-07T01:00:00Z',
      },
      {
        id: 2,
        issueId: 1,
        projectKey: 'WP',
        issueNumber: 7,
        issueTitle: '로그인 버그',
        actorId: 2,
        actorName: '양동희',
        actorKind: 'HUMAN',
        eventType: 'COMMENTED',
        createdAt: '2026-06-07T02:00:00Z',
      },
    ],
    nextCursor: null,
  }
  await mockApi(page, 'GET', '/api/v1/me/issues', issueList())
  await mockApi(page, 'GET', '/api/v1/me/watched-issues', issueList())
  await mockApi(page, 'GET', '/api/v1/me/activity', activityWithEvents)
  await page.goto('/')

  const activityList = page.getByTestId('activity-items')
  await expect(activityList).toBeVisible()

  // 각 항목에 eventType 한국어 레이블이 렌더되었는지 확인
  await expect(activityList).toContainText('상태 변경')
  await expect(activityList).toContainText('코멘트')

  // 행위자 이름과 이슈 제목도 함께 표시되어야 한다
  await expect(activityList).toContainText('양동희')
  await expect(activityList).toContainText('로그인 버그')
})

test('활동 위젯 — LABELS_CHANGED·ATTACHMENTS_CHANGED 가 한국어 레이블로 표시된다 (#153)', async ({
  authenticatedPage: page,
}) => {
  // 백엔드 실제 enum 값(LABELS_CHANGED, ATTACHMENTS_CHANGED)을 포함한 활동 목록 모킹
  const activityWithMissingLabels: ActivityPage = {
    items: [
      {
        id: 1,
        issueId: 1,
        projectKey: 'WP',
        issueNumber: 7,
        issueTitle: '채팅 테스트 이슈',
        actorId: 2,
        actorName: '양동희',
        actorKind: 'HUMAN',
        eventType: 'LABELS_CHANGED',
        createdAt: '2026-06-07T01:00:00Z',
      },
      {
        id: 2,
        issueId: 1,
        projectKey: 'WP',
        issueNumber: 7,
        issueTitle: '채팅 테스트 이슈',
        actorId: 2,
        actorName: '양동희',
        actorKind: 'HUMAN',
        eventType: 'ATTACHMENTS_CHANGED',
        createdAt: '2026-06-07T02:00:00Z',
      },
    ],
    nextCursor: null,
  }
  await mockApi(page, 'GET', '/api/v1/me/issues', issueList())
  await mockApi(page, 'GET', '/api/v1/me/watched-issues', issueList())
  await mockApi(page, 'GET', '/api/v1/me/activity', activityWithMissingLabels)
  await page.goto('/')

  const activityList = page.getByTestId('activity-items')
  await expect(activityList).toBeVisible()

  // raw enum 값이 아닌 한국어 레이블로 표시되어야 한다
  await expect(activityList).toContainText('라벨 변경')
  await expect(activityList).toContainText('첨부 변경')
  await expect(activityList).not.toContainText('LABELS_CHANGED')
  await expect(activityList).not.toContainText('ATTACHMENTS_CHANGED')
})

test('활동 위젯 — CUSTOM_FIELD_CHANGED·DEPENDENCY_ADDED 등 신규 이벤트가 한국어 레이블로 표시된다 (#191)', async ({
  authenticatedPage: page,
}) => {
  // 누락됐던 5종 이벤트를 포함한 활동 목록으로 모킹
  const activityWithNewEvents: ActivityPage = {
    items: [
      {
        id: 1,
        issueId: 1,
        projectKey: 'WP',
        issueNumber: 7,
        issueTitle: '채팅 테스트 이슈',
        actorId: 2,
        actorName: '양동희',
        actorKind: 'HUMAN',
        eventType: 'CUSTOM_FIELD_CHANGED',
        createdAt: '2026-06-08T01:00:00Z',
      },
      {
        id: 2,
        issueId: 1,
        projectKey: 'WP',
        issueNumber: 7,
        issueTitle: '채팅 테스트 이슈',
        actorId: 2,
        actorName: '양동희',
        actorKind: 'HUMAN',
        eventType: 'DEPENDENCY_ADDED',
        createdAt: '2026-06-08T02:00:00Z',
      },
      {
        id: 3,
        issueId: 1,
        projectKey: 'WP',
        issueNumber: 7,
        issueTitle: '채팅 테스트 이슈',
        actorId: 2,
        actorName: '양동희',
        actorKind: 'HUMAN',
        eventType: 'DEPENDENCY_REMOVED',
        createdAt: '2026-06-08T03:00:00Z',
      },
      {
        id: 4,
        issueId: 1,
        projectKey: 'WP',
        issueNumber: 7,
        issueTitle: '채팅 테스트 이슈',
        actorId: 2,
        actorName: '양동희',
        actorKind: 'HUMAN',
        eventType: 'TYPE_CHANGED',
        createdAt: '2026-06-08T04:00:00Z',
      },
      {
        id: 5,
        issueId: 1,
        projectKey: 'WP',
        issueNumber: 7,
        issueTitle: '채팅 테스트 이슈',
        actorId: 2,
        actorName: '양동희',
        actorKind: 'HUMAN',
        eventType: 'PARENT_CHANGED',
        createdAt: '2026-06-08T05:00:00Z',
      },
    ],
    nextCursor: null,
  }
  await mockApi(page, 'GET', '/api/v1/me/issues', issueList())
  await mockApi(page, 'GET', '/api/v1/me/watched-issues', issueList())
  await mockApi(page, 'GET', '/api/v1/me/activity', activityWithNewEvents)
  await page.goto('/')

  const activityList = page.getByTestId('activity-items')
  await expect(activityList).toBeVisible()

  // raw enum 값이 아닌 한국어 레이블로 표시되어야 한다
  await expect(activityList).toContainText('필드')
  await expect(activityList).toContainText('의존성 추가')
  await expect(activityList).toContainText('의존성 제거')
  await expect(activityList).toContainText('유형 변경')
  await expect(activityList).toContainText('부모 변경')
  await expect(activityList).not.toContainText('CUSTOM_FIELD_CHANGED')
  await expect(activityList).not.toContainText('DEPENDENCY_ADDED')
  await expect(activityList).not.toContainText('DEPENDENCY_REMOVED')
  await expect(activityList).not.toContainText('TYPE_CHANGED')
  await expect(activityList).not.toContainText('PARENT_CHANGED')
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
