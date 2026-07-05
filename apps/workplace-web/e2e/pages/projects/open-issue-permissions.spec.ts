// OPEN 프로젝트 이슈 상세·보드 권한 분기 E2E 테스트 (Task 11).
// 무엇을: 서버 플래그(viewerCanEditContent/viewerCanEditWorkflow/viewerCanDelete/viewerIsMember)로
//          UI 분기가 올바르게 동작하는지 검증.
// 왜: 백엔드가 reporter·멤버 구분을 플래그로 내려주므로, 프론트가 플래그를 정확히 반영하는지 확인한다.

import { expect, test } from '../../fixtures/auth.fixture';
import { createIssue, createIssueDetail } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';

const PROJECT_KEY = 'OPNQA';
const ISSUE_NUMBER = 1;

// OPEN 프로젝트 + 이슈 상세 API 스텁 공통 설정 헬퍼.
async function setupOpenProjectMocks(
  page: import('@playwright/test').Page,
  options: {
    viewerCanEditContent: boolean;
    viewerCanEditWorkflow: boolean;
    viewerCanDelete: boolean;
    viewerIsMember: boolean;
  },
) {
  const project = createProject({
    key: PROJECT_KEY,
    type: 'OPEN',
    viewerIsMember: options.viewerIsMember,
  });
  const summary = createIssue({ projectKey: PROJECT_KEY, number: ISSUE_NUMBER, reporterId: 2 });
  const detail = createIssueDetail({
    summary,
    viewerCanEditContent: options.viewerCanEditContent,
    viewerCanEditWorkflow: options.viewerCanEditWorkflow,
    viewerCanDelete: options.viewerCanDelete,
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
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(detail),
      }),
  );
  // 이슈 상세 진입 시 자동 호출되는 서브 엔드포인트 스텁
  for (const sub of ['watchers', 'labels', 'attachments']) {
    await page.route(
      (url) =>
        url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/${sub}`,
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
  }
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/labels`,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  // 드라이브·공간 쿼리 스텁 (IssueAttachmentList 자동 호출)
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
  // 이슈 유형·AI 컨텍스트 스텁
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issue-types`,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/ai-summary`,
    (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }),
  );
  // 사이클 피커
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
}

// 보드 페이지 스텁 설정 헬퍼
async function setupBoardMocks(
  page: import('@playwright/test').Page,
  viewerIsMember: boolean,
) {
  const project = createProject({
    key: PROJECT_KEY,
    type: 'OPEN',
    viewerIsMember,
  });

  await page.route(`**/api/v1/projects/${PROJECT_KEY}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(project),
    }),
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
  await page.route(`**/api/v1/projects/${PROJECT_KEY}/members`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/saved-views`,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/cycles/active`,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }),
  );
}

// ─── 이슈 상세 — OPEN reporter (비멤버) 시나리오 ────────────────────────────────

test(
  'OPEN reporter: 제목 편집 버튼 활성, 상태 select 비활성',
  async ({ authenticatedPage: page }) => {
    // reporter (viewerCanEditContent=true, viewerCanEditWorkflow=false)
    await setupOpenProjectMocks(page, {
      viewerCanEditContent: true,
      viewerCanEditWorkflow: false,
      viewerCanDelete: false,
      viewerIsMember: false,
    });
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    // 제목 편집 연필 버튼 — 활성(reporter 본인 이슈이므로 편집 허용)
    await expect(page.getByTestId('issue-title-edit')).toBeEnabled();

    // 상태 변경 select 트리거 버튼 — 비활성(워크플로 수정 불가)
    await expect(page.getByTestId('issue-status-select')).toBeDisabled();
  },
);

test(
  'OPEN reporter: 삭제 버튼 미표시 (viewerCanDelete=false)',
  async ({ authenticatedPage: page }) => {
    await setupOpenProjectMocks(page, {
      viewerCanEditContent: true,
      viewerCanEditWorkflow: false,
      viewerCanDelete: false,
      viewerIsMember: false,
    });
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    // 삭제 버튼 미표시
    await expect(page.getByTestId('issue-delete')).not.toBeVisible();
  },
);

// ─── 이슈 상세 — 멤버 시나리오 ─────────────────────────────────────────────────

test(
  '멤버: 제목 편집·상태 select·삭제 버튼 모두 활성',
  async ({ authenticatedPage: page }) => {
    await setupOpenProjectMocks(page, {
      viewerCanEditContent: true,
      viewerCanEditWorkflow: true,
      viewerCanDelete: true,
      viewerIsMember: true,
    });
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    // 제목 편집 연필 버튼 활성
    await expect(page.getByTestId('issue-title-edit')).toBeEnabled();

    // 상태 select 활성
    await expect(page.getByTestId('issue-status-select')).toBeEnabled();

    // 삭제 버튼 표시
    await expect(page.getByTestId('issue-delete')).toBeVisible();
  },
);

// ─── 보드 — 비멤버(OPEN reporter) 시나리오 ──────────────────────────────────────

test(
  'OPEN 비멤버: 보드에서 "새 태스크" 버튼 표시 (OPEN 프로젝트는 테넌트 전원 생성 가능)',
  async ({ authenticatedPage: page }) => {
    await setupBoardMocks(page, false);
    // board 뷰로 이동 (URL param 으로 board 뷰 지정)
    await page.goto(`/projects/${PROJECT_KEY}?view=board`);

    // OPEN 비멤버도 이슈 생성 가능 — canCreateIssue = isOpenProject || viewerIsMember
    await expect(page.getByRole('button', { name: '+ 새 태스크' })).toBeVisible();
  },
);

// ─── 보드 — OPEN 프로젝트 비멤버도 이슈 생성 허용 확인 ─────────────────────────

test(
  'OPEN 멤버: 보드에서 "새 태스크" 버튼 표시',
  async ({ authenticatedPage: page }) => {
    await setupBoardMocks(page, true);
    await page.goto(`/projects/${PROJECT_KEY}?view=board`);

    // 멤버는 이슈 생성 버튼 표시
    await expect(page.getByRole('button', { name: '+ 새 태스크' })).toBeVisible();
  },
);
