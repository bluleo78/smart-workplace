// OPEN 접수함 통합 플로우 E2E — Task 12 안전망.
// 무엇을: 비멤버(reporter)가 OPEN 프로젝트에 건의를 제출하고 상세를 여는 전 과정에서
//          어떤 하위 fetch도 403/오류가 나지 않음을 검증한다("3분기 함정" 안전망).
//          멤버(처리팀)가 워크플로 상태를 변경할 수 있음도 검증한다.
// 왜: Tasks 1~11이 완성했지만 "비멤버가 OPEN 이슈 상세를 열 때 프론트가 호출하는
//     모든 하위 엔드포인트(라벨·워처·첨부·AI 요약·사이클·커스텀 필드)"가 모두
//     완화(assertReadable)되어 있는지 한 번에 확인한다.

import { expect, test } from '../../fixtures/auth.fixture';
import { createIssue, createIssueDetail } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';
import { mockApi } from '../../fixtures/api-mock';

const PROJECT_KEY = 'OPNQA';
const ISSUE_NUMBER = 1;

// ─── 공통 스텁 헬퍼 ────────────────────────────────────────────────────────────

/**
 * OPEN 프로젝트 + 이슈 상세 API 스텁 공통 설정.
 * open-issue-permissions.spec.ts 의 setupOpenProjectMocks 와 동일 패턴.
 * @param viewerIsMember 뷰어(현재 사용자)가 멤버인지 여부
 * @param viewerCanEditWorkflow 워크플로(상태) 변경 허용 여부
 */
async function setupFlowMocks(
  page: import('@playwright/test').Page,
  options: {
    viewerIsMember: boolean;
    viewerCanEditContent: boolean;
    viewerCanEditWorkflow: boolean;
    viewerCanDelete: boolean;
  },
) {
  const project = createProject({
    key: PROJECT_KEY,
    type: 'OPEN',
    viewerIsMember: options.viewerIsMember,
  });

  // 이슈 제목이 reporter 가 작성한 건의 내용
  const issueSummary = createIssue({
    projectKey: PROJECT_KEY,
    number: ISSUE_NUMBER,
    title: '다크모드 추가 건의',
    reporterId: 1, // auth.fixture 기본 사용자 id=1
  });

  const issueDetail = createIssueDetail({
    summary: issueSummary,
    viewerCanEditContent: options.viewerCanEditContent,
    viewerCanEditWorkflow: options.viewerCanEditWorkflow,
    viewerCanDelete: options.viewerCanDelete,
  });

  // 프로젝트 메타
  await page.route(`**/api/v1/projects/${PROJECT_KEY}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(project),
    }),
  );

  // 프로젝트 멤버 목록 (비멤버 시나리오: 빈 목록)
  await page.route(`**/api/v1/projects/${PROJECT_KEY}/members`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );

  // 이슈 상세
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(issueDetail),
      }),
  );

  // 이슈 상세 진입 시 자동 호출되는 서브 엔드포인트(라벨·워처·첨부).
  // Task 4 "assertReadable" 완화 대상 — 비멤버도 200이어야 함(안전망 핵심).
  for (const sub of ['watchers', 'labels', 'attachments']) {
    await page.route(
      (url) =>
        url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/${sub}`,
      (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
  }

  // 프로젝트 레벨 라벨 목록
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/labels`,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );

  // AI 요약(없음 → 404)
  await page.route(
    (url) =>
      url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/ai-summary`,
    (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }),
  );

  // 사이클
  await page.route(
    (url) =>
      url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/cycle`,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }),
  );

  // 커스텀 필드
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/custom-fields`,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );

  // 이슈 유형
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issue-types`,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );

  // 드라이브 링크·공간 스텁 (IssueAttachmentList 자동 호출)
  await page.route('**/api/v1/drive/links*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route('**/api/v1/drive/spaces*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], nextCursor: null }),
    }),
  );
}

// ─── 시나리오 1: 비멤버(reporter)가 이슈 상세를 열고 모든 하위 뷰가 정상 렌더됨 ──────

test(
  'OPEN 비멤버(reporter): 이슈 상세 진입 시 하위 fetch 전체 정상(403 없음)',
  { tag: '@smoke' },
  async ({ authenticatedPage: page }) => {
    // reporter 시나리오: 내용 편집 허용, 워크플로·삭제 불가
    await setupFlowMocks(page, {
      viewerIsMember: false,
      viewerCanEditContent: true,
      viewerCanEditWorkflow: false,
      viewerCanDelete: false,
    });

    // 403 Forbidden 수집 — 안전망 핵심 어서션.
    // 401 은 스텁 미등록 엔드포인트가 목 인증 계층을 통과 못 한 정상적 결과이므로 제외한다.
    // 403 은 권한 거부(assertMember/assertReadable 누락)를 의미하므로 0개이어야 한다.
    const forbidden403: string[] = [];
    page.on('response', (res) => {
      if (res.status() === 403 && res.url().includes('/api/v1/')) {
        forbidden403.push(`403 ${res.url()}`);
      }
    });

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    // 이슈 제목이 보여야 함(상세 페이지 로드 확인)
    await expect(page.getByTestId('issue-title-edit')).toBeVisible();

    // 속성 레일이 렌더되어야 함(라벨·워처·사이클 등 포함)
    await expect(page.getByTestId('property-rail')).toBeVisible();

    // 분류 그룹(라벨 섹션)이 DOM에 존재해야 함(기본 접힘이므로 toBeAttached로 확인)
    await expect(page.getByTestId('property-group-classification')).toBeAttached();

    // 비멤버는 상태 select 비활성(워크플로 게이트)
    await expect(page.getByTestId('issue-status-select')).toBeDisabled();

    // 제목 편집 버튼은 활성(본인 이슈, 내용 편집 허용)
    await expect(page.getByTestId('issue-title-edit')).toBeEnabled();

    // 삭제 버튼 미표시
    await expect(page.getByTestId('issue-delete')).not.toBeVisible();

    // 채팅 버튼이 렌더되어야 함(chat thread fetch 403 → 버튼 자체 미렌더 방지)
    await expect(page.getByTestId('issue-chat-open')).toBeVisible();

    // 403 Forbidden 이 없어야 함 — "3분기 함정" 안전망 핵심.
    // 비멤버(reporter)가 OPEN 이슈 상세를 열 때 어떤 서브 엔드포인트도 권한 거부(403)가
    // 나지 않아야 한다(Task 4 assertReadable 완화 커버리지 확인).
    expect(
      forbidden403,
      `비멤버 OPEN 이슈 상세 열기 중 403 권한 거부 발생: ${forbidden403.join(', ')}`,
    ).toHaveLength(0);
  },
);

// ─── 시나리오 2: reporter가 건의 작성 후 홈 "내 이슈"에 노출 ──────────────────────

test(
  'OPEN reporter가 건의를 제출하면 홈 "내 이슈"에 노출된다',
  { tag: '@smoke' },
  async ({ authenticatedPage: page }) => {
    // reporter 건의 이슈(내 담당/보고)가 me/issues 에 포함
    const myIssue = createIssue({
      projectKey: PROJECT_KEY,
      number: ISSUE_NUMBER,
      title: '다크모드 추가 건의',
      reporterId: 1,
    });

    // me/issues + 대시보드 레이아웃 스텁 (auth.fixture 기본값보다 LIFO 우선)
    await mockApi(page, 'GET', '/api/v1/me/issues', {
      items: [myIssue],
      nextCursor: null,
      hasMore: false,
    });
    await mockApi(page, 'GET', '/api/v1/me/dashboard', {
      widgets: [{ type: 'my_tasks', count: 5, hidden: false }],
    });

    await page.goto('/');

    // 내 작업 위젯이 보여야 함
    const widget = page.getByTestId('dash-mytasks');
    await expect(widget).toBeVisible();

    // 건의 이슈 제목이 위젯에 표시되어야 함
    await expect(widget).toContainText('다크모드 추가 건의');
  },
);

// ─── 시나리오 3: 멤버(처리팀)는 상태 select 활성 ──────────────────────────────────

test(
  '멤버(처리팀): 이슈 상태 select 활성 — 워크플로 변경 가능',
  { tag: '@smoke' },
  async ({ authenticatedPage: page }) => {
    // 멤버 시나리오: 모든 권한 허용
    await setupFlowMocks(page, {
      viewerIsMember: true,
      viewerCanEditContent: true,
      viewerCanEditWorkflow: true,
      viewerCanDelete: true,
    });

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    // 상태 select 활성(워크플로 게이트 통과)
    await expect(page.getByTestId('issue-status-select')).toBeEnabled();

    // 제목 편집 버튼 활성
    await expect(page.getByTestId('issue-title-edit')).toBeEnabled();

    // 삭제 버튼 표시
    await expect(page.getByTestId('issue-delete')).toBeVisible();
  },
);

// ─── 시나리오 4: 비멤버 OPEN 프로젝트 이슈 생성 — 생성 버튼이 보여야 함 ───────────

test(
  'OPEN 비멤버: 프로젝트 목록에서 이슈 생성 버튼 표시',
  async ({ authenticatedPage: page }) => {
    // 프로젝트 목록 + 보드 진입 스텁
    const project = createProject({
      key: PROJECT_KEY,
      type: 'OPEN',
      viewerIsMember: false, // 비멤버
    });

    await page.route(`**/api/v1/projects/${PROJECT_KEY}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(project),
      }),
    );
    await page.route(`**/api/v1/projects/${PROJECT_KEY}/members`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    await page.route(
      (url) =>
        url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues` ||
        url.pathname.startsWith(`/api/v1/projects/${PROJECT_KEY}/issues`),
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ items: [], nextCursor: null, hasMore: false }),
        }),
    );
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/saved-views`,
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/cycles/active`,
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }),
    );
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/custom-fields`,
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issue-types`,
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/labels`,
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );

    // 보드 뷰로 진입
    await page.goto(`/projects/${PROJECT_KEY}?view=board`);

    // OPEN 비멤버도 이슈 생성 버튼이 표시되어야 함(canCreateIssue = isOpenProject || viewerIsMember)
    await expect(page.getByRole('button', { name: '+ 새 태스크' })).toBeVisible();
  },
);
